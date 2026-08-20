# BrokerSwap Contracts

BrokerChain fork of Uniswap V2 for BrokerWallet AMM swap integration.

## Directory Layout

```
contracts/
  broker-swap-core/       — Uniswap V2 Core (unchanged from upstream v2-core)
  broker-swap-periphery/  — Forked Router + Library (ETH→BKC, WETH→WBKC)
  mock/                   — MockUSDT (mUSDT) for testing
```

## Key changes from upstream Uniswap V2

1. **Naming**: ETH → BKC (native), WETH → WBKC (wrapped). Payable functions use "BKC" naming.
2. **pairFor**: Changed from CREATE2 derivation to `factory.getPair()` — eliminates hardcoded `INIT_CODE_PAIR_HASH`.
3. **TransferHelper**: Included inline to avoid `@uniswap/lib` npm dependency.
4. **Imports**: All `@uniswap/...` replaced with relative paths for standalone compilation.

## Solidity Versions

- Core: solc 0.5.16
- Periphery: solc 0.6.6
- Mock: solc 0.6.6

## License

GPL-3.0-or-later (inherited from Uniswap V2)
