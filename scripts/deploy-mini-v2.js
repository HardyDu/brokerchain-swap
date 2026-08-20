const { ContractFactory } = require("ethers");

const artifact = require("../artifacts/contracts/broker-swap-periphery/BrokerSwapRouterMiniV2.sol/BrokerSwapRouterMiniV2.json");

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:49282";
const DEPLOYER = process.env.DEPLOYER || "0xc9791f2f86a7f11af0c257480765024f002e77b7";
const FACTORY = "0xB1185C2A9077cE35572CffABf825DD2DB299A662";
const WBKC = "0x4761865CA85000B23DF6fB00D2c4F81aa873513B";
const MUSDT = "0x2881B7eFad41d88F3C244fBB3503dF3E12Bc0B26";
const GAS_LIMIT = process.env.GAS_LIMIT || "0x2dc6c0";

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
  throw new Error(`Timed out waiting for deployment receipt: ${transactionHash}`);
}

async function main() {
  const send = process.argv.includes("--send");
  const factory = new ContractFactory(artifact.abi, artifact.bytecode);
  const deployment = await factory.getDeployTransaction(FACTORY, WBKC, MUSDT);

  console.log(JSON.stringify({
    send,
    rpc: RPC_URL,
    deployer: DEPLOYER,
    constructor: { factory: FACTORY, wbkc: WBKC, musdt: MUSDT },
    creationBytes: (deployment.data.length - 2) / 2,
    gasLimit: GAS_LIMIT,
  }, null, 2));

  if (!send) return;

  const transactionHash = await rpc("eth_sendTransaction", [{
    from: DEPLOYER,
    data: deployment.data,
    value: "0x0",
    gas: GAS_LIMIT,
  }]);
  if (!transactionHash) {
    throw new Error("BrokerChain returned no deployment transaction hash.");
  }

  const receipt = await waitForReceipt(transactionHash);
  if (receipt.status !== "0x1" || !receipt.contractAddress) {
    throw new Error(`Deployment failed: ${JSON.stringify(receipt)}`);
  }

  const code = await rpc("eth_getCode", [receipt.contractAddress, "latest"]);
  console.log(JSON.stringify({
    transactionHash,
    contractAddress: receipt.contractAddress,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
    runtimeBytes: (code.length - 2) / 2,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
