# BrokerSwap Quote Cache Service

This is a read-only cache for the configured `mUSDT/wBKC` Pair. It does not accept a private key, sign a transaction, submit a swap, or store wallet addresses.

The process reads `Pair.getReserves()` and `Pair.totalSupply()` on startup and then at a short interval (15 seconds by default). Mobile quote requests read the in-memory snapshot, so typing an amount does not trigger an `eth_call` per keystroke.

The configured RPC source must return a non-empty result for `eth_call` against the Pair. A cache host that only forwards to an RPC endpoint which returns `0x` cannot become ready and must remain unexposed; do not compensate by adding a wallet or server private key.

## Start on the BrokerChain server

Run the service next to a BrokerChain RPC node. The node address is intentionally supplied as an environment variable rather than embedded in source.

```powershell
$env:BROKERCHAIN_RPC_URL = 'http://127.0.0.1:49282'
$env:QUOTE_CACHE_HOST = '127.0.0.1'
$env:QUOTE_CACHE_PORT = '8088'
$env:QUOTE_CACHE_REFRESH_MS = '15000'
$env:QUOTE_CACHE_MAX_AGE_MS = '45000'
npm run serve:quote-cache
```

The server exposes:

- `GET /health`
- `GET /api/swap/reserves`
- `GET /api/swap/quote?amountIn=<base-units>&tokenIn=<address>&tokenOut=<address>`
- `GET /api/liquidity/pool`
- `GET /api/liquidity/quote?amountMusdt=<base-units>&amountBkc=<wei>`
- `POST /api/swap/reserves/refresh` (rate-limited read-only refresh)

When the Pair cache is unavailable or older than its maximum age, the service returns HTTP 503 instead of serving a stale quote.

## Reverse proxy

The Android application requests `https://dash.broker-chain.com:440/api/swap/reserves`. Add the following location to the existing TLS virtual host on port 440, then reload Nginx:

```nginx
location /api/swap/ {
    proxy_pass http://127.0.0.1:8088/api/swap/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /api/liquidity/ {
    proxy_pass http://127.0.0.1:8088/api/liquidity/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Do not expose the node RPC port publicly for this feature. The cache service needs only read access to the node's local RPC endpoint.

## Safety behavior

The Android client still derives the final `amountOutMin` from its displayed quote and slippage setting. If the cache endpoint is unavailable it falls back to the existing on-chain read; it never falls back to a private key or a write operation.
