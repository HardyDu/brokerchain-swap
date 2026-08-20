"use strict";

const assert = require("assert");
const {
  MUSDT,
  WBKC,
  PairReserveCache,
  createQuoteCacheServer,
  liquidityQuoteFromSnapshot,
  quoteAmountOut,
  quoteFromSnapshot,
} = require("../scripts/quote-cache-server");

async function main() {
  assert.strictEqual(
    quoteAmountOut(1000n, 1_000_000n, 1_000_000n),
    996n,
    "must use the deployed 997/1000 Pair fee formula"
  );

  const snapshot = {
    reserve0: 1_000_000n,
    reserve1: 1_000_000n,
    updatedAtMs: 10,
  };
  const quote = quoteFromSnapshot(snapshot, "1000", MUSDT, WBKC);
  assert.strictEqual(quote.amountOut, "996");
  assert.strictEqual(quote.reserveIn, "1000000");
  assert.throws(() => quoteFromSnapshot(snapshot, "0", MUSDT, WBKC));
  assert.throws(() => quoteFromSnapshot(snapshot, "1000", MUSDT, MUSDT));

  const liquidity = liquidityQuoteFromSnapshot(
    { ...snapshot, totalSupply: 1_000_000n }, "100000", "200000"
  );
  assert.strictEqual(liquidity.amountMusdt, "100000");
  assert.strictEqual(liquidity.amountBkc, "100000");
  assert.strictEqual(liquidity.estimatedLiquidity, "100000");
  assert.strictEqual(liquidity.estimatedPoolShareBps, "909");

  let now = 10;
  let reads = 0;
  const cache = new PairReserveCache({
    now: () => now,
    maxAgeMs: 30,
    readReserves: async () => {
      reads += 1;
      return { reserve0: 10n, reserve1: 20n };
    },
  });
  await cache.refresh();
  assert.strictEqual(reads, 1);
  assert.ok(cache.getFreshSnapshot());
  now = 41;
  assert.strictEqual(cache.getFreshSnapshot(), null, "stale reserves must not be served");

  const apiCache = new PairReserveCache({
    readReserves: async () => ({ reserve0: 1_000_000n, reserve1: 2_000_000n, totalSupply: 1_000_000n }),
  });
  await apiCache.refresh();
  const server = createQuoteCacheServer({ cache: apiCache });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    const reservesResponse = await fetch(`http://127.0.0.1:${port}/api/swap/reserves`);
    assert.strictEqual(reservesResponse.status, 200);
    const reserves = await reservesResponse.json();
    assert.strictEqual(reserves.reserve0, "1000000");
    assert.strictEqual(reserves.reserve1, "2000000");

    const quoteResponse = await fetch(
      `http://127.0.0.1:${port}/api/swap/quote?amountIn=1000&tokenIn=${MUSDT}&tokenOut=${WBKC}`
    );
    assert.strictEqual(quoteResponse.status, 200);
    const apiQuote = await quoteResponse.json();
    assert.strictEqual(apiQuote.amountOut, "1992");

    const liquidityResponse = await fetch(
      `http://127.0.0.1:${port}/api/liquidity/quote?amountMusdt=100000&amountBkc=300000`
    );
    assert.strictEqual(liquidityResponse.status, 200);
    const liquidityQuote = await liquidityResponse.json();
    assert.strictEqual(liquidityQuote.amountMusdt, "100000");
    assert.strictEqual(liquidityQuote.amountBkc, "200000");
    assert.strictEqual(liquidityQuote.estimatedLiquidity, "100000");
    assert.strictEqual(liquidityQuote.totalSupply, "1000000");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  console.log("quote-cache-service tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
