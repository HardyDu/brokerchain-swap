# BrokerSwap Liquidity Provision

## Contract model

The existing Pair at `0x40283F8EccEC16386081B1e4A1E83C5C8939adcb` is a Uniswap V2-style Pair. Its ERC-20 LP token (`UNI-V2`, 18 decimals) is the liquidity provider's on-chain proof of ownership. No separate NFT or database proof is required.

Each swap enforces the `997/1000` invariant. The 0.3% input fee remains in the Pair reserves, increasing the assets represented by LP tokens. It is not a separately claimable reward balance; a provider realizes it when withdrawing liquidity.

The deployed fixed Swap Router does not expose add/remove liquidity. Mobile clients must not transfer both assets to the Pair in separate transactions because a partial failure can strand funds. `BrokerLiquidityRouter.sol` instead atomically:

1. chooses the optimal mUSDT/BKC ratio from current reserves;
2. transfers mUSDT and wraps only the BKC actually used;
3. mints Pair LP tokens directly to the provider;
4. refunds excess native BKC;
5. enforces minimum mUSDT, BKC, and LP-token outputs;
6. removes liquidity atomically and unwraps WBKC back to native BKC.

The existing Swap Router address remains unchanged.

## Deployment state

The liquidity router is deployed at `0xff44a9fd58f4bcd096b0cbf780580cb6846efd0d` in transaction `0x20e5dd8c205acb962dd28a833060c6e718333b139c466fdf5d8a163bb036ea0f` (receipt status `0x1`). Runtime code is 5,645 bytes with hash `0x3d0e16ff18b343c4a894be08296a6a3e4f9588ee26b612a3a2e7bf56e1fb5f1e`. Its embedded immutable Factory, WBKC, mUSDT, and Pair addresses were decoded from the deployed bytecode and match the fixed deployment exactly.

Before a future deployment:

- compile and run the full Hardhat test suite;
- verify constructor arguments are exactly the fixed Factory, WBKC, and mUSDT addresses;
- deploy only through an explicitly authorized BrokerChain account;
- verify `factory()`, `WBKC()`, `musdt()`, `pair()`, reserves, and runtime bytecode;
- insert the verified address into Android `broker_swap_deployment.json`, rebuild, and perform a negligible-value add/remove test only with fresh explicit approval.

## Server API

`GET /api/liquidity/quote` accepts integer base units and returns the optimal amounts, estimated LP proof, estimated pool share, total supply, and snapshot age. It is read-only and never receives wallet data or keys. Android falls back to signed read-only Pair calls when the cache is unavailable.

## Android flow

The Swap screen now links to a separate Liquidity Provide screen. Once a verified liquidity router is configured, the user flow is:

1. enter maximum BKC and mUSDT amounts;
2. review optimal amounts, estimated LP proof, pool share, and fee explanation;
3. approve only the required mUSDT amount;
4. click Add liquidity again and confirm;
5. receive LP tokens at the active wallet address.

The submitted transaction applies 0.5% minimum-amount and minimum-LP protection. The screen is fail-closed when configuration, quote, allowance, or chain checks are unavailable.
