# Robinhood Chain and reference-product findings

Observed September 18, 2026. Primary sources were fetched directly over HTTPS.

1. <https://docs.robinhood.com/chain/connecting> identifies Robinhood Chain as an Ethereum Arbitrum L2, gas ETH; current mainnet ID **4663** and testnet ID **46630**. The public testnet RPC is <https://rpc.testnet.chain.robinhood.com>. A direct `eth_chainId` request returned `0xb626`, matching 46630. Mainnet was not used.
2. <https://docs.robinhood.com/chain/deploy-smart-contracts> confirms EVM compatibility, the same testnet settings and Blockscout source verification API. Its sample commands now target mainnet by default; this repository intentionally hardcodes testnet instead.
3. <https://docs.robinhood.com/chain/add-network-to-wallet> confirms EVM wallet compatibility and the testnet configuration.
4. <https://docs.robinhood.com/chain/oracles-and-price-feeds> describes Chainlink feeds for crypto assets and Stock Tokens, freshness checks, sequencer-uptime checks/grace, corporate-action pauses, and token share multipliers. It does **not** establish national-stock-index oracle coverage or the right to redistribute index data. We did not substitute stock-token feeds for an index.
5. <https://www.perpdex.lat/> self-describes: “Perpetual futures on every country's benchmark index, in local points, settled in USDG on Robinhood Chain. Place an order any time.” Its landing page lists 32 national benchmarks and displays maximum leverage 20x. This is a claim made by the reference site, not independently verified evidence of liquidity, security, execution quality or licensed data.

Leverix therefore takes the *product category* of global stock-benchmark long/short markets and implements original contracts and branding. It does not copy Perpdex contracts, private API logic, photographs, illustration files, logo assets or marketing text. The final sandbox matches the reference's 32 public benchmark symbols and supports 1–20x demo leverage, but it does not reproduce the economics or claim production parity: Leverix uses separately named worthless dUSD, synthetic operator prices and capped demo settlement. The reference's claimed USDG integration, live execution and data coverage are not implemented here. The canonical list and recorded public-source check are in `config/markets.json` and `config/reference-check.json`.

The deployer public address is recorded in `deployments/preflight.json`. No key material is included in research, manifests, ABI files, frontend bundles or source-verification inputs.
