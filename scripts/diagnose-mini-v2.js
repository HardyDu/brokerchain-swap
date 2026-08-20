const { AbiCoder, ContractFactory, Interface } = require("ethers");

const artifact = require("../artifacts/contracts/diagnostics/TransferFromProbe.sol/TransferFromProbe.json");

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:49282";
const ACCOUNT = process.env.DEPLOYER || "0xc9791f2f86a7f11af0c257480765024f002e77b7";
const ROUTER = process.env.MINI_ROUTER_V2 || "0x463ea41fdd04bbd0f821291ab825c472ea6a2ffe";
const MUSDT = "0x2881B7eFad41d88F3C244fBB3503dF3E12Bc0B26";
const PAIR = "0x40283F8EccEC16386081B1e4A1E83C5C8939adcb";
const AMOUNT_IN = 1_000_000n;

const erc20 = new Interface(["function transfer(address,uint256) returns (bool)"]);
const pair = new Interface(["function sync()", "event Sync(uint112 reserve0,uint112 reserve1)"]);
const router = new Interface([
  "function swapExactMusdtForWbkc(uint256,uint256,uint256,address,uint256) returns (uint256)",
]);
const probe = new Interface(artifact.abi);
const abiCoder = AbiCoder.defaultAbiCoder();
let rpcId = 0;

async function rpc(method, params) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(`${method} failed: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

async function receiptFor(transactionHash) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const receipt = await rpc("eth_getTransactionReceipt", [transactionHash]);
    if (receipt && receipt !== "0x") return receipt;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for ${transactionHash}`);
}

async function send(label, transaction) {
  const transactionHash = await rpc("eth_sendTransaction", [{
    from: ACCOUNT,
    value: "0x0",
    gas: "3000000",
    ...transaction,
  }]);
  if (!transactionHash) throw new Error(`${label} returned no transaction hash`);
  const receipt = await receiptFor(transactionHash);
  console.log(JSON.stringify({ step: label, transactionHash, status: receipt.status, gasUsed: receipt.gasUsed }));
  if (receipt.status !== "0x1") throw new Error(`${label} reverted: ${transactionHash}`);
  return receipt;
}

function eventFrom(receipt, address, iface, name) {
  for (const log of receipt.logs || []) {
    if (log.address.toLowerCase() !== address.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog(log);
      if (parsed.name === name) return parsed;
    } catch {}
  }
  return null;
}

function decodeRevert(data) {
  if (!data || data === "0x") return "empty revert data";
  try {
    if (data.startsWith("0x08c379a0")) {
      return `Error(${JSON.stringify(abiCoder.decode(["string"], `0x${data.slice(10)}`)[0])})`;
    }
    if (data.startsWith("0x4e487b71")) {
      return `Panic(${abiCoder.decode(["uint256"], `0x${data.slice(10)}`)[0]})`;
    }
  } catch {}
  return data;
}

function getAmountOut(amountIn, reserveIn, reserveOut) {
  const amountInWithFee = amountIn * 997n;
  return amountInWithFee * reserveOut / (reserveIn * 1000n + amountInWithFee);
}

async function main() {
  if (!process.argv.includes("--send")) {
    console.log(JSON.stringify({ send: false, rpc: RPC_URL, account: ACCOUNT, router: ROUTER }, null, 2));
    return;
  }

  const deployment = await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction();
  const deploymentReceipt = await send("deploy TransferFromProbe", { data: deployment.data });
  const probeAddress = deploymentReceipt.contractAddress;
  if (!probeAddress) throw new Error("Probe deployment returned no contract address");

  const timestampReceipt = await send("read EVM timestamp", {
    to: probeAddress,
    data: probe.encodeFunctionData("emitTimestamp"),
  });
  const timestamp = eventFrom(timestampReceipt, probeAddress, probe, "Timestamp");
  if (!timestamp) throw new Error("Probe Timestamp event not found");
  console.log(JSON.stringify({ evmTimestamp: timestamp.args.value.toString() }));

  const syncReceipt = await send("sync Pair", { to: PAIR, data: pair.encodeFunctionData("sync") });
  const sync = eventFrom(syncReceipt, PAIR, pair, "Sync");
  if (!sync) throw new Error("Pair Sync event not found");
  // mUSDT is token0 and WBKC is token1 for the deployed Pair.
  const reserveMusdt = BigInt(sync.args[0]);
  const reserveWbkc = BigInt(sync.args[1]);
  const amountOut = getAmountOut(AMOUNT_IN, reserveMusdt, reserveWbkc);

  await send("fund probe with 1 mUSDT", {
    to: MUSDT,
    data: erc20.encodeFunctionData("transfer", [probeAddress, AMOUNT_IN]),
  });
  await send("probe approves Router", {
    to: probeAddress,
    data: probe.encodeFunctionData("approveToken", [MUSDT, ROUTER, AMOUNT_IN]),
  });

  const routerData = router.encodeFunctionData("swapExactMusdtForWbkc", [
    AMOUNT_IN,
    amountOut,
    amountOut,
    ACCOUNT,
    BigInt(Math.floor(Date.now() / 1000) + 3600),
  ]);
  const callReceipt = await send("probe calls Router", {
    to: probeAddress,
    data: probe.encodeFunctionData("callProbe", [ROUTER, routerData]),
  });
  const result = eventFrom(callReceipt, probeAddress, probe, "CallResult");
  if (!result) throw new Error("Probe CallResult event not found");

  const callSuccess = result.args.callSuccess;
  const returnData = result.args.returnData;
  console.log(JSON.stringify({
    probe: probeAddress,
    router: ROUTER,
    reserves: { musdt: reserveMusdt.toString(), wbkc: reserveWbkc.toString() },
    amountIn: AMOUNT_IN.toString(),
    amountOut: amountOut.toString(),
    callSuccess,
    returnData,
    decodedReturn: callSuccess ? abiCoder.decode(["uint256"], returnData)[0].toString() : decodeRevert(returnData),
  }, null, 2));

  if (!callSuccess) {
    await send("recover probe mUSDT", {
      to: probeAddress,
      data: probe.encodeFunctionData("recoverToken", [MUSDT, ACCOUNT, AMOUNT_IN]),
    });
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
