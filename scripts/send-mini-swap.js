const { Interface, JsonRpcProvider, Wallet } = require("ethers");

const RPC_URL = process.env.RPC_URL || "http://dash.broker-chain.com:42515";
const ROUTER = process.env.MINI_ROUTER || "0x74DCF30F02B8321E0D9c3fD76Cf3253aD0Da1B70";
const MUSDT = "0x2881B7eFad41d88F3C244fBB3503dF3E12Bc0B26";
const WBKC = "0x4761865CA85000B23DF6fB00D2c4F81aa873513B";
const MODE = process.env.MODE || "token-to-token";
const AMOUNT_IN = BigInt(process.env.AMOUNT_IN || "10000000");
const AMOUNT_OUT_MIN = BigInt(process.env.AMOUNT_OUT_MIN || "0");
const DEADLINE = BigInt(process.env.DEADLINE || Math.floor(Date.now() / 1000) + 600);
const GAS_LIMIT = BigInt(process.env.GAS_LIMIT || "300000");
const GAS_PRICE_WEI = BigInt(process.env.GAS_PRICE_WEI || "100000000000");
const CHAIN_ID = 1051;

const routerInterface = new Interface([
  "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])",
  "function swapExactTokensForBKC(uint256,uint256,address[],address,uint256) returns (uint256[])",
]);

async function main() {
  const send = process.argv.includes("--send");
  const privateKey = process.env.PRIVATE_KEY;
  const sender = process.env.SENDER_ADDRESS;

  if (!send && !sender && !privateKey) {
    throw new Error("Set SENDER_ADDRESS for a dry run, or PRIVATE_KEY together with --send.");
  }
  if (send && !privateKey) {
    throw new Error("--send requires PRIVATE_KEY in the current shell environment.");
  }

  // BrokerChain's public RPC rejects ethers' default batch network probe.
  const provider = new JsonRpcProvider(
    RPC_URL,
    { chainId: 1051, name: "brokerchain" },
    { staticNetwork: true, batchMaxCount: 1 }
  );
  const wallet = privateKey ? new Wallet(privateKey, provider) : null;
  const from = wallet ? wallet.address : sender;
  const recipient = process.env.RECIPIENT || from;
  const functionName = MODE === "token-to-native"
    ? "swapExactTokensForBKC"
    : "swapExactTokensForTokens";

  if (MODE !== "token-to-token" && MODE !== "token-to-native") {
    throw new Error("MODE must be token-to-token or token-to-native.");
  }

  const data = routerInterface.encodeFunctionData(functionName, [
    AMOUNT_IN,
    AMOUNT_OUT_MIN,
    [MUSDT, WBKC],
    recipient,
    DEADLINE,
  ]);
  console.log(JSON.stringify({
    mode: MODE,
    send,
    from,
    recipient,
    router: ROUTER,
    amountIn: AMOUNT_IN.toString(),
    amountOutMin: AMOUNT_OUT_MIN.toString(),
    deadline: DEADLINE.toString(),
    gasLimit: GAS_LIMIT.toString(),
    gasPriceWei: GAS_PRICE_WEI.toString(),
    calldata: data,
  }, null, 2));

  if (!send) return;

  const nonce = await provider.getTransactionCount(wallet.address, "latest");
  const signedTransaction = await wallet.signTransaction({
    to: ROUTER,
    data,
    value: 0n,
    nonce,
    chainId: CHAIN_ID,
    type: 2,
    gasLimit: GAS_LIMIT,
    maxFeePerGas: GAS_PRICE_WEI,
    maxPriorityFeePerGas: GAS_PRICE_WEI,
  });

  // BrokerChain returns its internal transaction id, not keccak256(rawTx).
  // Using provider.send avoids ethers' standard-Ethereum hash equality check.
  const transactionId = await provider.send("eth_sendRawTransaction", [signedTransaction]);
  if (transactionId == null) {
    throw new Error(
      "BrokerChain RPC returned no transaction id. Submission status is unknown; do not resend before checking balances."
    );
  }
  console.log(`Submitted BrokerChain transaction id: ${transactionId}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
