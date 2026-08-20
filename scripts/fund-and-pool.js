"use strict";

// Transfer 100 BKC + 100000 mUSDT to a given user address,
// then add 1000 BKC + 1000 mUSDT liquidity to the Pair.
// Usage: node fund-and-pool.js 0xUSER_ADDRESS

const { Wallet, Interface } = require("ethers");
const http = require("http");

const RPC = "http://127.0.0.1:42515";
const PK = "c2247f8c3ba809c09e004b28d3726ee2a6f865028769ab5f02dbd13a732c4de2";
const wallet = new Wallet(PK);
const DEPLOYER = "0x3a13aeF844a9FE0cbfDfE94B220c9eb69F10E625";

const FACTORY = "0x903e5baa9f5e99225a4dca4a200cba5320991e3c";
const WBKC = "0x2623d7d7dd39e8361241c9c64c9023d57d00d8a2";
const MUSDT = "0x128306db0c1ff36e3093c08da855329543d69d2d";
const PAIR = "0xe1b2b75a08143abb64d7206ee52b3b3535c64af3";

const wbkcIface = new Interface([
  "function deposit() payable",
  "function transfer(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const musdtIface = new Interface([
  "function transfer(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const pairIface = new Interface([
  "function mint(address) returns (uint256)",
]);

async function rpc(method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  return new Promise((resolve, reject) => {
    const req = http.request(RPC, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      timeout: 120000,
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { raw += c; });
      res.on("end", () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function getNonce() {
  const r = await rpc("eth_getTransactionCount", [DEPLOYER, "latest"]);
  return parseInt(r.result, 16);
}

async function sendTx(to, data, value, label) {
  const nonce = await getNonce();
  const tx = {
    to, nonce,
    gasLimit: 500000,
    gasPrice: 1000000000,
    data,
    value: value || "0x0",
    chainId: 1051,
  };
  const signed = await wallet.signTransaction(tx);
  const r = await rpc("eth_sendRawTransaction", [signed]);
  if (!r.result) throw new Error(label + ": no hash");
  console.log("  " + label + " nonce=" + nonce + " hash=" + r.result);
  return r.result;
}

async function waitReceipt(hash, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 240000);
  while (Date.now() < deadline) {
    const r = await rpc("eth_getTransactionReceipt", [hash]);
    if (r.result && r.result !== "0x") return r.result;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Timeout waiting for " + hash);
}

async function main() {
  const userAddr = (process.argv[2] || "").toLowerCase().trim();
  if (!/^0x[0-9a-f]{40}$/.test(userAddr)) {
    console.log("Usage: node fund-and-pool.js 0xUSER_ADDRESS");
    console.log("Please provide your wallet address from the app.");
    process.exit(1);
  }

  console.log("=== Fund User & Add Pool Liquidity ===");
  console.log("User: " + userAddr);
  console.log("Deployer: " + DEPLOYER);

  const userWbkcAmt = 100n * 10n**18n;
  const userMusdtAmt = 100000n * 10n**6n;
  const poolWbkcAmt = 1000n * 10n**18n;
  const poolMusdtAmt = 1000n * 10n**6n;

  // 1. Wrap BKC to get wBKC (we need enough for user + pool)
  const totalWbkcNeeded = userWbkcAmt + poolWbkcAmt;
  console.log("\n1. Wrapping " + (Number(totalWbkcNeeded) / 1e18) + " BKC -> wBKC");
  const h1 = await sendTx(WBKC, wbkcIface.encodeFunctionData("deposit"), "0x" + totalWbkcNeeded.toString(16), "deposit()");
  await waitReceipt(h1);

  // 2. Transfer wBKC to user
  console.log("\n2. Transfer " + (Number(userWbkcAmt) / 1e18) + " wBKC to user");
  const h2 = await sendTx(WBKC, wbkcIface.encodeFunctionData("transfer", [userAddr, userWbkcAmt]), "0x0", "transfer wBKC to user");
  await waitReceipt(h2);

  // 3. Transfer mUSDT to user
  console.log("\n3. Transfer " + (Number(userMusdtAmt) / 1e6) + " mUSDT to user");
  const h3 = await sendTx(MUSDT, musdtIface.encodeFunctionData("transfer", [userAddr, userMusdtAmt]), "0x0", "transfer mUSDT to user");
  await waitReceipt(h3);

  // 4. Transfer wBKC to Pair
  console.log("\n4. Transfer " + (Number(poolWbkcAmt) / 1e18) + " wBKC to Pair");
  const h4 = await sendTx(WBKC, wbkcIface.encodeFunctionData("transfer", [PAIR, poolWbkcAmt]), "0x0", "transfer wBKC to pair");
  await waitReceipt(h4);

  // 5. Transfer mUSDT to Pair
  console.log("\n5. Transfer " + (Number(poolMusdtAmt) / 1e6) + " mUSDT to Pair");
  const h5 = await sendTx(MUSDT, musdtIface.encodeFunctionData("transfer", [PAIR, poolMusdtAmt]), "0x0", "transfer mUSDT to pair");
  await waitReceipt(h5);

  // 6. Mint LP tokens
  console.log("\n6. Mint LP tokens");
  const h6 = await sendTx(PAIR, pairIface.encodeFunctionData("mint", [DEPLOYER]), "0x0", "mint()");
  await waitReceipt(h6);

  // Verify final balances
  console.log("\n=== Verification ===");
  const wbkcBalUserHex = (await rpc("eth_call", [{ to: WBKC, from: DEPLOYER, data: wbkcIface.encodeFunctionData("balanceOf", [userAddr]) }, "latest"])).result;
  const musdtBalUserHex = (await rpc("eth_call", [{ to: MUSDT, from: DEPLOYER, data: musdtIface.encodeFunctionData("balanceOf", [userAddr]) }, "latest"])).result;
  const wbkcBalPairHex = (await rpc("eth_call", [{ to: WBKC, from: DEPLOYER, data: wbkcIface.encodeFunctionData("balanceOf", [PAIR]) }, "latest"])).result;
  const musdtBalPairHex = (await rpc("eth_call", [{ to: MUSDT, from: DEPLOYER, data: musdtIface.encodeFunctionData("balanceOf", [PAIR]) }, "latest"])).result;

  console.log("User wBKC:  " + (Number(BigInt(wbkcBalUserHex)) / 1e18).toFixed(2));
  console.log("User mUSDT: " + (Number(BigInt(musdtBalUserHex)) / 1e6).toFixed(2));
  console.log("Pool wBKC:  " + (Number(BigInt(wbkcBalPairHex)) / 1e18).toFixed(2));
  console.log("Pool mUSDT: " + (Number(BigInt(musdtBalPairHex)) / 1e6).toFixed(2));
  console.log("\n=== DONE ===");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
