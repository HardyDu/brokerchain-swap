const { expect } = require("chai");
const { ethers, artifacts, network } = require("hardhat");

const MUSDT_UNIT = 1_000_000n;
const INITIAL_WBKC = ethers.parseEther("100");
const INITIAL_MUSDT = 10_000n * MUSDT_UNIT;

describe("BrokerLiquidityRouter", function () {
  let deployer, provider;
  let factory, wbkc, musdt, pair, router;

  beforeEach(async function () {
    [deployer, provider] = await ethers.getSigners();
    wbkc = await (await ethers.getContractFactory("MockWBKC")).deploy();
    musdt = await (await ethers.getContractFactory("MockUSDT")).deploy();
    factory = await (await ethers.getContractFactory("UniswapV2Factory")).deploy(deployer.address);
    await Promise.all([wbkc.waitForDeployment(), musdt.waitForDeployment(), factory.waitForDeployment()]);
    await factory.createPair(await wbkc.getAddress(), await musdt.getAddress());
    pair = await ethers.getContractAt("IUniswapV2Pair", await factory.getPair(await wbkc.getAddress(), await musdt.getAddress()));
    await wbkc.deposit({ value: INITIAL_WBKC });
    await wbkc.transfer(await pair.getAddress(), INITIAL_WBKC);
    await musdt.transfer(await pair.getAddress(), INITIAL_MUSDT);
    await pair.mint(deployer.address);

    router = await (await ethers.getContractFactory("BrokerLiquidityRouter")).deploy(
      await factory.getAddress(), await wbkc.getAddress(), await musdt.getAddress()
    );
    await router.waitForDeployment();
    await musdt.transfer(provider.address, 2_000n * MUSDT_UNIT);
  });

  const deadline = () => Math.floor(Date.now() / 1000) + 3600;

  after(async function () {
    // The millisecond timestamp compatibility test moves the shared Hardhat clock far ahead.
    // Reset it so older router suites that intentionally use second-only deadlines stay isolated.
    await network.provider.send("hardhat_reset");
  });

  it("quotes the pool ratio and LP proof amount", async function () {
    const quote = await router.quoteAddLiquidity(1_000n * MUSDT_UNIT, ethers.parseEther("20"));
    expect(quote.amountMusdt).to.equal(1_000n * MUSDT_UNIT);
    expect(quote.amountBkc).to.equal(ethers.parseEther("10"));
    expect(quote.estimatedLiquidity).to.be.gt(0);
  });

  it("adds liquidity atomically, refunds excess BKC, and mints LP proof", async function () {
    const musdtAmount = 1_000n * MUSDT_UNIT;
    await musdt.connect(provider).approve(await router.getAddress(), musdtAmount);
    const lpBefore = await pair.balanceOf(provider.address);
    await router.connect(provider).addLiquidityBKC(
      musdtAmount, musdtAmount, ethers.parseEther("9.9"), 0, provider.address, deadline(),
      { value: ethers.parseEther("20") }
    );
    expect(await pair.balanceOf(provider.address)).to.be.gt(lpBefore);
    expect(await musdt.allowance(provider.address, await router.getAddress())).to.equal(0);
    expect(await ethers.provider.getBalance(await router.getAddress())).to.equal(0);
  });

  it("removes liquidity and returns mUSDT plus native BKC", async function () {
    const musdtAmount = 1_000n * MUSDT_UNIT;
    await musdt.connect(provider).approve(await router.getAddress(), musdtAmount);
    await router.connect(provider).addLiquidityBKC(
      musdtAmount, 0, 0, 0, provider.address, deadline(), { value: ethers.parseEther("10") }
    );
    const liquidity = await pair.balanceOf(provider.address);
    const quoted = await router.quoteRemoveLiquidity(liquidity);
    await pair.connect(provider).approve(await router.getAddress(), liquidity);
    const musdtBefore = await musdt.balanceOf(provider.address);
    const bkcBefore = await ethers.provider.getBalance(provider.address);
    const tx = await router.connect(provider).removeLiquidityBKC(
      liquidity, quoted.amountMusdt, quoted.amountBkc, provider.address, deadline()
    );
    const receipt = await tx.wait();
    const gasCost = receipt.gasUsed * receipt.gasPrice;
    expect(await musdt.balanceOf(provider.address)).to.equal(musdtBefore + quoted.amountMusdt);
    expect(await ethers.provider.getBalance(provider.address) + gasCost).to.equal(bkcBefore + quoted.amountBkc);
    expect(await pair.balanceOf(provider.address)).to.equal(0);
  });

  it("keeps swap fees in the pool for LP holders", async function () {
    const kBefore = INITIAL_WBKC * INITIAL_MUSDT;
    const amountIn = 100n * MUSDT_UNIT;
    await musdt.transfer(await pair.getAddress(), amountIn);
    const amountInWithFee = amountIn * 997n;
    const amountOut = amountInWithFee * INITIAL_WBKC / (INITIAL_MUSDT * 1000n + amountInWithFee);
    const wbkcIsToken0 = (await wbkc.getAddress()).toLowerCase() < (await musdt.getAddress()).toLowerCase();
    await pair.swap(wbkcIsToken0 ? amountOut : 0, wbkcIsToken0 ? 0 : amountOut, deployer.address, "0x");
    const reserves = await router.getReserves();
    expect(reserves.reserveMusdt * reserves.reserveWbkc).to.be.gt(kBefore);
  });

  it("supports BrokerChain millisecond timestamps and stays below runtime size limit", async function () {
    const millisecondTimestamp = Math.floor(Date.now() / 1000) * 1000;
    await network.provider.send("evm_setNextBlockTimestamp", [millisecondTimestamp]);
    await musdt.connect(provider).approve(await router.getAddress(), 100n * MUSDT_UNIT);
    await expect(router.connect(provider).addLiquidityBKC(
      100n * MUSDT_UNIT, 0, 0, 0, provider.address, Math.floor(millisecondTimestamp / 1000) + 60,
      { value: ethers.parseEther("1") }
    )).to.not.be.reverted;
    const artifact = await artifacts.readArtifact("BrokerLiquidityRouter");
    expect((artifact.deployedBytecode.length - 2) / 2).to.be.lessThan(24_576);
  });
});
