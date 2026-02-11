const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("BondingCurveMarket", function () {
  // Fixture for deploying the contract
  async function deployMarketFixture() {
    const [owner, treasury, user1, user2, user3] = await ethers.getSigners();

    // Deploy mock token
    const MockToken = await ethers.getContractFactory("MockERC20");
    const token = await MockToken.deploy("Market Token", "MKT", ethers.parseEther("1000000"));

    // Deploy bonding curve market
    const basePrice = ethers.parseEther("0.001"); // 0.001 ETH base price
    const slope = ethers.parseEther("0.0001"); // 0.0001 ETH per token slope
    const buyFee = 250; // 2.5%
    const sellFee = 250; // 2.5%

    const BondingCurveMarket = await ethers.getContractFactory("BondingCurveMarket");
    const market = await BondingCurveMarket.deploy(
      await token.getAddress(),
      basePrice,
      slope,
      buyFee,
      sellFee,
      treasury.address
    );

    // Transfer tokens to market for selling
    await token.transfer(await market.getAddress(), ethers.parseEther("100000"));

    return { market, token, owner, treasury, user1, user2, user3, basePrice, slope, buyFee, sellFee };
  }

  describe("Deployment", function () {
    it("Should set the correct token address", async function () {
      const { market, token } = await loadFixture(deployMarketFixture);
      expect(await market.token()).to.equal(await token.getAddress());
    });

    it("Should set the correct curve parameters", async function () {
      const { market, basePrice, slope } = await loadFixture(deployMarketFixture);
      expect(await market.basePrice()).to.equal(basePrice);
      expect(await market.slope()).to.equal(slope);
    });

    it("Should set the correct fee parameters", async function () {
      const { market, buyFee, sellFee } = await loadFixture(deployMarketFixture);
      expect(await market.buyFeeBps()).to.equal(buyFee);
      expect(await market.sellFeeBps()).to.equal(sellFee);
    });

    it("Should set the correct treasury", async function () {
      const { market, treasury } = await loadFixture(deployMarketFixture);
      expect(await market.feeRecipient()).to.equal(treasury.address);
    });

    it("Should initialize with zero supply", async function () {
      const { market } = await loadFixture(deployMarketFixture);
      expect(await market.totalSupply()).to.equal(0);
    });
  });

  describe("Price Calculations", function () {
    it("Should calculate correct buy price at zero supply", async function () {
      const { market, basePrice } = await loadFixture(deployMarketFixture);
      const price = await market.getCurrentBuyPrice();
      expect(price).to.equal(basePrice);
    });

    it("Should calculate correct buy price after purchases", async function () {
      const { market, basePrice, slope } = await loadFixture(deployMarketFixture);
      
      // Buy 100 tokens
      const amount = ethers.parseEther("100");
      const quote = await market.getBuyQuote(amount);
      await market.connect(await ethers.provider.getSigner(1)).buy(amount, quote.totalCost, { value: quote.totalCost });

      // Price should be basePrice + (slope * 100)
      const expectedPrice = basePrice + (slope * 100n);
      const currentPrice = await market.getCurrentBuyPrice();
      expect(currentPrice).to.equal(expectedPrice);
    });

    it("Should calculate correct sell price", async function () {
      const { market, basePrice, slope, user1 } = await loadFixture(deployMarketFixture);
      
      // Buy 100 tokens first
      const buyAmount = ethers.parseEther("100");
      const buyQuote = await market.getBuyQuote(buyAmount);
      await market.connect(user1).buy(buyAmount, buyQuote.totalCost, { value: buyQuote.totalCost });

      // Sell price should be basePrice + (slope * (100 - 1)) because we're selling from supply 100
      const supply = await market.totalSupply();
      const expectedSellPrice = basePrice + (slope * (supply - 1n));
      const sellPrice = await market.getCurrentSellPrice();
      expect(sellPrice).to.equal(expectedSellPrice);
    });
  });

  describe("Buy Functionality", function () {
    it("Should allow buying tokens with correct ETH amount", async function () {
      const { market, token, user1 } = await loadFixture(deployMarketFixture);
      
      const amount = ethers.parseEther("10");
      const quote = await market.getBuyQuote(amount);
      
      await expect(
        market.connect(user1).buy(amount, quote.totalCost, { value: quote.totalCost })
      ).to.changeTokenBalance(token, user1, amount);
    });

    it("Should update total supply after buy", async function () {
      const { market, user1 } = await loadFixture(deployMarketFixture);
      
      const amount = ethers.parseEther("10");
      const quote = await market.getBuyQuote(amount);
      await market.connect(user1).buy(amount, quote.totalCost, { value: quote.totalCost });
      
      expect(await market.totalSupply()).to.equal(amount);
    });

    it("Should collect fees on buy", async function () {
      const { market, user1 } = await loadFixture(deployMarketFixture);
      
      const amount = ethers.parseEther("10");
      const quote = await market.getBuyQuote(amount);
      
      await market.connect(user1).buy(amount, quote.totalCost, { value: quote.totalCost });
      
      expect(await market.accumulatedFees()).to.equal(quote.fee);
    });

    it("Should refund excess ETH", async function () {
      const { market, user1 } = await loadFixture(deployMarketFixture);
      
      const amount = ethers.parseEther("10");
      const quote = await market.getBuyQuote(amount);
      const excess = ethers.parseEther("1");
      
      await expect(
        market.connect(user1).buy(amount, quote.totalCost, { value: quote.totalCost + excess })
      ).to.changeEtherBalance(user1, -(quote.totalCost));
    });

    it("Should revert if slippage exceeded", async function () {
      const { market, user1 } = await loadFixture(deployMarketFixture);
      
      const amount = ethers.parseEther("10");
      const quote = await market.getBuyQuote(amount);
      const lowMax = quote.totalCost - 1n;
      
      await expect(
        market.connect(user1).buy(amount, lowMax, { value: quote.totalCost })
      ).to.be.revertedWith("Cost exceeds max");
    });

    it("Should revert if insufficient ETH sent", async function () {
      const { market, user1 } = await loadFixture(deployMarketFixture);
      
      const amount = ethers.parseEther("10");
      const quote = await market.getBuyQuote(amount);
      
      await expect(
        market.connect(user1).buy(amount, quote.totalCost, { value: quote.totalCost - 1n })
      ).to.be.revertedWith("Insufficient ETH sent");
    });

    it("Should revert on zero amount", async function () {
      const { market, user1 } = await loadFixture(deployMarketFixture);
      
      await expect(
        market.connect(user1).buy(0, 0, { value: 0 })
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("Should emit Buy event", async function () {
      const { market, user1 } = await loadFixture(deployMarketFixture);
      
      const amount = ethers.parseEther("10");
      const quote = await market.getBuyQuote(amount);
      
      await expect(
        market.connect(user1).buy(amount, quote.totalCost, { value: quote.totalCost })
      ).to.emit(market, "Buy")
        .withArgs(user1.address, amount, quote.cost, quote.fee);
    });
  });

  describe("Sell Functionality", function () {
    it("Should allow selling tokens", async function () {
      const { market, token, user1 } = await loadFixture(deployMarketFixture);
      
      // Buy first
      const buyAmount = ethers.parseEther("100");
      const buyQuote = await market.getBuyQuote(buyAmount);
      await market.connect(user1).buy(buyAmount, buyQuote.totalCost, { value: buyQuote.totalCost });
      
      // Then sell
      const sellAmount = ethers.parseEther("50");
      await token.connect(user1).approve(await market.getAddress(), sellAmount);
      const sellQuote = await market.getSellQuote(sellAmount);
      
      await expect(
        market.connect(user1).sell(sellAmount, sellQuote.netProceeds)
      ).to.changeTokenBalance(token, user1, -sellAmount);
    });

    it("Should transfer ETH to seller", async function () {
      const { market, token, user1 } = await loadFixture(deployMarketFixture);
      
      // Buy first
      const buyAmount = ethers.parseEther("100");
      const buyQuote = await market.getBuyQuote(buyAmount);
      await market.connect(user1).buy(buyAmount, buyQuote.totalCost, { value: buyQuote.totalCost });
      
      // Then sell
      const sellAmount = ethers.parseEther("50");
      await token.connect(user1).approve(await market.getAddress(), sellAmount);
      const sellQuote = await market.getSellQuote(sellAmount);
      
      await expect(
        market.connect(user1).sell(sellAmount, sellQuote.netProceeds)
      ).to.changeEtherBalance(user1, sellQuote.netProceeds);
    });

    it("Should decrease total supply after sell", async function () {
      const { market, token, user1 } = await loadFixture(deployMarketFixture);
      
      // Buy first
      const buyAmount = ethers.parseEther("100");
      const buyQuote = await market.getBuyQuote(buyAmount);
      await market.connect(user1).buy(buyAmount, buyQuote.totalCost, { value: buyQuote.totalCost });
      
      // Then sell
      const sellAmount = ethers.parseEther("50");
      await token.connect(user1).approve(await market.getAddress(), sellAmount);
      const sellQuote = await market.getSellQuote(sellAmount);
      await market.connect(user1).sell(sellAmount, sellQuote.netProceeds);
      
      expect(await market.totalSupply()).to.equal(buyAmount - sellAmount);
    });

    it("Should collect fees on sell", async function () {
      const { market, token, user1 } = await loadFixture(deployMarketFixture);
      
      // Buy first
      const buyAmount = ethers.parseEther("100");
      const buyQuote = await market.getBuyQuote(buyAmount);
      await market.connect(user1).buy(buyAmount, buyQuote.totalCost, { value: buyQuote.totalCost });
      
      const feesAfterBuy = await market.accumulatedFees();
      
      // Then sell
      const sellAmount = ethers.parseEther("50");
      await token.connect(user1).approve(await market.getAddress(), sellAmount);
      const sellQuote = await market.getSellQuote(sellAmount);
      await market.connect(user1).sell(sellAmount, sellQuote.netProceeds);
      
      expect(await market.accumulatedFees()).to.equal(feesAfterBuy + sellQuote.fee);
    });

    it("Should revert if slippage exceeded on sell", async function () {
      const { market, token, user1 } = await loadFixture(deployMarketFixture);
      
      // Buy first
      const buyAmount = ethers.parseEther("100");
      const buyQuote = await market.getBuyQuote(buyAmount);
      await market.connect(user1).buy(buyAmount, buyQuote.totalCost, { value: buyQuote.totalCost });
      
      // Then sell with too high minProceeds
      const sellAmount = ethers.parseEther("50");
      await token.connect(user1).approve(await market.getAddress(), sellAmount);
      const sellQuote = await market.getSellQuote(sellAmount);
      
      await expect(
        market.connect(user1).sell(sellAmount, sellQuote.netProceeds + 1n)
      ).to.be.revertedWith("Proceeds below min");
    });

    it("Should revert on zero amount sell", async function () {
      const { market, user1 } = await loadFixture(deployMarketFixture);
      
      await expect(
        market.connect(user1).sell(0, 0)
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("Should revert if selling more than supply", async function () {
      const { market, token, user1 } = await loadFixture(deployMarketFixture);
      
      // Buy first
      const buyAmount = ethers.parseEther("100");
      const buyQuote = await market.getBuyQuote(buyAmount);
      await market.connect(user1).buy(buyAmount, buyQuote.totalCost, { value: buyQuote.totalCost });
      
      // Try to sell more than supply
      const sellAmount = ethers.parseEther("101");
      await token.connect(user1).approve(await market.getAddress(), sellAmount);
      
      await expect(
        market.connect(user1).sell(sellAmount, 0)
      ).to.be.revertedWith("Insufficient supply");
    });

    it("Should emit Sell event", async function () {
      const { market, token, user1 } = await loadFixture(deployMarketFixture);
      
      // Buy first
      const buyAmount = ethers.parseEther("100");
      const buyQuote = await market.getBuyQuote(buyAmount);
      await market.connect(user1).buy(buyAmount, buyQuote.totalCost, { value: buyQuote.totalCost });
      
      // Then sell
      const sellAmount = ethers.parseEther("50");
      await token.connect(user1).approve(await market.getAddress(), sellAmount);
      const sellQuote = await market.getSellQuote(sellAmount);
      
      await expect(
        market.connect(user1).sell(sellAmount, sellQuote.netProceeds)
      ).to.emit(market, "Sell")
        .withArgs(user1.address, sellAmount, sellQuote.proceeds, sellQuote.fee);
    });
  });

  describe("Fee Management", function () {
    it("Should allow owner to withdraw fees", async function () {
      const { market, treasury, user1 } = await loadFixture(deployMarketFixture);
      
      // Generate fees
      const amount = ethers.parseEther("10");
      const quote = await market.getBuyQuote(amount);
      await market.connect(user1).buy(amount, quote.totalCost, { value: quote.totalCost });
      
      const fees = await market.accumulatedFees();
      
      await expect(
        market.withdrawFees()
      ).to.changeEtherBalance(treasury, fees);
    });

    it("Should reset accumulated fees after withdrawal", async function () {
      const { market, user1 } = await loadFixture(deployMarketFixture);
      
      // Generate fees
      const amount = ethers.parseEther("10");
      const quote = await market.getBuyQuote(amount);
      await market.connect(user1).buy(amount, quote.totalCost, { value: quote.totalCost });
      
      await market.withdrawFees();
      
      expect(await market.accumulatedFees()).to.equal(0);
    });

    it("Should revert if non-owner tries to withdraw fees", async function () {
      const { market, user1 } = await loadFixture(deployMarketFixture);
      
      await expect(
        market.connect(user1).withdrawFees()
      ).to.be.reverted;
    });

    it("Should emit FeeWithdrawal event", async function () {
      const { market, treasury, user1 } = await loadFixture(deployMarketFixture);
      
      // Generate fees
      const amount = ethers.parseEther("10");
      const quote = await market.getBuyQuote(amount);
      await market.connect(user1).buy(amount, quote.totalCost, { value: quote.totalCost });
      
      const fees = await market.accumulatedFees();
      
      await expect(
        market.withdrawFees()
      ).to.emit(market, "FeeWithdrawal")
        .withArgs(treasury.address, fees);
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to update curve parameters", async function () {
      const { market } = await loadFixture(deployMarketFixture);
      
      const newBasePrice = ethers.parseEther("0.002");
      const newSlope = ethers.parseEther("0.0002");
      
      await market.updateCurveParameters(newBasePrice, newSlope);
      
      expect(await market.basePrice()).to.equal(newBasePrice);
      expect(await market.slope()).to.equal(newSlope);
    });

    it("Should allow owner to update fee parameters", async function () {
      const { market } = await loadFixture(deployMarketFixture);
      
      const newBuyFee = 500; // 5%
      const newSellFee = 300; // 3%
      
      await market.updateFeeParameters(newBuyFee, newSellFee);
      
      expect(await market.buyFeeBps()).to.equal(newBuyFee);
      expect(await market.sellFeeBps()).to.equal(newSellFee);
    });

    it("Should revert if fees exceed maximum", async function () {
      const { market } = await loadFixture(deployMarketFixture);
      
      await expect(
        market.updateFeeParameters(1001, 250)
      ).to.be.revertedWith("Buy fee too high");
      
      await expect(
        market.updateFeeParameters(250, 1001)
      ).to.be.revertedWith("Sell fee too high");
    });

    it("Should allow owner to update fee recipient", async function () {
      const { market, user1 } = await loadFixture(deployMarketFixture);
      
      await market.updateFeeRecipient(user1.address);
      
      expect(await market.feeRecipient()).to.equal(user1.address);
    });

    it("Should revert if setting zero address as fee recipient", async function () {
      const { market } = await loadFixture(deployMarketFixture);
      
      await expect(
        market.updateFeeRecipient(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid fee recipient");
    });

    it("Should allow owner to pause trading", async function () {
      const { market, user1 } = await loadFixture(deployMarketFixture);
      
      await market.pause();
      
      const amount = ethers.parseEther("10");
      const quote = await market.getBuyQuote(amount);
      
      await expect(
        market.connect(user1).buy(amount, quote.totalCost, { value: quote.totalCost })
      ).to.be.revertedWith("Pausable: paused");
    });

    it("Should allow owner to unpause trading", async function () {
      const { market, user1 } = await loadFixture(deployMarketFixture);
      
      await market.pause();
      await market.unpause();
      
      const amount = ethers.parseEther("10");
      const quote = await market.getBuyQuote(amount);
      
      await expect(
        market.connect(user1).buy(amount, quote.totalCost, { value: quote.totalCost })
      ).to.not.be.reverted;
    });

    it("Should allow emergency token recovery", async function () {
      const { market, token, owner, user1 } = await loadFixture(deployMarketFixture);
      
      // Deploy different token
      const MockToken = await ethers.getContractFactory("MockERC20");
      const otherToken = await MockToken.deploy("Other Token", "OTH", ethers.parseEther("1000"));
      
      // Send to market by mistake
      await otherToken.transfer(await market.getAddress(), ethers.parseEther("100"));
      
      // Recover
      await market.emergencyTokenRecovery(await otherToken.getAddress(), ethers.parseEther("100"));
      
      expect(await otherToken.balanceOf(owner.address)).to.equal(ethers.parseEther("999900"));
    });

    it("Should prevent recovering market token", async function () {
      const { market, token } = await loadFixture(deployMarketFixture);
      
      await expect(
        market.emergencyTokenRecovery(await token.getAddress(), ethers.parseEther("100"))
      ).to.be.revertedWith("Cannot recover market token");
    });
  });

  describe("Quote Accuracy", function () {
    it("Should have consistent buy and sell quotes", async function () {
      const { market, token, user1 } = await loadFixture(deployMarketFixture);
      
      const amount = ethers.parseEther("100");
      
      // Get buy quote
      const buyQuote = await market.getBuyQuote(amount);
      
      // Execute buy
      await market.connect(user1).buy(amount, buyQuote.totalCost, { value: buyQuote.totalCost });
      
      // Get sell quote for same amount
      const sellQuote = await market.getSellQuote(amount);
      
      // Sell should be less than buy due to fees and curve mechanics
      expect(sellQuote.netProceeds).to.be.lt(buyQuote.totalCost);
    });

    it("Should handle large amounts correctly", async function () {
      const { market, user1 } = await loadFixture(deployMarketFixture);
      
      const largeAmount = ethers.parseEther("10000");
      const quote = await market.getBuyQuote(largeAmount);
      
      expect(quote.totalCost).to.be.gt(0);
      expect(quote.cost).to.be.gt(0);
      expect(quote.fee).to.be.gt(0);
    });
  });

  describe("Multiple Users", function () {
    it("Should handle multiple users buying", async function () {
      const { market, token, user1, user2 } = await loadFixture(deployMarketFixture);
      
      const amount = ethers.parseEther("50");
      
      // User 1 buys
      const quote1 = await market.getBuyQuote(amount);
      await market.connect(user1).buy(amount, quote1.totalCost, { value: quote1.totalCost });
      
      // User 2 buys (price should be higher)
      const quote2 = await market.getBuyQuote(amount);
      expect(quote2.cost).to.be.gt(quote1.cost);
      
      await market.connect(user2).buy(amount, quote2.totalCost, { value: quote2.totalCost });
      
      expect(await market.totalSupply()).to.equal(amount * 2n);
    });

    it("Should handle buy and sell from different users", async function () {
      const { market, token, user1, user2 } = await loadFixture(deployMarketFixture);
      
      // User 1 buys
      const buyAmount = ethers.parseEther("100");
      const buyQuote = await market.getBuyQuote(buyAmount);
      await market.connect(user1).buy(buyAmount, buyQuote.totalCost, { value: buyQuote.totalCost });
      
      // User 2 buys
      const buyQuote2 = await market.getBuyQuote(buyAmount);
      await market.connect(user2).buy(buyAmount, buyQuote2.totalCost, { value: buyQuote2.totalCost });
      
      // User 1 sells
      const sellAmount = ethers.parseEther("50");
      await token.connect(user1).approve(await market.getAddress(), sellAmount);
      const sellQuote = await market.getSellQuote(sellAmount);
      await market.connect(user1).sell(sellAmount, sellQuote.netProceeds);
      
      expect(await market.totalSupply()).to.equal(buyAmount * 2n - sellAmount);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle buying at exact supply", async function () {
      const { market, user1 } = await loadFixture(deployMarketFixture);
      
      const amount = ethers.parseEther("1");
      const quote = await market.getBuyQuote(amount);
      
      await expect(
        market.connect(user1).buy(amount, quote.totalCost, { value: quote.totalCost })
      ).to.not.be.reverted;
    });

    it("Should handle selling entire supply", async function () {
      const { market, token, user1 } = await loadFixture(deployMarketFixture);
      
      // Buy tokens
      const buyAmount = ethers.parseEther("100");
      const buyQuote = await market.getBuyQuote(buyAmount);
      await market.connect(user1).buy(buyAmount, buyQuote.totalCost, { value: buyQuote.totalCost });
      
      // Sell all
      await token.connect(user1).approve(await market.getAddress(), buyAmount);
      const sellQuote = await market.getSellQuote(buyAmount);
      await market.connect(user1).sell(buyAmount, sellQuote.netProceeds);
      
      expect(await market.totalSupply()).to.equal(0);
    });

    it("Should handle very small amounts", async function () {
      const { market, user1 } = await loadFixture(deployMarketFixture);
      
      const smallAmount = 1n; // 1 wei
      const quote = await market.getBuyQuote(smallAmount);
      
      await market.connect(user1).buy(smallAmount, quote.totalCost, { value: quote.totalCost });
      
      expect(await market.totalSupply()).to.equal(smallAmount);
    });
  });
});
