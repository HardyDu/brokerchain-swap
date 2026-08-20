"use strict";

const { ContractFactory, Interface, getAddress, keccak256 } = require("ethers");
const http = require("http");
const https = require("https");
const artifact = require("../artifacts/contracts/broker-swap-periphery/BrokerLiquidityRouter.sol/BrokerLiquidityRouter.json");

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:58427/";
const RPC_CHAIN_ID = 4176n;
const ANDROID_CHAIN_ID = 1051;
const FACTORY = "0xB1185C2A9077cE35572CffABf825DD2DB299A662";
const WBKC = "0x4761865CA85000B23DF6fB00D2c4F81aa873513B";
const MUSDT = "0x2881B7eFad41d88F3C244fBB3503dF3E12Bc0B26";
const PAIR = "0x40283F8EccEC16386081B1e4A1E83C5C8939adcb";
const SWAP_ROUTER = "0x463ea41fdd04bbd0f821291ab825c472ea6a2ffe";
const GAS_LIMIT = process.env.GAS_LIMIT || "0x2dc6c0";
// Pinned from the already validated BrokerChain deployment at the fixed addresses.
const FACTORY_RUNTIME_HASH = "0x605d273adb5c0eb0455bdd7829c337cf0d5c9f34b8d08eb6f76f235d9039f11b";
const PAIR_RUNTIME_HASH = "0x282946f0bf1371d0b2fa8ccb307508b5c1c133fbb4f49bf1d971ac30f6ac7673";
const SWAP_ROUTER_RUNTIME_HASH = "0xdc961f6baa034fa10378a5069846cb5951f49d5427e8e1ca2270f9254d5ada2c";

const abi = new Interface([
  "function getPair(address,address) view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function factory() view returns (address)",
  "function WBKC() view returns (address)",
  "function musdt() view returns (address)",
  "function pair() view returns (address)",
]);

let rpcId = 0;

async function rpc(method, params) {
  const target = new URL(RPC_URL);
  const body = JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params });
  const transport = target.protocol === "https:" ? https : http;
  const payload = await new Promise((resolve, reject) => {
    const request = transport.request(target, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => {
        if ((response.statusCode || 500) >= 400) {
          reject(new Error(`${method} HTTP ${response.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.end(body);
  });
  if (payload.error) throw new Error(`${method} failed: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

async function call(to, functionName, args = []) {
  const data = abi.encodeFunctionData(functionName, args);
  const result = await rpc("eth_call", [{ to, data }, "latest"]);
  if (!result || result === "0x") throw new Error(`${functionName} returned no result from ${to}`);
  return abi.decodeFunctionResult(functionName, result)[0];
}

async function requireCode(address, label) {
  const code = await rpc("eth_getCode", [address, "latest"]);
  if (!code || code === "0x") throw new Error(`${label} has no runtime code at ${address}`);
  return (code.length - 2) / 2;
}

async function requireRuntimeHash(address, expectedHash, label) {
  const code = await rpc("eth_getCode", [address, "latest"]);
  if (keccak256(code) !== expectedHash) {
    throw new Error(`${label} runtime bytecode hash changed at ${address}`);
  }
}

function requireAddress(actual, expected, label) {
  if (getAddress(actual) !== getAddress(expected)) {
    throw new Error(`${label} mismatch: ${actual} != ${expected}`);
  }
}

async function waitForReceipt(hash) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt && receipt !== "0x") return receipt;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(`Timed out waiting for deployment receipt: ${hash}`);
}

async function preflight() {
  const chainId = BigInt(await rpc("eth_chainId", []));
  if (chainId !== RPC_CHAIN_ID) throw new Error(`Unexpected RPC chain ID ${chainId}`);
  const accounts = await rpc("eth_accounts", []);
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error("Local wallet exposes no unlocked account");
  const deployer = getAddress(accounts[0]);
  const balance = BigInt(await rpc("eth_getBalance", [deployer, "latest"]));
  if (balance <= 0n) throw new Error("Unlocked deployer has no BKC for gas");

  const codeBytes = {
    factory: await requireCode(FACTORY, "Factory"),
    wbkc: await requireCode(WBKC, "WBKC"),
    musdt: await requireCode(MUSDT, "mUSDT"),
    pair: await requireCode(PAIR, "Pair"),
    swapRouter: await requireCode(SWAP_ROUTER, "fixed Swap Router"),
  };
  await requireRuntimeHash(FACTORY, FACTORY_RUNTIME_HASH, "Factory");
  await requireRuntimeHash(PAIR, PAIR_RUNTIME_HASH, "Pair");
  await requireRuntimeHash(SWAP_ROUTER, SWAP_ROUTER_RUNTIME_HASH, "fixed Swap Router");

  // BrokerChain's current gateway returns an empty eth_call result even through the logged-in
  // wallet. Exact runtime matches plus the existing tested Router constructor are therefore the
  // strongest available read-only relationship evidence. The new constructor repeats getPair()
  // atomically and the deployment will revert if the fixed Pair mapping is not present.
  let relationshipRead = "verified";
  try {
    requireAddress(await call(FACTORY, "getPair", [WBKC, MUSDT]), PAIR, "Factory Pair");
    const token0 = await call(PAIR, "token0");
    const token1 = await call(PAIR, "token1");
    const pairTokens = new Set([getAddress(token0), getAddress(token1)]);
    if (!pairTokens.has(getAddress(WBKC)) || !pairTokens.has(getAddress(MUSDT))) {
      throw new Error(`Pair tokens mismatch: ${token0}, ${token1}`);
    }
  } catch (error) {
    if (!String(error.message).includes("returned no result")) throw error;
    relationshipRead = "gateway_eth_call_unavailable; enforced again by constructor";
  }
  return {
    chainId: chainId.toString(), androidChainId: ANDROID_CHAIN_ID, deployer,
    balanceWei: balance.toString(), codeBytes, relationshipRead,
  };
}

async function verifyDeployment(address) {
  const runtimeBytes = await requireCode(address, "Liquidity Router");
  requireAddress(await call(address, "factory"), FACTORY, "Liquidity Router Factory");
  requireAddress(await call(address, "WBKC"), WBKC, "Liquidity Router WBKC");
  requireAddress(await call(address, "musdt"), MUSDT, "Liquidity Router mUSDT");
  requireAddress(await call(address, "pair"), PAIR, "Liquidity Router Pair");
  return { runtimeBytes };
}

async function main() {
  const send = process.argv.includes("--send");
  const state = await preflight();
  const factory = new ContractFactory(artifact.abi, artifact.bytecode);
  const deployment = await factory.getDeployTransaction(FACTORY, WBKC, MUSDT);
  const summary = {
    send,
    rpc: RPC_URL,
    ...state,
    fixedSwapRouter: SWAP_ROUTER,
    constructor: { factory: FACTORY, wbkc: WBKC, musdt: MUSDT, expectedPair: PAIR },
    creationBytes: (deployment.data.length - 2) / 2,
    gasLimit: GAS_LIMIT,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!send) return;

  const transactionHash = await rpc("eth_sendTransaction", [{
    from: state.deployer,
    data: deployment.data,
    value: "0x0",
    gas: GAS_LIMIT,
  }]);
  if (!transactionHash) throw new Error("BrokerChain wallet returned no deployment transaction hash");
  console.log(JSON.stringify({ transactionHash, state: "submitted" }));
  const receipt = await waitForReceipt(transactionHash);
  if (receipt.status !== "0x1" || !receipt.contractAddress) {
    throw new Error(`Deployment failed: ${JSON.stringify(receipt)}`);
  }
  const verification = await verifyDeployment(receipt.contractAddress);
  console.log(JSON.stringify({
    transactionHash,
    contractAddress: getAddress(receipt.contractAddress),
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    status: receipt.status,
    ...verification,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
