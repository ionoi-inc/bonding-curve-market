# BondingCurveMarket

A Solidity smart contract implementing a linear bonding curve market for ERC20 tokens with configurable fees and admin controls.

## Overview

BondingCurveMarket enables automated market making using a linear bonding curve formula: **price = basePrice + (slope × supply)**. The contract supports buying and selling tokens with slippage protection, fee collection, and comprehensive admin controls.

## Features

### Core Functionality
- ✅ **Linear Bonding Curve**: Deterministic pricing based on supply
- ✅ **Buy/Sell Operations**: Purchase tokens with ETH or sell tokens for ETH
- ✅ **Slippage Protection**: Max/min price limits on trades
- ✅ **Fee System**: Configurable buy/sell fees with automatic accumulation
- ✅ **Quote System**: Get accurate price quotes before trading

### Security Features
- ✅ **ReentrancyGuard**: Protection against reentrancy attacks
- ✅ **Pausable**: Emergency pause functionality
- ✅ **Access Control**: Owner-only admin functions
- ✅ **Input Validation**: Comprehensive parameter validation

### Admin Controls
- ✅ **Update Curve Parameters**: Adjust basePrice and slope
- ✅ **Update Fee Parameters**: Modify buy/sell fees (max 10%)
- ✅ **Update Fee Recipient**: Change treasury address
- ✅ **Fee Withdrawal**: Extract accumulated fees
- ✅ **Emergency Recovery**: Recover accidentally sent tokens

## Installation

```bash
npm install
```

## Deployment

### 1. Configure Environment

Create a `.env` file:

```bash
# Required
TOKEN_ADDRESS=0x... # Your ERC20 token address
FEE_RECIPIENT=0x... # Treasury address for fees

# Optional Network Configuration
PRIVATE_KEY=your_private_key
INFURA_KEY=your_infura_key
ETHERSCAN_API_KEY=your_etherscan_key
```

### 2. Customize Parameters

Edit `deploy.js` to configure:

```javascript
const DEPLOYMENT_CONFIG = {
  tokenAddress: process.env.TOKEN_ADDRESS,
  basePrice: ethers.parseEther("0.001"),    // Starting price
  slope: ethers.parseEther("0.0001"),       // Price increase per token
  buyFeeBps: 250,                           // 2.5% buy fee
  sellFeeBps: 250,                          // 2.5% sell fee
  feeRecipient: process.env.FEE_RECIPIENT,
  initialMarketSupply: ethers.parseEther("100000"),
};
```

### 3. Deploy

```bash
# Local deployment
npx hardhat run scripts/deploy.js --network localhost

# Testnet deployment
npx hardhat run scripts/deploy.js --network sepolia

# Mainnet deployment
npx hardhat run scripts/deploy.js --network mainnet
```

### 4. Verify Contract

```bash
npx hardhat verify --network <network> <MARKET_ADDRESS> \
  "<TOKEN_ADDRESS>" \
  "<BASE_PRICE>" \
  "<SLOPE>" \
  <BUY_FEE_BPS> \
  <SELL_FEE_BPS> \
  "<FEE_RECIPIENT>"
```

## Usage

### Buy Tokens

```javascript
const market = await ethers.getContractAt("BondingCurveMarket", marketAddress);

// Get quote
const amount = ethers.parseEther("10");
const quote = await market.getBuyQuote(amount);
console.log("Cost:", ethers.formatEther(quote.totalCost), "ETH");
console.log("Fee:", ethers.formatEther(quote.fee), "ETH");

// Execute buy with slippage protection
await market.buy(amount, quote.totalCost, { value: quote.totalCost });
```

### Sell Tokens

```javascript
// Approve market to spend tokens
const token = await ethers.getContractAt("IERC20", tokenAddress);
await token.approve(marketAddress, amount);

// Get quote
const quote = await market.getSellQuote(amount);
console.log("Proceeds:", ethers.formatEther(quote.netProceeds), "ETH");

// Execute sell with slippage protection
await market.sell(amount, quote.netProceeds);
```

### Check Current Price

```javascript
const buyPrice = await market.getCurrentBuyPrice();
const sellPrice = await market.getCurrentSellPrice();

console.log("Current buy price:", ethers.formatEther(buyPrice), "ETH");
console.log("Current sell price:", ethers.formatEther(sellPrice), "ETH");
```

### Admin Operations

```javascript
// Withdraw accumulated fees
await market.withdrawFees();

// Update curve parameters
await market.updateCurveParameters(
  ethers.parseEther("0.002"),
  ethers.parseEther("0.0002")
);

// Update fee parameters
await market.updateFeeParameters(300, 300); // 3% fees

// Pause trading
await market.pause();

// Unpause trading
await market.unpause();
```

## Testing

Run the comprehensive test suite:

```bash
# Run all tests
npx hardhat test

# Run with coverage
npx hardhat coverage

# Run specific test file
npx hardhat test test/BondingCurveMarket.test.js

# Run with gas reporting
REPORT_GAS=true npx hardhat test
```

## Architecture

### Bonding Curve Formula

**Buy Price Calculation:**
```
price(supply) = basePrice + slope × supply

totalCost = ∫[supply to supply+amount] price(s) ds
         = basePrice × amount + slope × amount × (2×supply + amount) / 2
```

**Sell Price Calculation:**
```
Symmetric to buy, calculated from (supply - amount) to supply
```

### Fee Structure

Fees are calculated in basis points (bps):
- 100 bps = 1%
- Maximum fee: 1000 bps (10%)

**Buy Fee:** Applied to base cost
```
totalCost = cost + (cost × buyFeeBps / 10000)
```

**Sell Fee:** Deducted from proceeds
```
netProceeds = proceeds - (proceeds × sellFeeBps / 10000)
```

### State Management

```solidity
// Core state
IERC20 public token;           // Market token
uint256 public basePrice;      // Starting price
uint256 public slope;          // Price increase rate
uint256 public totalSupply;    // Tokens in circulation

// Fee state
uint256 public buyFeeBps;      // Buy fee (basis points)
uint256 public sellFeeBps;     // Sell fee (basis points)
address public feeRecipient;   // Fee destination
uint256 public accumulatedFees;// Total fees collected
```

## Events

```solidity
event Buy(address indexed buyer, uint256 amount, uint256 cost, uint256 fee);
event Sell(address indexed seller, uint256 amount, uint256 proceeds, uint256 fee);
event FeeWithdrawal(address indexed recipient, uint256 amount);
event CurveParametersUpdated(uint256 basePrice, uint256 slope);
event FeeParametersUpdated(uint256 buyFeeBps, uint256 sellFeeBps);
event FeeRecipientUpdated(address indexed newRecipient);
```

## Security Considerations

### Auditing Checklist
- ✅ Reentrancy protection on all state-changing functions
- ✅ Input validation on all user-supplied parameters
- ✅ Integer overflow protection (Solidity 0.8+)
- ✅ Access control on admin functions
- ✅ Emergency pause mechanism
- ✅ Slippage protection on trades

### Known Limitations
- **Price Impact**: Large trades significantly impact price on linear curves
- **Liquidity**: Market must hold sufficient tokens for sells
- **Front-running**: Transactions visible in mempool before execution
- **Parameter Changes**: Admin can modify curve parameters

### Best Practices
1. Always use `getBuyQuote`/`getSellQuote` before trading
2. Set appropriate slippage tolerance (5-10% typical)
3. Monitor accumulated fees and withdraw regularly
4. Test parameter changes on testnet first
5. Use multisig for owner address in production

## Gas Optimization

Approximate gas costs (may vary by network):
- **Buy**: ~80,000 gas
- **Sell**: ~85,000 gas
- **Get Quote**: ~30,000 gas (view function)
- **Withdraw Fees**: ~35,000 gas

## Integration Examples

See `examples/` directory for:
- Frontend integration with ethers.js
- Backend integration with Node.js
- Price chart generation
- Liquidity analysis tools

## Troubleshooting

### Common Issues

**"Insufficient ETH sent"**
- Ensure msg.value >= totalCost from quote
- Account for gas price fluctuations

**"Cost exceeds max"**
- Price moved between quote and execution
- Increase maxCost parameter or retry

**"Proceeds below min"**
- Price moved between quote and execution
- Decrease minProceeds or retry

**"Insufficient supply"**
- Cannot sell more than current totalSupply
- Check current supply before selling

## License

MIT License - see LICENSE file for details

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## Support

- Documentation: See `docs/` directory
- Issues: GitHub Issues
- Discussions: GitHub Discussions

## Changelog

### v1.0.0 (Initial Release)
- Linear bonding curve implementation
- Buy/sell functionality
- Fee system with collection
- Admin controls
- Comprehensive test suite
- Deployment scripts
- Full documentation
