# Historical LATQOR Demo USD source

This directory preserves the exact `DemoUSD.sol` source returned by the Robinhood Chain Testnet explorer for the immutable version 2 token at `0x6bfcF1343F7c1631cb5aD61513ae07Ab09f2F1ea`.

- On-chain name: `LATQOR Demo USD`
- Symbol: `dUSD`
- Chain ID: `46630`
- Explorer verification timestamp: `2026-09-18T09:51:23.530493Z`
- Source and response checksums: `manifest.json`
- Full explorer API response: [`output/latqor-contract-details.json`](../../../../output/latqor-contract-details.json). The original nested capture is retained as [`output/latqor-contract-details.raw.json`](../../../../output/latqor-contract-details.raw.json).

The current source in [`contracts/src/DemoUSD.sol`](../../../src/DemoUSD.sol) says `Leverix Demo USD` and is intended for a future deployment. It must not be presented as the source that produced this existing LATQOR address. The address, bytecode and token name are unchanged by the local rebrand.
