# Leverix testnet contracts

A functioning test-token settlement sandbox on **Robinhood Chain Testnet (46630)** with **32 global benchmark markets and 1–20x demo leverage**. It demonstrates wallet approval, faucet, collateral deposit, long/short positions, liquidation, close and withdrawal. It is not a production perpetual exchange, index investment, or real USDG integration. It does not use live financial prices.

## Run

Requires Node.js 22+ and npm. From this directory:

```powershell
npm ci
npm test
npm run preflight
npm run deploy
npm run smoke
npm run verify
npm run refresh-prices
# Optional: keep synthetic quotes fresh every 5 minutes until Ctrl+C
npm run keeper
```

`deploy` refuses a second deployment when `deployments/robinhood-testnet.json` already exists. The final release is version 2; the earlier three-market/five-times demonstration's source, artifacts, manifest and receipts are preserved in `deployments/v1/`. `preflight`, `deploy`, `smoke`, `refresh-prices` and the optional keeper read the private key directly from `../key.txt` in process; alternatively set `TESTNET_KEY_FILE` to an absolute private-file path. No command prints, exports, persists, embeds or copies the secret. Never serve this repository root as public web content. Only serve the built website directory.

All signing scripts hardcode the official testnet RPC and verify `eth_chainId` is `46630` before reading the key or signing. They cannot be pointed at mainnet by a network environment variable.

## Network

| Field | Value |
| --- | --- |
| Network | Robinhood Chain Testnet |
| Chain ID | `46630` / `0xb626` |
| Gas | Test ETH |
| Public RPC | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://explorer.testnet.chain.robinhood.com` |
| Faucet host | `https://faucet.testnet.chain.robinhood.com` |

Official configuration: <https://docs.robinhood.com/chain/connecting>. Configuration and RPC identity were checked on September 18, 2026. The faucet host returned HTTP 429 from this environment; a faucet claim was not needed because the user-provided testnet wallet was funded. The public RPC is rate limited and is not recommended by Robinhood for production.

## Contracts

**DemoUSD** is a standard, non-upgradeable OpenZeppelin ERC-20 used by the Leverix testnet (`dUSD`, 6 decimals). The current deployed address is historical immutable testnet infrastructure; its on-chain name is **LATQOR Demo USD** and cannot be changed in place. A fresh deployment from the current source would be named **Leverix Demo USD**, but no redeployment is implied by this rebrand. Deployment mints 1,000,000 dUSD to the deployer; the application faucet mints 10,000 dUSD per calling address every 24 hours. This is a freely reproducible simulation token with no reserves, cash value or redemption. It is not the Paxos USDG asset. Faucet cooldown is not a Sybil defense.

**IndexPerpSandbox** accepts only the immutable DemoUSD contract chosen at deployment. Demo quotes use 8 decimals. `config/markets.json` is the canonical roster of 32 benchmarks, countries, regions and synthetic seed prices. IDs are `encodeBytes32String(symbol)`, for example `DAX`, `NIKKEI` and `FTSE100`. This roster matches the public reference's 32 index symbols, including its absence of a US market. These names are educational market labels; no index license, benchmark-provider partnership or real asset exposure is claimed. `scripts/check-reference-markets.mjs` can recheck the public roster and records evidence in `config/reference-check.json`.

| Function | Behavior |
| --- | --- |
| `deposit(amount)` | Transfer approved dUSD to available balance |
| `withdraw(amount)` | Withdraw available balance; works while paused |
| `openPosition(marketId,isLong,margin,leverage,expectedPrice,slippageBps)` | Lock 1–10,000 dUSD margin, 1–20x, at a fresh quote; also reserve maximum profit |
| `closePosition(id,expectedPrice,slippageBps)` | Owner of the position closes at a fresh quote, settles bounded PnL |
| `liquidate(id)` | Anyone settles if loss reaches 90% initial margin; no liquidator reward |
| `cancelStalePosition(id)` | Trader recovers initial margin at zero PnL after 24h without a demo quote |
| `previewPnl(id)` | Returns bounded PnL, payout, and quote-freshness flag |
| `balances(address)` | Available collateral, 6 decimals |
| `lockedCollateral(address)` | Initial margin of currently open positions, 6 decimals |
| `getPositionIds(address)` | Historical IDs, including closed positions |
| `markets(id)` | `(price, updatedAt, enabled)` |
| `positions(id)` | `(trader,marketId,margin,entryPrice,openedAt,leverage,isLong,isOpen)` |
| `setDemoPrice(id,price)` | Owner-only synthetic quote publication |
| `setDemoPrices(ids,prices)` | Owner-only atomic publication of up to 64 synthetic quotes; used for all 32 markets |
| `fundLiquidity(amount)` | Irrevocably donate worthless dUSD to the payout reserve |

`frontend.json` contains public network settings, contract addresses, ABI arrays, markets and explorer links. It contains no secret. The Vue app should copy this file into its source tree; never import the key or deployment scripts.

## Economic and security boundaries

Uncapped PnL is `margin × leverage × signed(price − entryPrice) / entryPrice`. Integer division truncates toward zero. The prototype clamps PnL to `[-margin, +margin]`, so payout is always in `[0, 2 × margin]`. Maximum gain is therefore **100% of margin**, independent of larger simulated market moves. This deliberately simplified product is not an economic replica of an uncapped perpetual contract.

Opening locks an additional reserve equal to margin. Its maximum possible payout is fully funded at entry. Accounting invariant:

```text
token.balanceOf(engine) >= totalUserCollateral + freeLiquidity + reservedLiquidity
```

`totalUserCollateral` includes available balances and margin. The reserve cannot be withdrawn by the owner. Direct token transfers create unaccounted excess; they do not credit a user. Only the deployed non-fee-on-transfer DemoUSD is supported.

New exposure rejects quotes older than 15 minutes, invalid prices, invalid leverage/margin, insufficient reserves and more than 5% requested slippage. Closing and liquidation require fresh quotes too. Available balances remain withdrawable during pauses/outages. Open positions can be canceled by their trader at zero PnL after 24 hours without an update, even while paused. This liveness escape is a demo rule, not a fair-value guarantee.

The owner can change synthetic prices and pause opening/deposits, so the owner can determine demo PnL. Ownership transfers use two steps. **The oracle is centralized and must never be described as Chainlink, audited, or a current market-price feed.** The refresh script republishes all 32 fixed sample numbers in one transaction and does not fetch financial data. It must be run before demonstrations and at least every 15 minutes while the demo is in use. `npm run keeper` optionally runs an operator process that refreshes every five minutes, rechecking official testnet identity and ownership before every transaction. `npm run keeper -- --once` performs one publication and exits. The keeper is not automatically started or hosted; it consumes testnet ETH while running and stops after three consecutive failed refreshes. Stop it with Ctrl+C.

No real perpetual funding, order book, market-maker integration, sequencer-uptime gate, licensed index feed, session-aware trading rules, insurance mechanism, permissions/compliance layer, historical indexer, production monitoring or independent audit is included. Production implementation must replace the synthetic feed and revise risk/settlement economics before accepting assets with value.

## Validation

`npm test` runs the actual compiled Solidity on an isolated in-process Ganache EVM. It checks the full settlement cycle, positive/negative PnL, short direction, payout caps, liquidation thresholds, collateral solvency, stale-price rejection, recovery cancellation, access control, pause exits, market disable exits, reserve exhaustion, bounds, slippage and faucet cooldown. The suite uses only generated local test accounts.

Ganache's bundled development dependencies have known npm audit findings and its optional native WebSocket module may fall back to JavaScript on Node 24/Windows. The test runner never binds a network port. It is not shipped with the frontend or used as the testnet RPC. Dependency audit output is not an audit of deployed Solidity; independent contract security review is still required before any production use.

Deployment receipts are in `deployments/robinhood-testnet.json`; onchain end-to-end results are in `deployments/smoke-test.json`; explorer verification status is in `deployments/source-verification.json`. The existing dUSD address's exact historical source is preserved under `deployments/historical/latqor-demo-usd/`, with the full explorer response in `../output/latqor-contract-details.json`. Those records, rather than this README, are the evidence of the actual run. The historical source must not be replaced by the current `src/DemoUSD.sol`: the latter says `Leverix Demo USD` and is intended for a future deployment.
