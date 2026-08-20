const { Interface } = require("ethers");

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:49282";
const ACCOUNT = process.env.DEPLOYER || "0xc9791f2f86a7f11af0c257480765024f002e77b7";
const ROUTER = process.env.MINI_ROUTER_V2 || "0x463ea41fdd04bbd0f821291ab825c472ea6a2ffe";
const MUSDT = "0x2881B7eFad41d88F3C244fBB3503dF3E12Bc0B26";
const WBKC = "0x4761865CA85000B23DF6fB00D2c4F81aa873513B";
const PAIR = "0x40283F8EccEC16386081B1e4A1E83C5C8939adcb";

const MUSDT_INPUT = 1_000_000n;
const BKC_INPUT = 1_000_000_000_000_000n;
const SLIPPAGE_BPS = 100n;
const BPS = 10_000n;

const erc20 = new Interface([
  "function approve(address,uint256) returns (bool)",
]);
const router = new Interface([
  "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])",
  "function swapExactTokensForBKC(uint256,uint256,address[],address,uint256) returns (uint256[])",
  "function swapExactBKCForTokens(uint256,address[],address,uint256) payable returns (uint256[])",
  "function swapExactMusdtForWbkc(uint256,uint256,uint256,address,uint256) returns (uint256)",
  "function swapExactMusdtForBkc(uint256,uint256,uint256,address,uint256) returns (uint256)",
  "function swapExactBkcForMusdt(uint256,uint256,address,uint256) payable returns (uint256)",
]);
const pair = new Interface([
  "function sync()",
  "event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)",
  "event Sync(uint112 reserve0,uint112 reserve1)",
]);

let rpcId = 0;

async function rpc(method, params) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method} failed: ${JSON.stringify(payload.error)}`);
  }
  return payload.result;
}

async function waitForReceipt(transactionHash) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const receipt = await rpc("eth_getTransactionReceipt", [transactionHash]);
    if (receipt && receipt !== "0x") return receipt;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for receipt: ${transactionHash}`);
}

function toHex(value) {
  return `0x${BigInt(value).toString(16)}`;
}

async function send(label, to, data, value = 0n, gas = 600_000n) {
  let transactionHash;
  try {
    transactionHash = await rpc("eth_sendTransaction", [{
      from: ACCOUNT,
    to,
    data,
    value: toHex(value),
    // BrokerChain's gateway forwards this field to an internal decimal parser.
    gas: BigInt(gas).toString(),
  }]);
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
  if (!transactionHash) throw new Error(`${label} returned no transaction hash.`);

  const receipt = await waitForReceipt(transactionHash);
  if (receipt.status !== "0x1") {
    throw new Error(`${label} failed: ${JSON.stringify(receipt)}`);
  }
  console.log(JSON.stringify({
    step: label,
    transactionHash,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
  }));
  return { label, transactionHash, receipt };
}

function parsePairEvents(receipt) {
  const events = [];
  for (const log of receipt.logs || []) {
    if (log.address.toLowerCase() !== PAIR.toLowerCase()) continue;
    try {
      const parsed = pair.parseLog(log);
      events.push({
        name: parsed.name,
        args: Array.from(parsed.args).map((value) =>
          typeof value === "bigint" ? value.toString() : value
        ),
      });
    } catch {}
  }
  return events;
}

function reservesFrom(receipt) {
  const sync = parsePairEvents(receipt).find((event) => event.name === "Sync");
  if (!sync) throw new Error("Pair Sync event was not found in the receipt.");
  return { musdt: BigInt(sync.args[0]), wbkc: BigInt(sync.args[1]) };
}

function amountOut(amountIn, reserveIn, reserveOut) {
  const amountInWithFee = amountIn * 997n;
  return amountInWithFee * reserveOut / (reserveIn * 1000n + amountInWithFee);
}

function minimum(output) {
  return output * (BPS - SLIPPAGE_BPS) / BPS;
}

function deadline() {
  return BigInt(Math.floor(Date.now() / 1000) + 3600);
}

async function approveMusdt() {
  return send(
    "approve 1 mUSDT",
    MUSDT,
    erc20.encodeFunctionData("approve", [ROUTER, MUSDT_INPUT]),
    0n,
    150_000n
  );
}

async function main() {
  const firstOnly = process.argv.includes("--first-only");
  const walletAbi = process.argv.includes("--wallet-abi");
  if (!process.argv.includes("--send")) {
    console.log(JSON.stringify({
      send: false,
      rpc: RPC_URL,
      account: ACCOUNT,
      router: ROUTER,
      pair: PAIR,
      firstOnly,
      walletAbi,
      tests: ["mUSDT->WBKC", "mUSDT->BKC", "BKC->mUSDT"],
    }, null, 2));
    return;
  }

  const results = [];
  const initialSync = await send("sync Pair", PAIR, pair.encodeFunctionData("sync"), 0n, 200_000n);
  let reserves = reservesFrom(initialSync.receipt);
  results.push({
    label: initialSync.label,
    transactionHash: initialSync.transactionHash,
    reserves: { musdt: reserves.musdt.toString(), wbkc: reserves.wbkc.toString() },
  });

  results.push(await approveMusdt());
  let quoted = amountOut(MUSDT_INPUT, reserves.musdt, reserves.wbkc);
  const tokenSwap = await send(
    "swap 1 mUSDT for WBKC",
    ROUTER,
    walletAbi
      ? router.encodeFunctionData("swapExactTokensForTokens", [
          MUSDT_INPUT, minimum(quoted), [MUSDT, WBKC], ACCOUNT, deadline(),
        ])
      : router.encodeFunctionData("swapExactMusdtForWbkc", [
          MUSDT_INPUT, quoted, minimum(quoted), ACCOUNT, deadline(),
        ])
  );
  reserves = reservesFrom(tokenSwap.receipt);
  results.push({
    label: tokenSwap.label,
    transactionHash: tokenSwap.transactionHash,
    quotedOut: quoted.toString(),
    pairEvents: parsePairEvents(tokenSwap.receipt),
  });

  if (firstOnly) {
    console.log(JSON.stringify({
      router: ROUTER,
      status: "mUSDT->WBKC passed",
      pairEvents: parsePairEvents(tokenSwap.receipt),
    }, null, 2));
    return;
  }

  results.push(await approveMusdt());
  quoted = amountOut(MUSDT_INPUT, reserves.musdt, reserves.wbkc);
  const nativeOutSwap = await send(
    "swap 1 mUSDT for native BKC",
    ROUTER,
    walletAbi
      ? router.encodeFunctionData("swapExactTokensForBKC", [
          MUSDT_INPUT, minimum(quoted), [MUSDT, WBKC], ACCOUNT, deadline(),
        ])
      : router.encodeFunctionData("swapExactMusdtForBkc", [
          MUSDT_INPUT, quoted, minimum(quoted), ACCOUNT, deadline(),
        ])
  );
  reserves = reservesFrom(nativeOutSwap.receipt);
  results.push({
    label: nativeOutSwap.label,
    transactionHash: nativeOutSwap.transactionHash,
    quotedOut: quoted.toString(),
    pairEvents: parsePairEvents(nativeOutSwap.receipt),
  });

  quoted = amountOut(BKC_INPUT, reserves.wbkc, reserves.musdt);
  const nativeInSwap = await send(
    "swap 0.001 BKC for mUSDT",
    ROUTER,
    walletAbi
      ? router.encodeFunctionData("swapExactBKCForTokens", [
          minimum(quoted), [WBKC, MUSDT], ACCOUNT, deadline(),
        ])
      : router.encodeFunctionData("swapExactBkcForMusdt", [
          quoted, minimum(quoted), ACCOUNT, deadline(),
        ]),
    BKC_INPUT
  );
  reserves = reservesFrom(nativeInSwap.receipt);
  results.push({
    label: nativeInSwap.label,
    transactionHash: nativeInSwap.transactionHash,
    quotedOut: quoted.toString(),
    pairEvents: parsePairEvents(nativeInSwap.receipt),
  });

  console.log(JSON.stringify({
    router: ROUTER,
    status: walletAbi ? "all wallet ABI swaps passed" : "all swaps passed",
    finalReserves: { musdt: reserves.musdt.toString(), wbkc: reserves.wbkc.toString() },
    results: results.map((result) => ({
      label: result.label,
      transactionHash: result.transactionHash,
      quotedOut: result.quotedOut,
      reserves: result.reserves,
      pairEvents: result.pairEvents,
      gasUsed: result.receipt && result.receipt.gasUsed,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
