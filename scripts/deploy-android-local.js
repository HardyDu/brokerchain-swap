"use strict";

// Deploy the full swap stack to the local Supervisor chain (chainId 1051).
// Signs with the deployer private key and sends via eth_sendRawTransaction.
// This script continues from where the initial deployment left off (factory, wbkc, musdt already deployed)

const { ContractFactory, Wallet, getAddress, Interface, keccak256 } = require("ethers");
const http = require("http");
const fs = require("fs");
const path = require("path");

const RPC_URL = "http://127.0.0.1:42515";
// Supply this only in the shell that performs the local deployment. Never
// commit a deployment key, including a test-only key, to the repository.
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const DEPLOYER_ADDR = "0x3a13aeF844a9FE0cbfDfE94B220c9eb69F10E625";
const GAS_LIMIT_DEPLOY = 3000000;
const GAS_LIMIT_TX = 500000;
const GAS_PRICE = 1000000000;

// Addresses from the first script run
const FACTORY = "0x903e5baa9f5e99225a4dca4a200cba5320991e3c";
const WBKC = "0x2623d7d7dd39e8361241c9c64c9023d57d00d8a2";
const MUSDT = "0x128306db0c1ff36e3093c08da855329543d69d2d";
const PAIR = "0xe1b2b75a08143abb64d7206ee52b3b3535c64af3";

// Artifacts
const factoryArtifact = require("../artifacts/contracts/broker-swap-core/UniswapV2Factory.sol/UniswapV2Factory.json");
const mockWbkcArtifact = require("../artifacts/contracts/mock/MockWBKC.sol/MockWBKC.json");
const mockUsdtArtifact = require("../artifacts/contracts/mock/MockUSDT.sol/MockUSDT.json");
const pairArtifact = require("../artifacts/contracts/broker-swap-core/UniswapV2Pair.sol/UniswapV2Pair.json");
const miniRouterArtifact = require("../artifacts/contracts/broker-swap-periphery/BrokerSwapRouterMiniV2.sol/BrokerSwapRouterMiniV2.json");
const liquidityRouterArtifact = require("../artifacts/contracts/broker-swap-periphery/BrokerLiquidityRouter.sol/BrokerLiquidityRouter.json");

let rpcId = 0;
let nonce = null;

async function rpc(method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params });
  const payload = await new Promise((resolve, reject) => {
    const req = http.request(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      timeout: 120000,
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { raw += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
  if (payload.error) throw new Error(`${method} failed: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

async function getNonce() {
  if (nonce !== null) return nonce++;
  const countHex = await rpc("eth_getTransactionCount", [DEPLOYER_ADDR, "latest"]);
  nonce = parseInt(countHex, 16);
  if (isNaN(nonce)) nonce = 0;
  return nonce++;
}

async function sendRaw(rawTxHex) {
  const hash = await rpc("eth_sendRawTransaction", [rawTxHex]);
  if (!hash) throw new Error("eth_sendRawTransaction returned null");
  return hash;
}

async function waitForReceipt(txHash) {
  for (let i = 0; i < 200; i++) {
    const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
    if (receipt && receipt !== "0x") return receipt;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Timed out: ${txHash}`);
}

async function deployContract(artifact, args = [], label = "contract") {
  const factory = new ContractFactory(artifact.abi, artifact.bytecode);
  const deployTx = await factory.getDeployTransaction(...args);
  const n = await getNonce();
  const tx = {
    nonce: "0x" + n.toString(16),
    gasLimit: "0x" + GAS_LIMIT_DEPLOY.toString(16),
    gasPrice: "0x" + GAS_PRICE.toString(16),
    data: deployTx.data,
    value: "0x0",
    chainId: 1051,
  };
  const wallet = new Wallet(PRIVATE_KEY);
  const signed = await wallet.signTransaction(tx);
  console.log(`Deploying ${label}... nonce=${n}`);
  const hash = await sendRaw(signed);
  console.log(`  txHash: ${hash}`);
  const receipt = await waitForReceipt(hash);
  const addr = receipt.contractAddress;
  console.log(`  address: ${addr}  gasUsed: ${parseInt(receipt.gasUsed, 16)}  status: ${receipt.status}`);
  if (receipt.status !== "0x1" || !addr) throw new Error(`${label} deploy failed`);
  return { address: getAddress(addr), txHash: hash };
}

async function sendTx(to, data, value = "0x0", label = "tx") {
  const n = await getNonce();
  const tx = {
    nonce: "0x" + n.toString(16),
    gasLimit: "0x" + GAS_LIMIT_TX.toString(16),
    gasPrice: "0x" + GAS_PRICE.toString(16),
    to, data, value,
    chainId: 1051,
  };
  const wallet = new Wallet(PRIVATE_KEY);
  const signed = await wallet.signTransaction(tx);
  console.log(`Sending ${label}... nonce=${n}`);
  const hash = await sendRaw(signed);
  console.log(`  txHash: ${hash}`);
  const receipt = await waitForReceipt(hash);
  console.log(`  status: ${receipt.status}  gasUsed: ${parseInt(receipt.gasUsed, 16)}`);
  if (receipt.status !== "0x1") console.warn(`  WARNING: ${label} may have failed`);
  return { txHash: hash, receipt };
}

async function main() {
  if (!PRIVATE_KEY) {
    throw new Error("Set DEPLOYER_PRIVATE_KEY in the current shell before running this deployment script.");
  }
  if (new Wallet(PRIVATE_KEY).address.toLowerCase() !== DEPLOYER_ADDR.toLowerCase()) {
    throw new Error("DEPLOYER_PRIVATE_KEY does not match DEPLOYER_ADDR; refusing to deploy.");
  }

  console.log("=== BrokerSwap Deployment (Resume from deployed base) ===\n");
  console.log(`Deployer: ${DEPLOYER_ADDR}`);
  console.log(`Factory: ${FACTORY}`);
  console.log(`WBKC: ${WBKC}`);
  console.log(`mUSDT: ${MUSDT}`);
  console.log(`Pair: ${PAIR}`);

  // Verify existing deployments
  const factoryCode = await rpc("eth_getCode", [FACTORY, "latest"]);
  console.log(`Factory code: ${(factoryCode.length - 2) / 2} bytes`);

  const pairCode = await rpc("eth_getCode", [PAIR, "latest"]);
  console.log(`Pair code: ${(pairCode.length - 2) / 2} bytes`);

  // Check current nonce
  const currentNonce = parseInt(await rpc("eth_getTransactionCount", [DEPLOYER_ADDR, "latest"]), 16);
  console.log(`Current nonce: ${currentNonce}`);
  nonce = currentNonce;

  // Add liquidity
  console.log("\n=== Adding Initial Liquidity ===");
  const wbkcIface = new Interface(mockWbkcArtifact.abi);
  const musdtIface = new Interface(mockUsdtArtifact.abi);
  const pairIface = new Interface(pairArtifact.abi);

  // 1. Wrap 100 BKC
  const wbkcAmount = 100n * 10n**18n;
  console.log(`\n1. Wrapping ${wbkcAmount / 10n**18n} BKC -> wBKC`);
  await sendTx(WBKC, wbkcIface.encodeFunctionData("deposit", []),
    "0x" + wbkcAmount.toString(16), "deposit()");

  // 2. Transfer wBKC to pair
  console.log(`\n2. Transfer wBKC to pair`);
  await sendTx(WBKC, wbkcIface.encodeFunctionData("transfer", [PAIR, wbkcAmount]),
    "0x0", "transfer wBKC to pair");

  // 3. Transfer mUSDT to pair
  const musdtAmount = 10000n * 10n**6n;
  console.log(`\n3. Transfer ${musdtAmount / 10n**6n} mUSDT to pair`);
  await sendTx(MUSDT, musdtIface.encodeFunctionData("transfer", [PAIR, musdtAmount]),
    "0x0", "transfer mUSDT to pair");

  // 4. Mint LP tokens
  console.log(`\n4. Mint LP tokens`);
  await sendTx(PAIR, pairIface.encodeFunctionData("mint", [DEPLOYER_ADDR]),
    "0x0", "mint()");

  // 5. Verify reserves
  const reservesData = pairIface.encodeFunctionData("getReserves", []);
  const reservesRaw = await rpc("eth_call", [{ to: PAIR, from: DEPLOYER_ADDR, data: reservesData }, "latest"]);
  console.log(`\n5. Reserves raw (eth_call): ${reservesRaw}`);

  // 6. Deploy MiniRouterV2
  console.log(`\n6. Deploying MiniRouterV2`);
  const miniRouter = await deployContract(miniRouterArtifact,
    [FACTORY, WBKC, MUSDT], "BrokerSwapRouterMiniV2");

  // 7. Deploy LiquidityRouter
  console.log(`\n7. Deploying LiquidityRouter`);
  const liquidityRouter = await deployContract(liquidityRouterArtifact,
    [FACTORY, WBKC, MUSDT], "BrokerLiquidityRouter");
  const liquidityRouterCode = await rpc("eth_getCode", [liquidityRouter.address, "latest"]);
  if (!liquidityRouterCode || liquidityRouterCode === "0x") {
    throw new Error("BrokerLiquidityRouter deployment has no runtime bytecode");
  }
  const liquidityRouterRuntimeHash = keccak256(liquidityRouterCode);

  // Summary
  const summary = {
    network: "BrokerChain Android Local Test",
    rpcUrl: RPC_URL,
    chainId: 1051,
    deployer: DEPLOYER_ADDR,
    factory: FACTORY,
    wbkc: WBKC,
    musdt: MUSDT,
    pair: PAIR,
    router: miniRouter.address,
    miniRouter: miniRouter.address,
    liquidityRouter: liquidityRouter.address,
    liquidityRouterRuntimeHash,
    routerDeploymentTx: miniRouter.txHash,
    liquidityRouterDeploymentTx: liquidityRouter.txHash,
  };

  console.log("\n=== Summary ===");
  console.log(JSON.stringify(summary, null, 2));

  // Write to deployments
  fs.writeFileSync(path.join(__dirname, "..", "deployments", "brokerchain-android-local.json"),
    JSON.stringify(summary, null, 2));

  // Write Android asset
  const androidAsset = {
    chainId: 1051, chainName: "BrokerChain", deployedAt: new Date().toISOString(),
    factory: FACTORY, router: miniRouter.address, miniRouter: miniRouter.address,
    liquidityRouter: liquidityRouter.address,
    liquidityRouterRuntimeHash,
    liquidityRouterDeploymentTx: liquidityRouter.txHash,
    routerDeploymentTx: miniRouter.txHash,
    wbkc: WBKC, mockUsdt: MUSDT,
    pair: {
      token0: WBKC.toLowerCase() < MUSDT.toLowerCase() ? WBKC : MUSDT,
      token1: WBKC.toLowerCase() < MUSDT.toLowerCase() ? MUSDT : WBKC,
      address: PAIR,
    },
    initialPrice: { rate: "1 BKC = 100 mUSDT", liquidityWbkc: "100", liquidityMusdt: "10000" },
  };

  const androidPath = path.join(__dirname, "..", "brokerwallet-android-localtest", "app", "src", "main", "assets", "broker_swap_deployment.json");
  fs.writeFileSync(androidPath, JSON.stringify(androidAsset, null, 2));
  console.log(`\nAndroid asset written to: ${androidPath}`);
  console.log("\n=== ALL DONE ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
