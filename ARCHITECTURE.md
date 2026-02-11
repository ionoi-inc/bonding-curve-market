# BondingCurveMarket Architecture

## Table of Contents
1. [System Overview](#system-overview)
2. [Mathematical Model](#mathematical-model)
3. [Contract Design](#contract-design)
4. [Security Model](#security-model)
5. [Gas Optimization](#gas-optimization)
6. [Upgrade Strategy](#upgrade-strategy)

## System Overview

### Purpose
BondingCurveMarket is an automated market maker (AMM) that uses a linear bonding curve to determine token prices based on supply. Unlike traditional AMMs with liquidity pools, bonding curves provide deterministic pricing without requiring liquidity providers.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    BondingCurveMarket                   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐      ┌──────────────┐               │
│  │   Pricing    │      │     Fee      │               │
│  │   Engine     │◄────►│  Management  │               │
│  └──────┬───────┘      └──────┬───────┘               │
│         │                      │                        │
│         ▼                      ▼                        │
│  ┌──────────────┐      ┌──────────────┐               │
│  │   Trading    │      │    Admin     │               │
│  │   Functions  │      │   Controls   │               │
│  └──────┬───────┘      └──────────────┘               │
│         │                                               │
│         ▼                                               │
│  ┌──────────────┐                                      │
│  │   ERC20      │                                      │
│  │   Token      │                                      │
│  └──────────────┘                                      │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Component Responsibilities

**Pricing Engine:**
- Calculate buy/sell prices using bonding curve formula
- Compute integral costs for bulk purchases
- Handle fee calculations

**Trading Functions:**
- Execute buy operations (ETH → Token)
- Execute sell operations (Token → ETH)
- Slippage protection
- Reentrancy protection

**Fee Management:**
- Accumulate fees from trades
- Track total fees collected
- Withdrawal mechanism to treasury

**Admin Controls:**
- Update curve parameters
- Modify fee settings
- Emergency pause functionality
- Token recovery

## Mathematical Model

### Linear Bonding Curve

The core pricing mechanism uses a linear function:

```
P(s) = b + m·s

Where:
  P(s) = Price at supply s
  b    = Base price (y-intercept)
  m    = Slope (rate of price increase)
  s    = Current supply
```

### Integral Pricing

To calculate the total cost for buying `n` tokens when current supply is `s`:

```
Cost = ∫[s to s+n] P(x) dx
     = ∫[s to s+n] (b + m·x) dx
     = [b·x + (m·x²)/2] evaluated from s to s+n
     = b·n + m·[(s+n)² - s²]/2
     = b·n + m·n·(2s + n)/2
     = b·n + m·n·(s + n/2)
```

**Simplified formula:**
```
Cost(n, s) = b·n + m·n·(s + n/2)
```

### Fee Calculations

**Buy Operation:**
```
BaseCost = Cost(amount, currentSupply)
Fee = BaseCost × buyFeeBps / 10000
TotalCost = BaseCost + Fee
```

**Sell Operation:**
```
BaseProceeds = Cost(amount, currentSupply - amount)
Fee = BaseProceeds × sellFeeBps / 10000
NetProceeds = BaseProceeds - Fee
```

### Price Dynamics

**Current Buy Price:**
- Price to buy the next token
- `P(supply) = basePrice + slope × supply`

**Current Sell Price:**
- Price received for selling one token
- `P(supply - 1) = basePrice + slope × (supply - 1)`

**Price Impact:**
For a buy of `n` tokens:
```
Average Price = TotalCost / n
Price Impact = (EndPrice - StartPrice) / StartPrice
             = slope × n / (basePrice + slope × supply)
```

### Example Calculations

Given:
- basePrice = 0.001 ETH
- slope = 0.0001 ETH
- supply = 1000 tokens
- buyFeeBps = 250 (2.5%)

**Buy 100 tokens:**
```
BaseCost = 0.001 × 100 + 0.0001 × 100 × (1000 + 50)
         = 0.1 + 0.0001 × 100 × 1050
         = 0.1 + 10.5
         = 10.6 ETH

Fee = 10.6 × 0.025 = 0.265 ETH
TotalCost = 10.6 + 0.265 = 10.865 ETH
```

## Contract Design

### Inheritance Structure

```
BondingCurveMarket
    ├── ReentrancyGuard (OpenZeppelin)
    ├── Ownable (OpenZeppelin)
    └── Pausable (OpenZeppelin)
```

### State Variables

```solidity
// Immutable
IERC20 public immutable token;

// Curve parameters (mutable by owner)
uint256 public basePrice;
uint256 public slope;

// Trading state
uint256 public totalSupply;

// Fee configuration (mutable by owner)
uint256 public buyFeeBps;
uint256 public sellFeeBps;
address public feeRecipient;
uint256 public accumulatedFees;

// Max fee constant
uint256 public constant MAX_FEE_BPS = 1000; // 10%
```

### Function Categories

**View Functions (Gas-free):**
- `getCurrentBuyPrice()` - Get current buy price
- `getCurrentSellPrice()` - Get current sell price
- `getBuyQuote(amount)` - Calculate buy cost
- `getSellQuote(amount)` - Calculate sell proceeds

**Trading Functions (State-changing):**
- `buy(amount, maxCost)` - Purchase tokens
- `sell(amount, minProceeds)` - Sell tokens

**Admin Functions (Owner-only):**
- `updateCurveParameters(basePrice, slope)`
- `updateFeeParameters(buyFee, sellFee)`
- `updateFeeRecipient(recipient)`
- `withdrawFees()`
- `pause()` / `unpause()`
- `emergencyTokenRecovery(token, amount)`

### Event Emissions

All state-changing operations emit events for off-chain tracking:

```solidity
event Buy(address indexed buyer, uint256 amount, uint256 cost, uint256 fee);
event Sell(address indexed seller, uint256 amount, uint256 proceeds, uint256 fee);
event FeeWithdrawal(address indexed recipient, uint256 amount);
event CurveParametersUpdated(uint256 basePrice, uint256 slope);
event FeeParametersUpdated(uint256 buyFeeBps, uint256 sellFeeBps);
event FeeRecipientUpdated(address indexed newRecipient);
```

## Security Model

### Attack Vectors & Mitigations

**1. Reentrancy Attack**
- **Risk:** Malicious token contract calling back into market
- **Mitigation:** `ReentrancyGuard` on all state-changing functions
- **Pattern:** Checks-Effects-Interactions

**2. Front-running**
- **Risk:** MEV bots seeing pending transactions and trading first
- **Mitigation:** Slippage protection via maxCost/minProceeds
- **User Action:** Set appropriate slippage tolerance

**3. Integer Overflow**
- **Risk:** Arithmetic operations exceeding uint256 max
- **Mitigation:** Solidity 0.8+ automatic overflow checks
- **Additional:** Reasonable parameter bounds

**4. Price Manipulation**
- **Risk:** Admin changing parameters mid-trade
- **Mitigation:** Slippage protection, transparent parameter changes
- **Best Practice:** Use timelock for parameter changes in production

**5. Denial of Service**
- **Risk:** Contract becoming unusable
- **Mitigation:** Emergency pause, no loops, bounded operations
- **Recovery:** Admin can pause and investigate

**6. Token Loss**
- **Risk:** Users accidentally sending tokens to contract
- **Mitigation:** `emergencyTokenRecovery` for non-market tokens
- **Protection:** Cannot recover market token

### Access Control

```
Owner (Deployer)
    ├── Update curve parameters
    ├── Update fee parameters
    ├── Update fee recipient
    ├── Withdraw fees
    ├── Pause/unpause
    └── Emergency recovery

Anyone
    ├── Buy tokens
    ├── Sell tokens
    ├── View prices
    └── Get quotes
```

### Invariants

The contract maintains these invariants:

1. **Supply Tracking:** `totalSupply` always reflects tokens sold minus tokens bought back
2. **Fee Accumulation:** `accumulatedFees` only increases or resets to zero
3. **Price Monotonicity:** Price increases with supply (assuming positive slope)
4. **Conservation:** ETH in contract = fees + value of outstanding tokens
5. **Token Balance:** Market must hold sufficient tokens for sells

## Gas Optimization

### Optimization Strategies

**1. Storage Packing**
- Use `uint256` for all numeric values (no packing benefit due to math operations)
- Immutable variables stored in bytecode, not storage

**2. Short-circuit Validation**
- Check cheapest conditions first
- `amount > 0` before expensive calculations

**3. View Function Efficiency**
- Mark all read-only functions as `view`
- Enable off-chain calls without gas cost

**4. Minimize Storage Writes**
- Batch related state updates
- Use memory for intermediate calculations

**5. Efficient Loops**
- No loops in critical functions
- Integral formula eliminates iteration

### Gas Benchmarks

| Operation | Gas Cost | Notes |
|-----------|----------|-------|
| Buy (first time) | ~85,000 | Includes token transfer |
| Buy (subsequent) | ~65,000 | Warm storage access |
| Sell (first time) | ~90,000 | Includes approvals |
| Sell (subsequent) | ~70,000 | Warm storage access |
| Get Quote | ~30,000 | View function |
| Withdraw Fees | ~35,000 | ETH transfer |
| Update Parameters | ~45,000 | Storage writes |

## Upgrade Strategy

### Current Design: Non-upgradeable

The contract is **not upgradeable** by design for the following reasons:

**Advantages:**
- ✅ Simplicity and transparency
- ✅ Users trust immutable logic
- ✅ No proxy complexity
- ✅ Lower deployment cost

**Disadvantages:**
- ❌ Cannot fix bugs without redeployment
- ❌ Cannot add features
- ❌ Must migrate users to new contract

### Migration Strategy

If redeployment is needed:

**1. Preparation Phase**
```
- Deploy new contract with fixes/features
- Test extensively on testnet
- Announce migration timeline
```

**2. Migration Phase**
```
- Pause old contract
- Provide migration UI
- Users sell tokens on old contract
- Users buy tokens on new contract
```

**3. Deprecation Phase**
```
- Keep old contract paused
- Redirect all UI to new contract
- Document migration in README
```

### Future Upgradeable Version

For an upgradeable version, consider:

**Option 1: Proxy Pattern**
```
TransparentUpgradeableProxy
    └── BondingCurveMarket (Implementation)
```

**Option 2: Diamond Pattern**
```
DiamondProxy
    ├── PricingFacet
    ├── TradingFacet
    └── AdminFacet
```

**Trade-offs:**
- Increased complexity
- Higher gas costs
- Additional security considerations
- Potential upgrade vulnerabilities

## Testing Strategy

### Test Coverage

**Unit Tests:**
- Each function tested in isolation
- Edge cases and boundary conditions
- Error conditions and reverts

**Integration Tests:**
- Multi-step workflows
- Multiple users interacting
- Fee accumulation over time

**Security Tests:**
- Reentrancy scenarios
- Access control verification
- Slippage protection
- Integer boundaries

**Gas Tests:**
- Benchmark common operations
- Identify optimization opportunities

### Test Scenarios

1. **Happy Path:** Buy → Hold → Sell
2. **Multiple Users:** Parallel trading
3. **Price Impact:** Large trades
4. **Edge Cases:** Zero supply, max supply
5. **Admin Operations:** Parameter updates
6. **Emergency:** Pause and recovery

## Deployment Checklist

- [ ] Set appropriate basePrice for market
- [ ] Set appropriate slope for price dynamics
- [ ] Configure reasonable fee percentages
- [ ] Set treasury address for fee collection
- [ ] Test on testnet with real users
- [ ] Audit contract code
- [ ] Verify on block explorer
- [ ] Document all parameters
- [ ] Set up monitoring and alerts
- [ ] Plan emergency response procedures

## Monitoring & Maintenance

### Key Metrics to Track

**Trading Metrics:**
- Volume (buy/sell)
- Number of trades
- Unique traders
- Average trade size

**Financial Metrics:**
- Total fees collected
- TVL (Total Value Locked)
- Price movements
- Supply growth

**Technical Metrics:**
- Gas usage trends
- Failed transactions
- Error rates

### Alert Conditions

- Accumulated fees > threshold → Withdraw
- Unusual price movement → Investigate
- Failed transactions spike → Check contract
- Parameter change → Verify intentional

## Future Enhancements

### Potential Features

1. **Bonding Curve Variations:**
   - Exponential curves
   - Logarithmic curves
   - Piecewise linear curves

2. **Advanced Fee Structures:**
   - Time-based fee decay
   - Volume-based discounts
   - Loyalty rewards

3. **Liquidity Incentives:**
   - Staking rewards
   - Liquidity mining
   - Referral bonuses

4. **Governance:**
   - DAO-controlled parameters
   - Community proposals
   - Voting mechanisms

5. **Cross-chain Support:**
   - Bridge integrations
   - Multi-chain deployment
   - Unified liquidity

## References

- [Bonding Curves Explained](https://yos.io/2018/11/10/bonding-curves/)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)
- [Solidity Documentation](https://docs.soliditylang.org/)
- [Ethereum Gas Optimization](https://github.com/iskdrews/awesome-solidity-gas-optimization)
