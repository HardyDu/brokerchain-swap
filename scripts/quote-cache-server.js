"use strict";

const http = require("http");
const { Interface } = require("ethers");

const CHAIN_ID = 1051;
const PAIR = (process.env.BROKER_SWAP_PAIR || "0xe1b2b75a08143abb64d7206ee52b3b3535c64af3").toLowerCase();
const MUSDT = (process.env.BROKER_SWAP_MUSDT || "0x128306db0c1ff36e3093c08da855329543d69d2d").toLowerCase();
const WBKC = (process.env.BROKER_SWAP_WBKC || "0x2623d7d7dd39e8361241c9c64c9023d57d00d8a2").toLowerCase();
const RPC_URL = process.env.BROKERCHAIN_RPC_URL || "http://127.0.0.1:49282";
const HOST = process.env.QUOTE_CACHE_HOST || "127.0.0.1";
const PORT = Number(process.env.QUOTE_CACHE_PORT || 8088);
const REFRESH_MS = Number(process.env.QUOTE_CACHE_REFRESH_MS || 15_000);
const MAX_AGE_MS = Number(process.env.QUOTE_CACHE_MAX_AGE_MS || 45_000);
const RPC_TIMEOUT_MS = Number(process.env.QUOTE_CACHE_RPC_TIMEOUT_MS || 3_000);
const MAX_QUERY_VALUE_LENGTH = 80;
const MANUAL_REFRESH_COOLDOWN_MS = 5_000;

const pairInterface = new Interface([
  "function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)",
  "function totalSupply() view returns (uint256)",
]);

let rpcId = 0;

function normalizeAddress(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function isPositiveIntegerString(value) {
  return typeof value === "string" && value.length <= MAX_QUERY_VALUE_LENGTH
    && /^[0-9]+$/.test(value) && BigInt(value) > 0n;
}

function quoteAmountOut(amountIn, reserveIn, reserveOut) {
  const input = BigInt(amountIn);
  const inputReserve = BigInt(reserveIn);
  const outputReserve = BigInt(reserveOut);
  if (input <= 0n || inputReserve <= 0n || outputReserve <= 0n) {
    throw new Error("amount and reserves must be positive");
  }
  const inputWithFee = input * 997n;
  return inputWithFee * outputReserve / (inputReserve * 1000n + inputWithFee);
}

function quoteFromSnapshot(snapshot, amountIn, tokenIn, tokenOut) {
  if (!snapshot) throw new Error("reserve cache is warming");
  if (!isPositiveIntegerString(amountIn)) throw new Error("amountIn must be a positive integer string");
  const from = normalizeAddress(tokenIn);
  const to = normalizeAddress(tokenOut);
  if (!((from === MUSDT && to === WBKC) || (from === WBKC && to === MUSDT))) {
    throw new Error("only the configured mUSDT/wBKC Pair is supported");
  }
  const inputIsToken0 = from === MUSDT;
  const reserveIn = inputIsToken0 ? snapshot.reserve0 : snapshot.reserve1;
  const reserveOut = inputIsToken0 ? snapshot.reserve1 : snapshot.reserve0;
  return {
    amountIn: String(amountIn),
    amountOut: quoteAmountOut(amountIn, reserveIn, reserveOut).toString(),
    reserveIn: reserveIn.toString(),
    reserveOut: reserveOut.toString(),
    tokenIn: from,
    tokenOut: to,
  };
}

function liquidityQuoteFromSnapshot(snapshot, amountMusdtDesired, amountBkcDesired) {
  if (!snapshot) throw new Error("reserve cache is warming");
  if (!isPositiveIntegerString(amountMusdtDesired) || !isPositiveIntegerString(amountBkcDesired)) {
    throw new Error("amountMusdt and amountBkc must be positive integer strings");
  }
  if (snapshot.totalSupply === undefined || BigInt(snapshot.totalSupply) <= 0n) {
    throw new Error("LP total supply is unavailable");
  }
  const desiredMusdt = BigInt(amountMusdtDesired);
  const desiredBkc = BigInt(amountBkcDesired);
  const reserveMusdt = BigInt(snapshot.reserve0);
  const reserveBkc = BigInt(snapshot.reserve1);
  const totalSupply = BigInt(snapshot.totalSupply);
  let amountMusdt;
  let amountBkc;
  const bkcOptimal = desiredMusdt * reserveBkc / reserveMusdt;
  if (bkcOptimal <= desiredBkc) {
    amountMusdt = desiredMusdt;
    amountBkc = bkcOptimal;
  } else {
    amountMusdt = desiredBkc * reserveMusdt / reserveBkc;
    amountBkc = desiredBkc;
  }
  const fromMusdt = amountMusdt * totalSupply / reserveMusdt;
  const fromBkc = amountBkc * totalSupply / reserveBkc;
  const estimatedLiquidity = fromMusdt < fromBkc ? fromMusdt : fromBkc;
  const resultingSupply = totalSupply + estimatedLiquidity;
  return {
    amountMusdt: amountMusdt.toString(),
    amountBkc: amountBkc.toString(),
    estimatedLiquidity: estimatedLiquidity.toString(),
    estimatedPoolShareBps: (estimatedLiquidity * 10_000n / resultingSupply).toString(),
  };
}

class PairReserveCache {
  constructor({ readReserves, now = () => Date.now(), maxAgeMs = MAX_AGE_MS }) {
    this.readReserves = readReserves;
    this.now = now;
    this.maxAgeMs = maxAgeMs;
    this.snapshot = null;
    this.refreshPromise = null;
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = Promise.resolve()
      .then(() => this.readReserves())
      .then((reserves) => {
        const reserve0 = BigInt(reserves.reserve0);
        const reserve1 = BigInt(reserves.reserve1);
        if (reserve0 <= 0n || reserve1 <= 0n) throw new Error("Pair reserves are empty");
        const totalSupply = reserves.totalSupply === undefined ? undefined : BigInt(reserves.totalSupply);
        if (totalSupply !== undefined && totalSupply <= 0n) throw new Error("Pair total supply is empty");
        this.snapshot = { reserve0, reserve1, totalSupply, updatedAtMs: this.now() };
        return this.snapshot;
      })
      .finally(() => {
        this.refreshPromise = null;
      });
    return this.refreshPromise;
  }

  getFreshSnapshot() {
    if (!this.snapshot || this.now() - this.snapshot.updatedAtMs > this.maxAgeMs) return null;
    return this.snapshot;
  }
}

async function jsonRpc(method, params) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    signal: controller.signal,
    });
  } catch (error) {
    throw new Error(`${method} RPC unavailable: ${error.name === "AbortError" ? "timeout" : error.message}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`${method} failed: ${JSON.stringify(payload.error)}`);
  if (typeof payload.result !== "string" || payload.result === "0x") {
    throw new Error(`${method} returned no result`);
  }
  return payload.result;
}

async function readPairReserves() {
  const data = pairInterface.encodeFunctionData("getReserves");
  const result = await jsonRpc("eth_call", [{ to: PAIR, data }, "latest"]);
  const decoded = pairInterface.decodeFunctionResult("getReserves", result);
  const supplyData = pairInterface.encodeFunctionData("totalSupply");
  const supplyResult = await jsonRpc("eth_call", [{ to: PAIR, data: supplyData }, "latest"]);
  const supplyDecoded = pairInterface.decodeFunctionResult("totalSupply", supplyResult);
  return { reserve0: decoded[0], reserve1: decoded[1], totalSupply: supplyDecoded[0] };
}

function publicSnapshot(snapshot, now = Date.now()) {
  const result = {
    chainId: CHAIN_ID,
    pair: PAIR,
    token0: MUSDT,
    token1: WBKC,
    reserve0: snapshot.reserve0.toString(),
    reserve1: snapshot.reserve1.toString(),
    updatedAtMs: snapshot.updatedAtMs,
    ageMs: Math.max(0, now - snapshot.updatedAtMs),
  };
  if (snapshot.totalSupply !== undefined) result.totalSupply = snapshot.totalSupply.toString();
  return result;
}

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  response.end(JSON.stringify(body));
}

function createQuoteCacheServer({ cache, now = () => Date.now() }) {
  let lastManualRefreshAtMs = 0;
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.href.length > 2048) {
      writeJson(response, 414, { error: "request URI too long" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, { ok: true, cacheReady: cache.getFreshSnapshot() !== null });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/swap/reserves") {
      const snapshot = cache.getFreshSnapshot();
      if (!snapshot) {
        writeJson(response, 503, { error: "reserve cache warming or stale" });
        return;
      }
      writeJson(response, 200, publicSnapshot(snapshot, now()));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/swap/quote") {
      const snapshot = cache.getFreshSnapshot();
      if (!snapshot) {
        writeJson(response, 503, { error: "reserve cache warming or stale" });
        return;
      }
      try {
        const quote = quoteFromSnapshot(
          snapshot,
          url.searchParams.get("amountIn") || "",
          url.searchParams.get("tokenIn") || "",
          url.searchParams.get("tokenOut") || ""
        );
        writeJson(response, 200, { ...publicSnapshot(snapshot, now()), ...quote });
      } catch (error) {
        writeJson(response, 400, { error: error.message });
      }
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/liquidity/pool") {
      const snapshot = cache.getFreshSnapshot();
      if (!snapshot) {
        writeJson(response, 503, { error: "reserve cache warming or stale" });
        return;
      }
      if (snapshot.totalSupply === undefined) {
        writeJson(response, 503, { error: "LP total supply is unavailable" });
        return;
      }
      writeJson(response, 200, publicSnapshot(snapshot, now()));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/liquidity/quote") {
      const snapshot = cache.getFreshSnapshot();
      if (!snapshot) {
        writeJson(response, 503, { error: "reserve cache warming or stale" });
        return;
      }
      try {
        const quote = liquidityQuoteFromSnapshot(
          snapshot,
          url.searchParams.get("amountMusdt") || "",
          url.searchParams.get("amountBkc") || ""
        );
        writeJson(response, 200, { ...publicSnapshot(snapshot, now()), ...quote });
      } catch (error) {
        writeJson(response, 400, { error: error.message });
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/swap/reserves/refresh") {
      if (now() - lastManualRefreshAtMs < MANUAL_REFRESH_COOLDOWN_MS) {
        writeJson(response, 429, { error: "refresh rate limited" });
        return;
      }
      lastManualRefreshAtMs = now();
      try {
        const snapshot = await cache.refresh();
        writeJson(response, 200, publicSnapshot(snapshot, now()));
      } catch (error) {
        writeJson(response, 503, { error: error.message });
      }
      return;
    }
    writeJson(response, 404, { error: "not found" });
  });
}

async function main() {
  const cache = new PairReserveCache({ readReserves: readPairReserves });
  try {
    await cache.refresh();
    console.log("Initial Pair reserve cache is ready.");
  } catch (error) {
    console.warn(`Initial reserve read failed: ${error.message}`);
  }
  setInterval(() => {
    cache.refresh().catch((error) => console.warn(`Reserve refresh failed: ${error.message}`));
  }, REFRESH_MS).unref();
  const server = createQuoteCacheServer({ cache });
  server.listen(PORT, HOST, () => {
    console.log(`BrokerSwap quote cache listening on http://${HOST}:${PORT}`);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  MUSDT,
  WBKC,
  PairReserveCache,
  createQuoteCacheServer,
  liquidityQuoteFromSnapshot,
  quoteAmountOut,
  quoteFromSnapshot,
};
