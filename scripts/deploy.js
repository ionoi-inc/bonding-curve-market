const { ethers } = require("hardhat");

/**
 * Deployment configuration
 * Customize these values before deployment
 */
const DEPLOYMENT_CONFIG = {
  // Token address (must be deployed first)
  tokenAddress: process.env.TOKEN_ADDRESS || "0x0000000000000000000000000000000000000000",
  
  // Curve parameters
  basePrice: ethers.parseEther("0.001"), // Starting price: 0.001 ETH
  slope: ethers.parseEther("0.0001"),    // Price increase per token: 0.0001 ETH
  
  // Fee configuration (in basis points, 100 = 1%)
  buyFeeBps: 250,  // 2.5% buy fee
  sellFeeBps: 250, // 2.5% sell fee
  
  // Fee recipient address
  feeRecipient: process.env.FEE_RECIPIENT || "",
  
  // Initial token supply to transfer to market (for selling)
  initialMarketSupply: ethers.parseEther("100000"), // 100,000 tokens
};

async function main() {
  console.log("Starting BondingCurveMarket deployment...\n");

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  // Validate configuration
  if (DEPLOYMENT_CONFIG.tokenAddress === "0x0000000000000000000000000000000000000000") {
    console.error("❌ ERROR: TOKEN_ADDRESS not set in environment or config");
    console.log("Please set TOKEN_ADDRESS to your ERC20 token contract address");
    process.exit(1);
  }

  if (!DEPLOYMENT_CONFIG.feeRecipient) {
    console.log("⚠️  Warning: FEE_RECIPIENT not set, using deployer address");
    DEPLOYMENT_CONFIG.feeRecipient = deployer.address;
  }

  console.log("Deployment Configuration:");
  console.log("========================");
  console.log("Token Address:      ", DEPLOYMENT_CONFIG.tokenAddress);
  console.log("Base Price:         ", ethers.formatEther(DEPLOYMENT_CONFIG.basePrice), "ETH");
  console.log("Slope:              ", ethers.formatEther(DEPLOYMENT_CONFIG.slope), "ETH per token");
  console.log("Buy Fee:            ", DEPLOYMENT_CONFIG.buyFeeBps / 100, "%");
  console.log("Sell Fee:           ", DEPLOYMENT_CONFIG.sellFeeBps / 100, "%");
  console.log("Fee Recipient:      ", DEPLOYMENT_CONFIG.feeRecipient);
  console.log("Initial Supply:     ", ethers.formatEther(DEPLOYMENT_CONFIG.initialMarketSupply), "tokens\n");

  // Deploy BondingCurveMarket
  console.log("Deploying BondingCurveMarket contract...");
  const BondingCurveMarket = await ethers.getContractFactory("BondingCurveMarket");
  const market = await BondingCurveMarket.deploy(
    DEPLOYMENT_CONFIG.tokenAddress,
    DEPLOYMENT_CONFIG.basePrice,
    DEPLOYMENT_CONFIG.slope,
    DEPLOYMENT_CONFIG.buyFeeBps,
    DEPLOYMENT_CONFIG.sellFeeBps,
    DEPLOYMENT_CONFIG.feeRecipient
  );

  await market.waitForDeployment();
  const marketAddress = await market.getAddress();
  
  console.log("✅ BondingCurveMarket deployed to:", marketAddress);

  // Transfer initial token supply to market (if needed)
  if (DEPLOYMENT_CONFIG.initialMarketSupply > 0) {
    console.log("\nTransferring initial token supply to market...");
    
    const token = await ethers.getContractAt("IERC20", DEPLOYMENT_CONFIG.tokenAddress);
    const deployerBalance = await token.balanceOf(deployer.address);
    
    if (deployerBalance >= DEPLOYMENT_CONFIG.initialMarketSupply) {
      const transferTx = await token.transfer(marketAddress, DEPLOYMENT_CONFIG.initialMarketSupply);
      await transferTx.wait();
      console.log("✅ Transferred", ethers.formatEther(DEPLOYMENT_CONFIG.initialMarketSupply), "tokens to market");
    } else {
      console.log("⚠️  Warning: Insufficient token balance for initial supply");
      console.log("   Required:", ethers.formatEther(DEPLOYMENT_CONFIG.initialMarketSupply));
      console.log("   Available:", ethers.formatEther(deployerBalance));
    }
  }

  // Verify deployment
  console.log("\nVerifying deployment...");
  const verifiedBasePrice = await market.basePrice();
  const verifiedSlope = await market.slope();
  const verifiedBuyFee = await market.buyFeeBps();
  const verifiedSellFee = await market.sellFeeBps();
  const verifiedFeeRecipient = await market.feeRecipient();

  console.log("✅ Base Price verified:     ", ethers.formatEther(verifiedBasePrice), "ETH");
  console.log("✅ Slope verified:          ", ethers.formatEther(verifiedSlope), "ETH per token");
  console.log("✅ Buy Fee verified:        ", verifiedBuyFee.toString(), "bps");
  console.log("✅ Sell Fee verified:       ", verifiedSellFee.toString(), "bps");
  console.log("✅ Fee Recipient verified:  ", verifiedFeeRecipient);

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("DEPLOYMENT SUMMARY");
  console.log("=".repeat(60));
  console.log("BondingCurveMarket Address:", marketAddress);
  console.log("Token Address:             ", DEPLOYMENT_CONFIG.tokenAddress);
  console.log("Deployer:                  ", deployer.address);
  console.log("Network:                   ", (await ethers.provider.getNetwork()).name);
  console.log("=".repeat(60));

  // Print environment variables for verification
  console.log("\n📝 Save these for verification:");
  console.log(`export MARKET_ADDRESS=${marketAddress}`);
  console.log(`export TOKEN_ADDRESS=${DEPLOYMENT_CONFIG.tokenAddress}`);

  // Print next steps
  console.log("\n📋 Next Steps:");
  console.log("1. Verify contract on block explorer:");
  console.log(`   npx hardhat verify --network <network> ${marketAddress} "${DEPLOYMENT_CONFIG.tokenAddress}" "${DEPLOYMENT_CONFIG.basePrice}" "${DEPLOYMENT_CONFIG.slope}" ${DEPLOYMENT_CONFIG.buyFeeBps} ${DEPLOYMENT_CONFIG.sellFeeBps} "${DEPLOYMENT_CONFIG.feeRecipient}"`);
  console.log("\n2. Test the market:");
  console.log("   - Get buy quote: market.getBuyQuote(amount)");
  console.log("   - Execute buy: market.buy(amount, maxCost, {value: maxCost})");
  console.log("\n3. Monitor fees:");
  console.log("   - Check accumulated: market.accumulatedFees()");
  console.log("   - Withdraw fees: market.withdrawFees()");

  return {
    market: marketAddress,
    token: DEPLOYMENT_CONFIG.tokenAddress,
    deployer: deployer.address
  };
}

// Execute deployment
main()
  .then((result) => {
    console.log("\n✅ Deployment completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });

module.exports = { main, DEPLOYMENT_CONFIG };
