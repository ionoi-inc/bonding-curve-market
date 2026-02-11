// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BondingCurveMarket
 * @notice Linear bonding curve market for buying/selling tokens
 * @dev Implements: price = basePrice + (slope * supply)
 */
contract BondingCurveMarket is ReentrancyGuard, Ownable {
    
    // ============ State Variables ============
    
    /// @notice The token being traded on this bonding curve
    IERC20 public immutable token;
    
    /// @notice Base price in wei (starting price when supply = 0)
    uint256 public basePrice;
    
    /// @notice Slope of the linear curve (price increase per token)
    uint256 public slope;
    
    /// @notice Current circulating supply
    uint256 public currentSupply;
    
    /// @notice Fee percentage in basis points (100 = 1%)
    uint256 public feeBps;
    
    /// @notice Protocol fee recipient
    address public feeRecipient;
    
    /// @notice Accumulated fees
    uint256 public accumulatedFees;
    
    // ============ Events ============
    
    event TokensPurchased(
        address indexed buyer,
        uint256 amount,
        uint256 cost,
        uint256 fee,
        uint256 newSupply
    );
    
    event TokensSold(
        address indexed seller,
        uint256 amount,
        uint256 proceeds,
        uint256 fee,
        uint256 newSupply
    );
    
    event FeesWithdrawn(address indexed recipient, uint256 amount);
    
    event CurveParametersUpdated(uint256 newBasePrice, uint256 newSlope);
    
    event FeeConfigUpdated(uint256 newFeeBps, address newFeeRecipient);
    
    // ============ Constructor ============
    
    /**
     * @param _token Address of the token to trade
     * @param _basePrice Initial base price in wei
     * @param _slope Slope of the linear curve
     * @param _feeBps Fee in basis points (100 = 1%)
     * @param _feeRecipient Address to receive fees
     */
    constructor(
        address _token,
        uint256 _basePrice,
        uint256 _slope,
        uint256 _feeBps,
        address _feeRecipient
    ) Ownable(msg.sender) {
        require(_token != address(0), "Invalid token address");
        require(_feeRecipient != address(0), "Invalid fee recipient");
        require(_feeBps <= 1000, "Fee too high"); // Max 10%
        
        token = IERC20(_token);
        basePrice = _basePrice;
        slope = _slope;
        feeBps = _feeBps;
        feeRecipient = _feeRecipient;
    }
    
    // ============ Core Functions ============
    
    /**
     * @notice Buy tokens using the bonding curve
     * @param amount Number of tokens to buy
     * @return cost Total ETH cost including fees
     */
    function buy(uint256 amount) external payable nonReentrant returns (uint256 cost) {
        require(amount > 0, "Amount must be positive");
        
        // Calculate cost using integral of linear curve
        cost = calculateBuyCost(amount);
        uint256 fee = (cost * feeBps) / 10000;
        uint256 totalCost = cost + fee;
        
        require(msg.value >= totalCost, "Insufficient ETH sent");
        
        // Update state
        currentSupply += amount;
        accumulatedFees += fee;
        
        // Transfer tokens to buyer
        require(
            token.transfer(msg.sender, amount),
            "Token transfer failed"
        );
        
        // Refund excess ETH
        if (msg.value > totalCost) {
            (bool success, ) = msg.sender.call{value: msg.value - totalCost}("");
            require(success, "Refund failed");
        }
        
        emit TokensPurchased(msg.sender, amount, cost, fee, currentSupply);
        
        return totalCost;
    }
    
    /**
     * @notice Sell tokens back to the bonding curve
     * @param amount Number of tokens to sell
     * @return proceeds ETH received after fees
     */
    function sell(uint256 amount) external nonReentrant returns (uint256 proceeds) {
        require(amount > 0, "Amount must be positive");
        require(amount <= currentSupply, "Insufficient supply");
        
        // Calculate proceeds using integral of linear curve
        uint256 grossProceeds = calculateSellProceeds(amount);
        uint256 fee = (grossProceeds * feeBps) / 10000;
        proceeds = grossProceeds - fee;
        
        require(address(this).balance >= proceeds, "Insufficient contract balance");
        
        // Update state
        currentSupply -= amount;
        accumulatedFees += fee;
        
        // Transfer tokens from seller
        require(
            token.transferFrom(msg.sender, address(this), amount),
            "Token transfer failed"
        );
        
        // Send ETH to seller
        (bool success, ) = msg.sender.call{value: proceeds}("");
        require(success, "ETH transfer failed");
        
        emit TokensSold(msg.sender, amount, proceeds, fee, currentSupply);
        
        return proceeds;
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Calculate cost to buy tokens (excluding fees)
     * @param amount Number of tokens to buy
     * @return cost ETH cost before fees
     * @dev Uses integral: cost = basePrice * amount + (slope * amount * (2*supply + amount)) / 2
     */
    function calculateBuyCost(uint256 amount) public view returns (uint256 cost) {
        uint256 supply = currentSupply;
        
        // Integral of price function from supply to supply + amount
        // ∫(basePrice + slope * x)dx from supply to supply + amount
        // = basePrice * amount + slope * (amount * (2*supply + amount)) / 2
        
        uint256 baseCost = basePrice * amount;
        uint256 slopeCost = (slope * amount * (2 * supply + amount)) / 2;
        
        return baseCost + slopeCost;
    }
    
    /**
     * @notice Calculate proceeds from selling tokens (excluding fees)
     * @param amount Number of tokens to sell
     * @return proceeds ETH received before fees
     */
    function calculateSellProceeds(uint256 amount) public view returns (uint256 proceeds) {
        require(amount <= currentSupply, "Amount exceeds supply");
        
        uint256 supply = currentSupply;
        
        // Integral of price function from supply - amount to supply
        // Same formula as buy but calculated from lower range
        uint256 baseCost = basePrice * amount;
        uint256 slopeCost = (slope * amount * (2 * supply - amount)) / 2;
        
        return baseCost + slopeCost;
    }
    
    /**
     * @notice Get current price for buying 1 token
     * @return Current marginal buy price
     */
    function getCurrentBuyPrice() public view returns (uint256) {
        return basePrice + (slope * currentSupply);
    }
    
    /**
     * @notice Get current price for selling 1 token
     * @return Current marginal sell price
     */
    function getCurrentSellPrice() public view returns (uint256) {
        if (currentSupply == 0) return 0;
        return basePrice + (slope * (currentSupply - 1));
    }
    
    /**
     * @notice Calculate total cost including fees for buying
     * @param amount Number of tokens
     * @return Total ETH required
     */
    function getBuyQuote(uint256 amount) external view returns (uint256) {
        uint256 cost = calculateBuyCost(amount);
        uint256 fee = (cost * feeBps) / 10000;
        return cost + fee;
    }
    
    /**
     * @notice Calculate total proceeds including fees for selling
     * @param amount Number of tokens
     * @return Total ETH received
     */
    function getSellQuote(uint256 amount) external view returns (uint256) {
        uint256 proceeds = calculateSellProceeds(amount);
        uint256 fee = (proceeds * feeBps) / 10000;
        return proceeds - fee;
    }
    
    // ============ Admin Functions ============
    
    /**
     * @notice Update bonding curve parameters
     * @param _basePrice New base price
     * @param _slope New slope
     */
    function updateCurveParameters(
        uint256 _basePrice,
        uint256 _slope
    ) external onlyOwner {
        basePrice = _basePrice;
        slope = _slope;
        
        emit CurveParametersUpdated(_basePrice, _slope);
    }
    
    /**
     * @notice Update fee configuration
     * @param _feeBps New fee in basis points
     * @param _feeRecipient New fee recipient
     */
    function updateFeeConfig(
        uint256 _feeBps,
        address _feeRecipient
    ) external onlyOwner {
        require(_feeBps <= 1000, "Fee too high"); // Max 10%
        require(_feeRecipient != address(0), "Invalid recipient");
        
        feeBps = _feeBps;
        feeRecipient = _feeRecipient;
        
        emit FeeConfigUpdated(_feeBps, _feeRecipient);
    }
    
    /**
     * @notice Withdraw accumulated fees
     */
    function withdrawFees() external nonReentrant {
        require(msg.sender == feeRecipient || msg.sender == owner(), "Not authorized");
        require(accumulatedFees > 0, "No fees to withdraw");
        
        uint256 amount = accumulatedFees;
        accumulatedFees = 0;
        
        (bool success, ) = feeRecipient.call{value: amount}("");
        require(success, "Fee withdrawal failed");
        
        emit FeesWithdrawn(feeRecipient, amount);
    }
    
    /**
     * @notice Emergency token recovery (only owner)
     * @param _token Token to recover
     * @param amount Amount to recover
     */
    function recoverTokens(address _token, uint256 amount) external onlyOwner {
        require(_token != address(token), "Cannot recover market token");
        IERC20(_token).transfer(owner(), amount);
    }
    
    // ============ Receive Function ============
    
    /// @notice Allow contract to receive ETH for liquidity
    receive() external payable {}
}
