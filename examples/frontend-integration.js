/**
 * Frontend Integration Example for BondingCurveMarket
 * 
 * This example demonstrates how to integrate the BondingCurveMarket
 * contract into a web3 frontend application using ethers.js
 */

import { ethers } from 'ethers';

// Contract ABI (minimal - include only functions you need)
const BONDING_CURVE_ABI = [
  "function buy(uint256 amount, uint256 maxCost) external payable",
  "function sell(uint256 amount, uint256 minProceeds) external",
  "function getBuyQuote(uint256 amount) external view returns (uint256 cost, uint256 fee, uint256 totalCost)",
  "function getSellQuote(uint256 amount) external view returns (uint256 proceeds, uint256 fee, uint256 netProceeds)",
  "function getCurrentBuyPrice() external view returns (uint256)",
  "function getCurrentSellPrice() external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function basePrice() external view returns (uint256)",
  "function slope() external view returns (uint256)",
  "function buyFeeBps() external view returns (uint256)",
  "function sellFeeBps() external view returns (uint256)",
  "event Buy(address indexed buyer, uint256 amount, uint256 cost, uint256 fee)",
  "event Sell(address indexed seller, uint256 amount, uint256 proceeds, uint256 fee)"
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)"
];

class BondingCurveMarket {
  constructor(marketAddress, tokenAddress, provider) {
    this.marketAddress = marketAddress;
    this.tokenAddress = tokenAddress;
    this.provider = provider;
    
    // Create contract instances
    this.market = new ethers.Contract(marketAddress, BONDING_CURVE_ABI, provider);
    this.token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  }

  /**
   * Connect wallet and get signer
   */
  async connectWallet() {
    if (!window.ethereum) {
      throw new Error('MetaMask not installed');
    }

    await window.ethereum.request({ method: 'eth_requestAccounts' });
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    
    // Update contract instances with signer
    this.market = this.market.connect(signer);
    this.token = this.token.connect(signer);
    
    return signer;
  }

  /**
   * Get current market information
   */
  async getMarketInfo() {
    const [buyPrice, sellPrice, supply, basePrice, slope, buyFee, sellFee, symbol, decimals] = 
      await Promise.all([
        this.market.getCurrentBuyPrice(),
        this.market.getCurrentSellPrice(),
        this.market.totalSupply(),
        this.market.basePrice(),
        this.market.slope(),
        this.market.buyFeeBps(),
        this.market.sellFeeBps(),
        this.token.symbol(),
        this.token.decimals()
      ]);

    return {
      buyPrice: ethers.formatEther(buyPrice),
      sellPrice: ethers.formatEther(sellPrice),
      supply: ethers.formatUnits(supply, decimals),
      basePrice: ethers.formatEther(basePrice),
      slope: ethers.formatEther(slope),
      buyFeePercent: Number(buyFee) / 100,
      sellFeePercent: Number(sellFee) / 100,
      tokenSymbol: symbol,
      tokenDecimals: Number(decimals)
    };
  }

  /**
   * Get buy quote with formatted values
   */
  async getBuyQuote(amount) {
    const decimals = await this.token.decimals();
    const amountWei = ethers.parseUnits(amount.toString(), decimals);
    
    const quote = await this.market.getBuyQuote(amountWei);
    
    return {
      amount: amount,
      cost: ethers.formatEther(quote.cost),
      fee: ethers.formatEther(quote.fee),
      totalCost: ethers.formatEther(quote.totalCost),
      averagePrice: ethers.formatEther(quote.totalCost / amountWei * BigInt(10 ** decimals))
    };
  }

  /**
   * Get sell quote with formatted values
   */
  async getSellQuote(amount) {
    const decimals = await this.token.decimals();
    const amountWei = ethers.parseUnits(amount.toString(), decimals);
    
    const quote = await this.market.getSellQuote(amountWei);
    
    return {
      amount: amount,
      proceeds: ethers.formatEther(quote.proceeds),
      fee: ethers.formatEther(quote.fee),
      netProceeds: ethers.formatEther(quote.netProceeds),
      averagePrice: ethers.formatEther(quote.netProceeds / amountWei * BigInt(10 ** decimals))
    };
  }

  /**
   * Execute buy with slippage protection
   */
  async buy(amount, slippagePercent = 5) {
    const decimals = await this.token.decimals();
    const amountWei = ethers.parseUnits(amount.toString(), decimals);
    
    // Get quote
    const quote = await this.market.getBuyQuote(amountWei);
    
    // Apply slippage
    const slippageMultiplier = BigInt(100 + slippagePercent) * BigInt(100);
    const maxCost = quote.totalCost * slippageMultiplier / BigInt(10000);
    
    // Execute buy
    const tx = await this.market.buy(amountWei, maxCost, {
      value: maxCost
    });
    
    console.log('Buy transaction submitted:', tx.hash);
    
    // Wait for confirmation
    const receipt = await tx.wait();
    console.log('Buy transaction confirmed:', receipt.hash);
    
    // Parse event
    const event = receipt.logs
      .map(log => {
        try {
          return this.market.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find(event => event && event.name === 'Buy');
    
    if (event) {
      return {
        success: true,
        txHash: receipt.hash,
        amount: ethers.formatUnits(event.args.amount, decimals),
        cost: ethers.formatEther(event.args.cost),
        fee: ethers.formatEther(event.args.fee)
      };
    }
    
    return { success: true, txHash: receipt.hash };
  }

  /**
   * Execute sell with slippage protection
   */
  async sell(amount, slippagePercent = 5) {
    const decimals = await this.token.decimals();
    const amountWei = ethers.parseUnits(amount.toString(), decimals);
    
    // Check and approve if needed
    const allowance = await this.token.allowance(
      await this.market.runner.getAddress(),
      this.marketAddress
    );
    
    if (allowance < amountWei) {
      console.log('Approving tokens...');
      const approveTx = await this.token.approve(this.marketAddress, amountWei);
      await approveTx.wait();
      console.log('Approval confirmed');
    }
    
    // Get quote
    const quote = await this.market.getSellQuote(amountWei);
    
    // Apply slippage
    const slippageMultiplier = BigInt(100 - slippagePercent) * BigInt(100);
    const minProceeds = quote.netProceeds * slippageMultiplier / BigInt(10000);
    
    // Execute sell
    const tx = await this.market.sell(amountWei, minProceeds);
    
    console.log('Sell transaction submitted:', tx.hash);
    
    // Wait for confirmation
    const receipt = await tx.wait();
    console.log('Sell transaction confirmed:', receipt.hash);
    
    // Parse event
    const event = receipt.logs
      .map(log => {
        try {
          return this.market.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find(event => event && event.name === 'Sell');
    
    if (event) {
      return {
        success: true,
        txHash: receipt.hash,
        amount: ethers.formatUnits(event.args.amount, decimals),
        proceeds: ethers.formatEther(event.args.proceeds),
        fee: ethers.formatEther(event.args.fee)
      };
    }
    
    return { success: true, txHash: receipt.hash };
  }

  /**
   * Get user's token balance
   */
  async getUserBalance(address) {
    const balance = await this.token.balanceOf(address);
    const decimals = await this.token.decimals();
    return ethers.formatUnits(balance, decimals);
  }

  /**
   * Listen for Buy events
   */
  onBuy(callback) {
    this.market.on('Buy', (buyer, amount, cost, fee, event) => {
      callback({
        buyer,
        amount: amount.toString(),
        cost: cost.toString(),
        fee: fee.toString(),
        event
      });
    });
  }

  /**
   * Listen for Sell events
   */
  onSell(callback) {
    this.market.on('Sell', (seller, amount, proceeds, fee, event) => {
      callback({
        seller,
        amount: amount.toString(),
        proceeds: proceeds.toString(),
        fee: fee.toString(),
        event
      });
    });
  }

  /**
   * Calculate price chart data points
   */
  async calculatePriceChart(maxSupply, points = 100) {
    const basePrice = await this.market.basePrice();
    const slope = await this.market.slope();
    const currentSupply = await this.market.totalSupply();
    const decimals = await this.token.decimals();
    
    const data = [];
    const step = maxSupply / points;
    
    for (let i = 0; i <= points; i++) {
      const supply = BigInt(Math.floor(i * step));
      const price = basePrice + slope * supply / BigInt(10 ** decimals);
      
      data.push({
        supply: Number(ethers.formatUnits(supply, decimals)),
        price: Number(ethers.formatEther(price)),
        isCurrent: supply === currentSupply
      });
    }
    
    return data;
  }
}

// Usage Example
async function example() {
  // Initialize
  const MARKET_ADDRESS = '0x...';
  const TOKEN_ADDRESS = '0x...';
  
  const provider = new ethers.BrowserProvider(window.ethereum);
  const market = new BondingCurveMarket(MARKET_ADDRESS, TOKEN_ADDRESS, provider);
  
  // Connect wallet
  const signer = await market.connectWallet();
  console.log('Connected:', await signer.getAddress());
  
  // Get market info
  const info = await market.getMarketInfo();
  console.log('Market Info:', info);
  
  // Get buy quote
  const buyQuote = await market.getBuyQuote(10);
  console.log('Buy Quote for 10 tokens:', buyQuote);
  
  // Execute buy with 5% slippage
  const buyResult = await market.buy(10, 5);
  console.log('Buy Result:', buyResult);
  
  // Get sell quote
  const sellQuote = await market.getSellQuote(5);
  console.log('Sell Quote for 5 tokens:', sellQuote);
  
  // Execute sell with 5% slippage
  const sellResult = await market.sell(5, 5);
  console.log('Sell Result:', sellResult);
  
  // Get price chart
  const chartData = await market.calculatePriceChart(10000, 100);
  console.log('Chart Data:', chartData);
  
  // Listen for events
  market.onBuy((data) => {
    console.log('Buy event:', data);
  });
  
  market.onSell((data) => {
    console.log('Sell event:', data);
  });
}

// React Component Example
class BondingCurveWidget extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      connected: false,
      buyAmount: '',
      sellAmount: '',
      buyQuote: null,
      sellQuote: null,
      marketInfo: null,
      loading: false
    };
    
    this.market = new BondingCurveMarket(
      props.marketAddress,
      props.tokenAddress,
      props.provider
    );
  }

  async componentDidMount() {
    await this.loadMarketInfo();
  }

  async connectWallet() {
    try {
      await this.market.connectWallet();
      this.setState({ connected: true });
      await this.loadMarketInfo();
    } catch (error) {
      console.error('Failed to connect wallet:', error);
    }
  }

  async loadMarketInfo() {
    const info = await this.market.getMarketInfo();
    this.setState({ marketInfo: info });
  }

  async updateBuyQuote(amount) {
    if (!amount || amount <= 0) {
      this.setState({ buyQuote: null });
      return;
    }
    
    try {
      const quote = await this.market.getBuyQuote(amount);
      this.setState({ buyQuote: quote });
    } catch (error) {
      console.error('Failed to get buy quote:', error);
    }
  }

  async updateSellQuote(amount) {
    if (!amount || amount <= 0) {
      this.setState({ sellQuote: null });
      return;
    }
    
    try {
      const quote = await this.market.getSellQuote(amount);
      this.setState({ sellQuote: quote });
    } catch (error) {
      console.error('Failed to get sell quote:', error);
    }
  }

  async executeBuy() {
    if (!this.state.buyAmount) return;
    
    this.setState({ loading: true });
    try {
      const result = await this.market.buy(this.state.buyAmount, 5);
      alert(`Buy successful! Tx: ${result.txHash}`);
      await this.loadMarketInfo();
      this.setState({ buyAmount: '', buyQuote: null });
    } catch (error) {
      alert(`Buy failed: ${error.message}`);
    } finally {
      this.setState({ loading: false });
    }
  }

  async executeSell() {
    if (!this.state.sellAmount) return;
    
    this.setState({ loading: true });
    try {
      const result = await this.market.sell(this.state.sellAmount, 5);
      alert(`Sell successful! Tx: ${result.txHash}`);
      await this.loadMarketInfo();
      this.setState({ sellAmount: '', sellQuote: null });
    } catch (error) {
      alert(`Sell failed: ${error.message}`);
    } finally {
      this.setState({ loading: false });
    }
  }

  render() {
    const { connected, marketInfo, buyAmount, sellAmount, buyQuote, sellQuote, loading } = this.state;

    return (
      <div className="bonding-curve-widget">
        {!connected ? (
          <button onClick={() => this.connectWallet()}>
            Connect Wallet
          </button>
        ) : (
          <>
            <div className="market-info">
              <h3>Market Information</h3>
              {marketInfo && (
                <>
                  <p>Token: {marketInfo.tokenSymbol}</p>
                  <p>Current Buy Price: {marketInfo.buyPrice} ETH</p>
                  <p>Current Sell Price: {marketInfo.sellPrice} ETH</p>
                  <p>Total Supply: {marketInfo.supply}</p>
                  <p>Buy Fee: {marketInfo.buyFeePercent}%</p>
                  <p>Sell Fee: {marketInfo.sellFeePercent}%</p>
                </>
              )}
            </div>

            <div className="buy-section">
              <h3>Buy Tokens</h3>
              <input
                type="number"
                value={buyAmount}
                onChange={(e) => {
                  this.setState({ buyAmount: e.target.value });
                  this.updateBuyQuote(e.target.value);
                }}
                placeholder="Amount"
                disabled={loading}
              />
              {buyQuote && (
                <div className="quote">
                  <p>Cost: {buyQuote.totalCost} ETH</p>
                  <p>Fee: {buyQuote.fee} ETH</p>
                  <p>Avg Price: {buyQuote.averagePrice} ETH</p>
                </div>
              )}
              <button onClick={() => this.executeBuy()} disabled={loading || !buyAmount}>
                {loading ? 'Processing...' : 'Buy'}
              </button>
            </div>

            <div className="sell-section">
              <h3>Sell Tokens</h3>
              <input
                type="number"
                value={sellAmount}
                onChange={(e) => {
                  this.setState({ sellAmount: e.target.value });
                  this.updateSellQuote(e.target.value);
                }}
                placeholder="Amount"
                disabled={loading}
              />
              {sellQuote && (
                <div className="quote">
                  <p>Proceeds: {sellQuote.netProceeds} ETH</p>
                  <p>Fee: {sellQuote.fee} ETH</p>
                  <p>Avg Price: {sellQuote.averagePrice} ETH</p>
                </div>
              )}
              <button onClick={() => this.executeSell()} disabled={loading || !sellAmount}>
                {loading ? 'Processing...' : 'Sell'}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }
}

export { BondingCurveMarket, BondingCurveWidget };
