"use strict";

// Give a user 1000 wBKC + 100000 mUSDT for swap / liquidity testing.
//
// The deployer only has ~100 native BKC left (most is locked in the Pair),
// so wBKC is sourced by burning part of the deployer's LP position and
// transferring the withdrawn wBKC to the user. mUSDT is minted directly
// (deployer is MockUSDT owner). Excess mUSDT withdrawn from the Pair stays
// with the deployer.
//
// Usage: node scripts/transfer-1000-to-user.js 0xUSER_ADDRESS

const { Wallet, Interface } = require("ethers");
const http = require("http");

const RPC = "http://127.0.0.1:42515";
const PK = "c2247f8c3ba809c09e004b28d3726ee2a6f865028769ab5f02dbd13a732c4de2";
const wallet = new Wallet(PK);
const DEPLOYER = "0x3a13aeF844a9FE0cbfDfE94B220c9eb69F10E625";

const WBKC = "0x2623d7d7dd39e8361241c9c64c9023d57d00d8a2";
const MUSDT = "0x128306db0c1ff36e3093c08da855329543d69d2d";
const PAIR = "0xe1b2b75a08143abb64d7206ee52b3b3535c64af3";

const WBKC_TARGET = 1000n * 10n ** 18n;   // 1000 wBKC
const MUSDT_TARGET = 100000n * 10n ** 6n; // 100000 mUSDT

const erc20Iface = new Interface([
  "function transfer(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const musdtIface = new Interface([
  "function mint(address,uint256)",
  "function balanceOf(address) view returns (uint256)",
]);
const pairIface = new Interface([
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function burn(address) returns (uint256,uint256)",
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

async function call(to, data) {
  const r = await rpc("eth_call", [{ to, from: DEPLOYER, data }, "latest"]);
  if (r.error) throw new Error(JSON.stringify(r.error));
  return r.result;
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
  if (!r.result) throw new Error(label + ": no hash; " + JSON.stringify(r.error || r));
  console.log("  " + label + " nonce=" + nonce + " hash=" + r.result);
  return r.result;
}

async function waitReceipt(hash, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 240000);
  while (Date.now() < deadline) {
    const r = await rpc("eth_getTransactionReceipt", [hash]);
    if (r.result && r.result !== "0x") {
      if (r.result.status === "0x0") throw new Error("tx reverted: " + hash);
      return r.result;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Timeout waiting for " + hash);
}

async function main() {
  const userAddr = (process.argv[2] || "").toLowerCase().trim();
  if (!/^0x[0-9a-f]{40}$/.test(userAddr)) {
    console.log("Usage: node scripts/transfer-1000-to-user.js 0xUSER_ADDRESS");
    process.exit(1);
  }

  console.log("=== Fund User: 1000 wBKC + 100000 mUSDT ===");
  console.log("User: " + userAddr);

  // 0. Top up a little native BKC so the user can pay gas for swap/transfer.
  const NATIVE_GAS = 5n * 10n ** 18n;
  console.log("\n0. Transfer 5 native BKC to user for gas");
  const h0 = await sendTx(userAddr, "0x", "0x" + NATIVE_GAS.toString(16), "native BKC gas");
  await waitReceipt(h0);

  // 1. Mint mUSDT directly to the user (deployer is MockUSDT owner)
  console.log("\n1. Mint 100000 mUSDT to user");
  const h1 = await sendTx(MUSDT, musdtIface.encodeFunctionData("mint", [userAddr, MUSDT_TARGET]), "0x0", "mint mUSDT");
  await waitReceipt(h1);

  // 2. Read pool state to size the LP burn for 1000 wBKC
  const reserves = await call(PAIR, pairIface.encodeFunctionData("getReserves"));
  const [r0, r1] = pairIface.decodeFunctionResult("getReserves", reserves);
  const totalSupply = BigInt(await call(PAIR, pairIface.encodeFunctionData("totalSupply")));
  const deployerLp = BigInt(await call(PAIR, pairIface.encodeFunctionData("balanceOf", [DEPLOYER])));
  // token0 = mUSDT (reserve0), token1 = wBKC (reserve1)
  const reserveWbkc = BigInt(r1.toString());
  // round up so the withdrawn wBKC is >= target
  const burnLp = (WBKC_TARGET * totalSupply) / reserveWbkc + 1n;
  if (burnLp > deployerLp) throw new Error("deployer LP too small: need " + burnLp + " have " + deployerLp);
  console.log("\n2. Burn " + burnLp + " LP (of " + deployerLp + ") to withdraw ~1000 wBKC");

  // 3. Move LP to the Pair, then burn to deployer
  const h3 = await sendTx(PAIR, pairIface.encodeFunctionData("transfer", [PAIR, burnLp]), "0x0", "LP -> Pair");
  await waitReceipt(h3);
  const h4 = await sendTx(PAIR, pairIface.encodeFunctionData("burn", [DEPLOYER]), "0x0", "burn LP");
  await waitReceipt(h4);

  // 4. Transfer exactly 1000 wBKC to the user
  const deployerWbkc = BigInt(await call(WBKC, erc20Iface.encodeFunctionData("balanceOf", [DEPLOYER])));
  console.log("\n3. Deployer wBKC after burn: " + (Number(deployerWbkc) / 1e18).toFixed(4));
  if (deployerWbkc < WBKC_TARGET) throw new Error("insufficient wBKC after burn");
  const h5 = await sendTx(WBKC, erc20Iface.encodeFunctionData("transfer", [userAddr, WBKC_TARGET]), "0x0", "transfer 1000 wBKC");
  await waitReceipt(h5);

  // 5. Verify
  console.log("\n=== Verification ===");
  const uWbkc = BigInt(await call(WBKC, erc20Iface.encodeFunctionData("balanceOf", [userAddr])));
  const uMusdt = BigInt(await call(MUSDT, musdtIface.encodeFunctionData("balanceOf", [userAddr])));
  console.log("User wBKC:  " + (Number(uWbkc) / 1e18).toFixed(4));
  console.log("User mUSDT: " + (Number(uMusdt) / 1e6).toFixed(4));

  const reserves2 = await call(PAIR, pairIface.encodeFunctionData("getReserves"));
  const [nr0, nr1] = pairIface.decodeFunctionResult("getReserves", reserves2);
  console.log("Pool mUSDT: " + (Number(nr0) / 1e6).toFixed(4));
  console.log("Pool wBKC:  " + (Number(nr1) / 1e18).toFixed(4));
  console.log("\n=== DONE ===");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
