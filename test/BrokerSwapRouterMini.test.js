const { expect } = require("chai");
const { ethers, artifacts } = require("hardhat");

const WAD = ethers.parseEther("1");
const MUSDT_UNIT = 1_000_000n;
const INITIAL_WBKC = ethers.parseEther("1000");
const INITIAL_MUSDT = 100_000n * MUSDT_UNIT;

describe("BrokerSwapRouterMini", function () {
  let deployer, user;
  let factory, wbkc, musdt, pair, router;

  beforeEach(async function () {
    [deployer, user] = await ethers.getSigners();

    const MockWBKC = await ethers.getContractFactory("MockWBKC");
    wbkc = await MockWBKC.deploy();
    await wbkc.waitForDeployment();

    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    musdt = await MockUSDT.deploy();
    await musdt.waitForDeployment();

    const Factory = await ethers.getContractFactory("UniswapV2Factory");
    factory = await Factory.deploy(deployer.address);
    await factory.waitForDeployment();
    await factory.createPair(await wbkc.getAddress(), await musdt.getAddress());
    pair = await ethers.getContractAt(
      "IUniswapV2Pair",
      await factory.getPair(await wbkc.getAddress(), await musdt.getAddress())
    );

    await wbkc.deposit({ value: INITIAL_WBKC });
    await wbkc.transfer(await pair.getAddress(), INITIAL_WBKC);
    await musdt.transfer(await pair.getAddress(), INITIAL_MUSDT);
    await pair.mint(deployer.address);

    const Mini = await ethers.getContractFactory("BrokerSwapRouterMini");
    router = await Mini.deploy(
      await factory.getAddress(),
      await wbkc.getAddress(),
      await musdt.getAddress()
    );
    await router.waitForDeployment();

    await musdt.transfer(user.address, 1_000n * MUSDT_UNIT);
    await wbkc.deposit({ value: ethers.parseEther("10") });
    await wbkc.transfer(user.address, ethers.parseEther("5"));
  });

  function deadline() {
    return Math.floor(Date.now() / 1000) + 3600;
  }

  it("uses the wallet-compatible getAmountsOut ABI and fixed pair", async function () {
    const path = [await wbkc.getAddress(), await musdt.getAddress()];
    const amounts = await router.getAmountsOut(WAD, path);

    expect(amounts).to.have.length(2);
    expect(amounts[0]).to.equal(WAD);
    expect(amounts[1]).to.be.gt(0);
  });

  it("swaps native BKC for mUSDT", async function () {
    const amountIn = ethers.parseEther("0.1");
    const path = [await wbkc.getAddress(), await musdt.getAddress()];
    const quoted = await router.getAmountsOut(amountIn, path);
    const balanceBefore = await musdt.balanceOf(user.address);

    await router.connect(user).swapExactBKCForTokens(
      quoted[1], path, user.address, deadline(), { value: amountIn }
    );

    expect(await musdt.balanceOf(user.address)).to.equal(balanceBefore + quoted[1]);
  });

  it("swaps mUSDT for native BKC", async function () {
    const amountIn = 100n * MUSDT_UNIT;
    const path = [await musdt.getAddress(), await wbkc.getAddress()];
    const quoted = await router.getAmountsOut(amountIn, path);
    await musdt.connect(user).approve(await router.getAddress(), amountIn);

    const balanceBefore = await ethers.provider.getBalance(user.address);
    const tx = await router.connect(user).swapExactTokensForBKC(
      amountIn, quoted[1], path, user.address, deadline()
    );
    const receipt = await tx.wait();
    const gasCost = receipt.gasUsed * receipt.gasPrice;
    const balanceAfter = await ethers.provider.getBalance(user.address);

    expect(balanceAfter + gasCost).to.equal(balanceBefore + quoted[1]);
  });

  it("swaps the two ERC-20 forms without unwrapping", async function () {
    const amountIn = 50n * MUSDT_UNIT;
    const path = [await musdt.getAddress(), await wbkc.getAddress()];
    const quoted = await router.getAmountsOut(amountIn, path);
    await musdt.connect(user).approve(await router.getAddress(), amountIn);
    const balanceBefore = await wbkc.balanceOf(user.address);

    await router.connect(user).swapExactTokensForTokens(
      amountIn, quoted[1], path, user.address, deadline()
    );

    expect(await wbkc.balanceOf(user.address)).to.equal(balanceBefore + quoted[1]);
  });

  it("rejects arbitrary routes and reports a deployable runtime size", async function () {
    await expect(
      router.getAmountsOut(WAD, [await wbkc.getAddress()])
    ).to.be.revertedWith("BrokerSwapRouterMini: INVALID_PATH");

    await expect(
      router.getAmountsOut(WAD, [await wbkc.getAddress(), await wbkc.getAddress()])
    ).to.be.revertedWith("BrokerSwapRouterMini: INVALID_PATH");

    const artifact = await artifacts.readArtifact("BrokerSwapRouterMini");
    const deployedBytecodeBytes = (artifact.deployedBytecode.length - 2) / 2;
    expect(deployedBytecodeBytes).to.be.lessThan(24_576);
  });
});
