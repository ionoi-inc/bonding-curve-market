/**
 * Backend Integration Example for BondingCurveMarket
 * 
 * This example demonstrates how to integrate with the BondingCurveMarket
 * from a Node.js backend for monitoring, analytics, and automated trading.
 */

const { ethers } = require('ethers');

// Contract ABIs
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
  "function accumulatedFees() external view returns (uint256)",
  "event Buy(address indexed buyer, uint256 amount, uint256 cost, uint256 fee)",
  "event Sell(address indexed seller, uint256 amount, uint256 proceeds, uint256 fee)"
];

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)"
];

/**
 * Market Monitor - Track market activity and analytics
 */
class MarketMonitor {
  constructor(marketAddress, tokenAddress, provider) {
    this.market = new ethers.Contract(marketAddress, BONDING_CURVE_ABI, provider);
    this.token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    this.provider = provider;
  }

  /**
   * Get comprehensive market stats
   */
  async getMarketStats() {
    const [
      buyPrice,
      sellPrice,
      supply,
      basePrice,
      slope,
      accumulatedFees,
      symbol,
      decimals,
      ethBalance
    ] = await Promise.all([
      this.market.getCurrentBuyPrice(),
      this.market.getCurrentSellPrice(),
      this.market.totalSupply(),
      this.market.basePrice(),
      this.market.slope(),
      this.market.accumulatedFees(),
      this.token.symbol(),
      this.token.decimals(),
      this.provider.getBalance(await this.market.getAddress())
    ]);

    return {
      token: {
        symbol,
        decimals: Number(decimals)
      },
      pricing: {
        buyPrice: ethers.formatEther(buyPrice),
        sellPrice: ethers.formatEther(sellPrice),
        spread: ethers.formatEther(buyPrice - sellPrice),
        spreadPercent: Number(buyPrice - sellPrice) * 100 / Number(buyPrice)
      },
      curve: {
        basePrice: ethers.formatEther(basePrice),
        slope: ethers.formatEther(slope)
      },
      supply: {
        total: ethers.formatUnits(supply, decimals),
        totalRaw: supply.toString()
      },
      fees: {
        accumulated: ethers.formatEther(accumulatedFees),
        accumulatedRaw: accumulatedFees.toString()
      },
      liquidity: {
        ethBalance: ethers.formatEther(ethBalance),
        ethBalanceRaw: ethBalance.toString()
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Monitor events in real-time
   */
  async startEventMonitoring(callbacks) {
    console.log('Starting event monitoring...');

    // Listen for Buy events
    this.market.on('Buy', async (buyer, amount, cost, fee, event) => {
      const data = {
        type: 'BUY',
        buyer,
        amount: amount.toString(),
        cost: ethers.formatEther(cost),
        fee: ethers.formatEther(fee),
        blockNumber: event.log.blockNumber,
        txHash: event.log.transactionHash,
        timestamp: new Date().toISOString()
      };

      if (callbacks.onBuy) {
        await callbacks.onBuy(data);
      }
      
      console.log('Buy Event:', data);
    });

    // Listen for Sell events
    this.market.on('Sell', async (seller, amount, proceeds, fee, event) => {
      const data = {
        type: 'SELL',
        seller,
        amount: amount.toString(),
        proceeds: ethers.formatEther(proceeds),
        fee: ethers.formatEther(fee),
        blockNumber: event.log.blockNumber,
        txHash: event.log.transactionHash,
        timestamp: new Date().toISOString()
      };

      if (callbacks.onSell) {
        await callbacks.onSell(data);
      }
      
      console.log('Sell Event:', data);
    });
  }

  /**
   * Get historical events
   */
  async getHistoricalEvents(fromBlock = 0, toBlock = 'latest') {
    const buyFilter = this.market.filters.Buy();
    const sellFilter = this.market.filters.Sell();

    const [buyEvents, sellEvents] = await Promise.all([
      this.market.queryFilter(buyFilter, fromBlock, toBlock),
      this.market.queryFilter(sellFilter, fromBlock, toBlock)
    ]);

    const events = [
      ...buyEvents.map(e => ({
        type: 'BUY',
        buyer: e.args.buyer,
        amount: e.args.amount.toString(),
        cost: ethers.formatEther(e.args.cost),
        fee: ethers.formatEther(e.args.fee),
        blockNumber: e.blockNumber,
        txHash: e.transactionHash
      })),
      ...sellEvents.map(e => ({
        type: 'SELL',
        seller: e.args.seller,
        amount: e.args.amount.toString(),
        proceeds: ethers.formatEther(e.args.proceeds),
        fee: ethers.formatEther(e.args.fee),
        blockNumber: e.blockNumber,
        txHash: e.transactionHash
      }))
    ];

    // Sort by block number
    events.sort((a, b) => a.blockNumber - b.blockNumber);

    return events;
  }

  /**
   * Calculate trading volume and metrics
   */
  async calculateMetrics(events) {
    const buyEvents = events.filter(e => e.type === 'BUY');
    const sellEvents = events.filter(e => e.type === 'SELL');

    const buyVolume = buyEvents.reduce((sum, e) => sum + parseFloat(e.cost), 0);
    const sellVolume = sellEvents.reduce((sum, e) => sum + parseFloat(e.proceeds), 0);
    const totalFees = events.reduce((sum, e) => sum + parseFloat(e.fee), 0);

    return {
      trades: {
        total: events.length,
        buys: buyEvents.length,
        sells: sellEvents.length
      },
      volume: {
        buy: buyVolume.toFixed(4),
        sell: sellVolume.toFixed(4),
        total: (buyVolume + sellVolume).toFixed(4)
      },
      fees: {
        total: totalFees.toFixed(4)
      },
      uniqueUsers: new Set([
        ...buyEvents.map(e => e.buyer),
        ...sellEvents.map(e => e.seller)
      ]).size
    };
  }
}

/**
 * Automated Trading Bot - Execute trades based on conditions
 */
class TradingBot {
  constructor(marketAddress, tokenAddress, wallet) {
    this.market = new ethers.Contract(marketAddress, BONDING_CURVE_ABI, wallet);
    this.token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    this.wallet = wallet;
  }

  /**
   * Execute buy with retry logic
   */
  async executeBuy(amount, slippagePercent = 5, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Buy attempt ${attempt}/${maxRetries}...`);

        // Get quote
        const decimals = await this.token.decimals();
        const amountWei = ethers.parseUnits(amount.toString(), decimals);
        const quote = await this.market.getBuyQuote(amountWei);

        // Calculate max cost with slippage
        const slippageMultiplier = BigInt(100 + slippagePercent) * BigInt(100);
        const maxCost = quote.totalCost * slippageMultiplier / BigInt(10000);

        // Execute
        const tx = await this.market.buy(amountWei, maxCost, {
          value: maxCost,
          gasLimit: 200000
        });

        console.log(`Buy submitted: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`Buy confirmed in block ${receipt.blockNumber}`);

        return {
          success: true,
          txHash: receipt.hash,
          blockNumber: receipt.blockNumber
        };

      } catch (error) {
        console.error(`Buy attempt ${attempt} failed:`, error.message);
        
        if (attempt === maxRetries) {
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  /**
   * Execute sell with retry logic
   */
  async executeSell(amount, slippagePercent = 5, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Sell attempt ${attempt}/${maxRetries}...`);

        // Get decimals and convert amount
        const decimals = await this.token.decimals();
        const amountWei = ethers.parseUnits(amount.toString(), decimals);

        // Check and approve if needed
        const allowance = await this.token.allowance(
          this.wallet.address,
          await this.market.getAddress()
        );

        if (allowance < amountWei) {
          console.log('Approving tokens...');
          const approveTx = await this.token.approve(
            await this.market.getAddress(),
            amountWei
          );
          await approveTx.wait();
          console.log('Approval confirmed');
        }

        // Get quote
        const quote = await this.market.getSellQuote(amountWei);

        // Calculate min proceeds with slippage
        const slippageMultiplier = BigInt(100 - slippagePercent) * BigInt(100);
        const minProceeds = quote.netProceeds * slippageMultiplier / BigInt(10000);

        // Execute
        const tx = await this.market.sell(amountWei, minProceeds, {
          gasLimit: 200000
        });

        console.log(`Sell submitted: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`Sell confirmed in block ${receipt.blockNumber}`);

        return {
          success: true,
          txHash: receipt.hash,
          blockNumber: receipt.blockNumber
        };

      } catch (error) {
        console.error(`Sell attempt ${attempt} failed:`, error.message);
        
        if (attempt === maxRetries) {
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  /**
   * Market making strategy - maintain liquidity
   */
  async runMarketMaker(config) {
    const {
      targetSpread = 0.01, // 1% target spread
      orderSize = 10,
      checkInterval = 60000 // 1 minute
    } = config;

    console.log('Starting market maker...');
    console.log('Config:', config);

    while (true) {
      try {
        const buyPrice = await this.market.getCurrentBuyPrice();
        const sellPrice = await this.market.getCurrentSellPrice();
        const spread = Number(buyPrice - sellPrice) / Number(buyPrice);

        console.log(`Current spread: ${(spread * 100).toFixed(2)}%`);

        if (spread > targetSpread) {
          console.log('Spread too wide, placing orders...');
          
          // Could implement more sophisticated market making logic here
          // For example: place buy orders slightly above current sell price
          // and sell orders slightly below current buy price
        }

      } catch (error) {
        console.error('Market maker error:', error.message);
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }
}

/**
 * Price Alert System
 */
class PriceAlertSystem {
  constructor(marketAddress, tokenAddress, provider) {
    this.market = new ethers.Contract(marketAddress, BONDING_CURVE_ABI, provider);
    this.alerts = [];
  }

  /**
   * Add price alert
   */
  addAlert(config) {
    const alert = {
      id: Date.now(),
      type: config.type, // 'ABOVE' or 'BELOW'
      price: config.price,
      callback: config.callback,
      triggered: false
    };

    this.alerts.push(alert);
    return alert.id;
  }

  /**
   * Start monitoring prices
   */
  async startMonitoring(interval = 10000) {
    console.log('Starting price monitoring...');

    setInterval(async () => {
      try {
        const buyPrice = await this.market.getCurrentBuyPrice();
        const priceEth = parseFloat(ethers.formatEther(buyPrice));

        for (const alert of this.alerts) {
          if (alert.triggered) continue;

          if (
            (alert.type === 'ABOVE' && priceEth >= alert.price) ||
            (alert.type === 'BELOW' && priceEth <= alert.price)
          ) {
            alert.triggered = true;
            alert.callback({
              alertId: alert.id,
              type: alert.type,
              targetPrice: alert.price,
              currentPrice: priceEth,
              timestamp: new Date().toISOString()
            });
          }
        }

        // Remove triggered alerts
        this.alerts = this.alerts.filter(a => !a.triggered);

      } catch (error) {
        console.error('Price monitoring error:', error.message);
      }
    }, interval);
  }
}

/**
 * Example Usage
 */
async function exampleUsage() {
  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const MARKET_ADDRESS = process.env.MARKET_ADDRESS;
  const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;

  // 1. Market Monitoring
  console.log('\n=== Market Monitoring ===');
  const monitor = new MarketMonitor(MARKET_ADDRESS, TOKEN_ADDRESS, provider);
  
  const stats = await monitor.getMarketStats();
  console.log('Market Stats:', JSON.stringify(stats, null, 2));

  // Start real-time monitoring
  await monitor.startEventMonitoring({
    onBuy: async (data) => {
      console.log('Buy detected:', data);
      // Send notification, update database, etc.
    },
    onSell: async (data) => {
      console.log('Sell detected:', data);
      // Send notification, update database, etc.
    }
  });

  // 2. Historical Analysis
  console.log('\n=== Historical Analysis ===');
  const events = await monitor.getHistoricalEvents(0, 'latest');
  const metrics = await monitor.calculateMetrics(events);
  console.log('Trading Metrics:', JSON.stringify(metrics, null, 2));

  // 3. Automated Trading
  console.log('\n=== Automated Trading ===');
  const bot = new TradingBot(MARKET_ADDRESS, TOKEN_ADDRESS, wallet);
  
  try {
    const buyResult = await bot.executeBuy(10, 5); // Buy 10 tokens with 5% slippage
    console.log('Buy Result:', buyResult);
  } catch (error) {
    console.error('Buy failed:', error.message);
  }

  // 4. Price Alerts
  console.log('\n=== Price Alerts ===');
  const alertSystem = new PriceAlertSystem(MARKET_ADDRESS, TOKEN_ADDRESS, provider);
  
  alertSystem.addAlert({
    type: 'ABOVE',
    price: 0.002,
    callback: (data) => {
      console.log('ALERT: Price above 0.002 ETH!', data);
      // Send email, webhook, etc.
    }
  });

  await alertSystem.startMonitoring(10000);
}

// Export classes
module.exports = {
  MarketMonitor,
  TradingBot,
  PriceAlertSystem,
  exampleUsage
};

// Run example if called directly
if (require.main === module) {
  exampleUsage().catch(console.error);
}
