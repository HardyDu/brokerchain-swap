const { expect } = require("chai");
const { ethers, artifacts, network } = require("hardhat");

const WAD = ethers.parseEther("1");
const MUSDT_UNIT = 1_000_000n;
const INITIAL_WBKC = ethers.parseEther("100");
const INITIAL_MUSDT = 10_000n * MUSDT_UNIT;

describe("BrokerSwapRouterMiniV2", function () {
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

    const MiniV2 = await ethers.getContractFactory("BrokerSwapRouterMiniV2");
    router = await MiniV2.deploy(
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

  it("quotes the fixed WBKC/mUSDT pair", async function () {
    const path = [await musdt.getAddress(), await wbkc.getAddress()];
    const amounts = await router.getAmountsOut(MUSDT_UNIT, path);

    expect(amounts).to.have.length(2);
    expect(amounts[0]).to.equal(MUSDT_UNIT);
    expect(amounts[1]).to.be.gt(0);
  });

  it("swaps mUSDT for WBKC through the BrokerChain-compatible call path", async function () {
    const amountIn = 50n * MUSDT_UNIT;
    const path = [await musdt.getAddress(), await wbkc.getAddress()];
    const quoted = await router.getAmountsOut(amountIn, path);
    await musdt.connect(user).approve(await router.getAddress(), amountIn);
    const balanceBefore = await wbkc.balanceOf(user.address);

    await router.connect(user).swapExactTokensForTokens(
      amountIn, quoted[1], path, user.address, deadline()
    );

    expect(await wbkc.balanceOf(user.address)).to.equal(balanceBefore + quoted[1]);
    expect(await musdt.allowance(user.address, await router.getAddress())).to.equal(0);
  });

  it("swaps mUSDT for native BKC through the BrokerChain-compatible call path", async function () {
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

  it("executes all BrokerChain-compatible quoted swap paths below the gas ceiling", async function () {
    const routerAddress = await router.getAddress();
    const musdtAddress = await musdt.getAddress();
    const wbkcAddress = await wbkc.getAddress();
    const tokenPath = [musdtAddress, wbkcAddress];
    const nativePath = [wbkcAddress, musdtAddress];
    const tokenAmount = 10n * MUSDT_UNIT;
    const gasUsed = [];

    await musdt.connect(user).approve(routerAddress, tokenAmount);
    let quoted = await router.getAmountsOut(tokenAmount, tokenPath);
    let tx = await router.connect(user).swapExactMusdtForWbkc(
      tokenAmount, quoted[1], quoted[1], user.address, deadline()
    );
    gasUsed.push((await tx.wait()).gasUsed);

    await musdt.connect(user).approve(routerAddress, tokenAmount);
    quoted = await router.getAmountsOut(tokenAmount, tokenPath);
    tx = await router.connect(user).swapExactMusdtForBkc(
      tokenAmount, quoted[1], quoted[1], user.address, deadline()
    );
    gasUsed.push((await tx.wait()).gasUsed);

    const nativeAmount = ethers.parseEther("0.01");
    quoted = await router.getAmountsOut(nativeAmount, nativePath);
    tx = await router.connect(user).swapExactBkcForMusdt(
      quoted[1], quoted[1], user.address, deadline(), { value: nativeAmount }
    );
    gasUsed.push((await tx.wait()).gasUsed);

    if (process.env.REPORT_MINI_V2_GAS === "1") {
      console.log("quoted swap gas:", gasUsed.map(String));
    }
    for (const used of gasUsed) {
      expect(used).to.be.lessThan(160_000n);
    }
  });

  it("enforces slippage, path restrictions, and the runtime size limit", async function () {
    const musdtAddress = await musdt.getAddress();
    const wbkcAddress = await wbkc.getAddress();
    const amountIn = MUSDT_UNIT;
    const path = [musdtAddress, wbkcAddress];
    const quoted = await router.getAmountsOut(amountIn, path);
    await musdt.connect(user).approve(await router.getAddress(), amountIn);

    await expect(
      router.connect(user).swapExactTokensForTokens(
        amountIn, quoted[1] + 1n, path, user.address, deadline()
      )
    ).to.be.revertedWith("BrokerSwapRouterMiniV2: INSUFFICIENT_OUTPUT_AMOUNT");

    await expect(
      router.getAmountsOut(WAD, [wbkcAddress, wbkcAddress])
    ).to.be.revertedWith("BrokerSwapRouterMiniV2: INVALID_PATH");

    const artifact = await artifacts.readArtifact("BrokerSwapRouterMiniV2");
    const deployedBytecodeBytes = (artifact.deployedBytecode.length - 2) / 2;
    expect(deployedBytecodeBytes).to.be.lessThan(24_576);
  });

  it("accepts Unix-second deadlines when BrokerChain supplies millisecond timestamps", async function () {
    const millisecondTimestamp = Math.floor(Date.now() / 1000) * 1000;
    await network.provider.send("evm_setNextBlockTimestamp", [millisecondTimestamp]);

    const amountIn = MUSDT_UNIT;
    const path = [await musdt.getAddress(), await wbkc.getAddress()];
    const quoted = await router.getAmountsOut(amountIn, path);
    await musdt.connect(user).approve(await router.getAddress(), amountIn);
    const deadlineSeconds = Math.floor(millisecondTimestamp / 1000) + 3600;

    await expect(
      router.connect(user).swapExactTokensForTokens(
        amountIn, quoted[1], path, user.address, deadlineSeconds
      )
    ).to.not.be.reverted;

    await expect(
      router.connect(user).swapExactTokensForTokens(
        amountIn, 0, path, user.address, Math.floor(millisecondTimestamp / 1000) - 1
      )
    ).to.be.revertedWith("BrokerSwapRouterMiniV2: EXPIRED");
  });
});
