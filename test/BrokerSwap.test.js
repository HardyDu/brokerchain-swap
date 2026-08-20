// SPDX-License-Identifier: GPL-3.0-or-later
// BrokerSwap end-to-end contract tests for Hardhat.
// Uses ethers v6 (from @nomicfoundation/hardhat-toolbox).

const { expect } = require("chai");
const { ethers } = require("hardhat");

// Helper constants
const WAD = ethers.parseEther("1");       // 1e18
const USDT_UNIT = 1_000_000n;              // 1 mUSDT (6 decimals)
const INITIAL_WBKC = ethers.parseEther("1000");     // 1000 wBKC
const INITIAL_MUSDT = 100_000n * USDT_UNIT;          // 100,000 mUSDT

describe("BrokerSwap (Factory → Pair → Router)", function () {
  let factory, router, mockUsdt, wbkc;
  let deployer, userA, userB;
  let pairAddress;

  before(async function () {
    [deployer, userA, userB] = await ethers.getSigners();

    // Deploy MockUSDT (used as both wBKC stand-in AND mUSDT — both are ERC20s)
    const MockERC20 = await ethers.getContractFactory("MockUSDT");
    wbkc = await MockERC20.deploy();
    await wbkc.waitForDeployment();

    mockUsdt = await MockERC20.deploy();
    await mockUsdt.waitForDeployment();

    // Deploy Factory
    const Factory = await ethers.getContractFactory("UniswapV2Factory");
    factory = await Factory.deploy(deployer.address);
    await factory.waitForDeployment();

    // Deploy Router (mapping WBKC→MockERC20 — Router uses IWBKC which needs deposit/withdraw)
    // MockUSDT doesn't have deposit/withdraw, so we use token↔token paths only for now
    const Router = await ethers.getContractFactory("BrokerSwapRouter");
    router = await Router.deploy(
      await factory.getAddress(),
      await wbkc.getAddress()
    );
    await router.waitForDeployment();

    // Add initial liquidity via token↔token (both are MockUSDT-based, so approve works)
    await mockUsdt.mint(deployer.address, INITIAL_MUSDT);
    await wbkc.mint(deployer.address, INITIAL_WBKC);

    await mockUsdt.connect(deployer).approve(await router.getAddress(), INITIAL_MUSDT);
    await wbkc.connect(deployer).approve(await router.getAddress(), INITIAL_WBKC);

    await router.connect(deployer).addLiquidity(
      await wbkc.getAddress(),
      await mockUsdt.getAddress(),
      INITIAL_WBKC,
      INITIAL_MUSDT,
      0,
      0,
      deployer.address,
      Math.floor(Date.now() / 1000) + 3600,
      { gasLimit: 5_000_000 }
    );

    pairAddress = await factory.getPair(await wbkc.getAddress(), await mockUsdt.getAddress());

    // Give userA some tokens
    await wbkc.mint(userA.address, ethers.parseEther("10"));
    await mockUsdt.mint(userA.address, 1000n * USDT_UNIT);
  });

  // =========================================================================
  // 1. Factory creates Pair
  // =========================================================================
  it("Factory creates a Pair for wBKC/mUSDT", async function () {
    const pairAddr = await factory.getPair(
      await wbkc.getAddress(),
      await mockUsdt.getAddress()
    );
    expect(pairAddr).to.not.equal(ethers.ZeroAddress);
  });

  it("getPair returns same address regardless of token order", async function () {
    const a = await factory.getPair(await wbkc.getAddress(), await mockUsdt.getAddress());
    const b = await factory.getPair(await mockUsdt.getAddress(), await wbkc.getAddress());
    expect(a).to.equal(b);
  });

  // =========================================================================
  // 2. Reserves and constant product invariant
  // =========================================================================
  it("Pair has correct initial reserves", async function () {
    const pair = await ethers.getContractAt("IUniswapV2Pair", pairAddress);
    const [r0, r1] = await pair.getReserves();
    expect(r0).to.be.gt(0);
    expect(r1).to.be.gt(0);
  });

  it("Constant product invariant holds after swap", async function () {
    const pair = await ethers.getContractAt("IUniswapV2Pair", pairAddress);
    const [r0Before, r1Before] = await pair.getReserves();

    const amountIn = ethers.parseEther("0.01");
    await wbkc.connect(userA).approve(await router.getAddress(), amountIn);

    await router.connect(userA).swapExactTokensForTokens(
      amountIn,
      0,
      [await wbkc.getAddress(), await mockUsdt.getAddress()],
      userA.address,
      Math.floor(Date.now() / 1000) + 3600,
      { gasLimit: 500_000 }
    );

    const [r0After, r1After] = await pair.getReserves();
    expect(r0After * r1After).to.be.gte(r0Before * r1Before);
  });

  // =========================================================================
  // 3. wBKC → mUSDT (token↔token)
  // =========================================================================
  it("swapExactTokensForTokens (wBKC → mUSDT) succeeds", async function () {
    const amountIn = ethers.parseEther("0.05");
    const path = [await wbkc.getAddress(), await mockUsdt.getAddress()];
    const amounts = await router.getAmountsOut(amountIn, path);
    const minOut = amounts[1] * 95n / 100n;

    await wbkc.connect(userA).approve(await router.getAddress(), amountIn);

    const balBefore = await mockUsdt.balanceOf(userA.address);
    await router.connect(userA).swapExactTokensForTokens(
      amountIn,
      minOut,
      path,
      userA.address,
      Math.floor(Date.now() / 1000) + 3600,
      { gasLimit: 500_000 }
    );
    const balAfter = await mockUsdt.balanceOf(userA.address);
    expect(balAfter).to.be.gt(balBefore);
  });

  // =========================================================================
  // 4. mUSDT → wBKC (token↔token)
  // =========================================================================
  it("swapExactTokensForTokens (mUSDT → wBKC) succeeds", async function () {
    const amountIn = 5n * USDT_UNIT;
    const path = [await mockUsdt.getAddress(), await wbkc.getAddress()];
    const amounts = await router.getAmountsOut(amountIn, path);
    const minOut = amounts[1] * 95n / 100n;

    await mockUsdt.connect(userA).approve(await router.getAddress(), amountIn);

    const balBefore = await wbkc.balanceOf(userA.address);
    await router.connect(userA).swapExactTokensForTokens(
      amountIn,
      minOut,
      path,
      userA.address,
      Math.floor(Date.now() / 1000) + 3600,
      { gasLimit: 500_000 }
    );
    const balAfter = await wbkc.balanceOf(userA.address);
    expect(balAfter).to.be.gt(balBefore);
  });

  // =========================================================================
  // 5. Insufficient allowance → revert
  // =========================================================================
  it("swapExactTokensForTokens reverts when allowance is insufficient", async function () {
    const amountIn = ethers.parseEther("999999");
    const path = [await wbkc.getAddress(), await mockUsdt.getAddress()];

    await expect(
      router.connect(userA).swapExactTokensForTokens(
        amountIn,
        0,
        path,
        userA.address,
        Math.floor(Date.now() / 1000) + 3600,
        { gasLimit: 500_000 }
      )
    ).to.be.reverted;
  });

  // =========================================================================
  // 6. amountOutMin not met → revert
  // =========================================================================
  it("swapExactTokensForTokens reverts when amountOutMin is too high", async function () {
    const amountIn = ethers.parseEther("0.01");
    const path = [await wbkc.getAddress(), await mockUsdt.getAddress()];
    await wbkc.connect(userA).approve(await router.getAddress(), amountIn);

    await expect(
      router.connect(userA).swapExactTokensForTokens(
        amountIn,
        INITIAL_MUSDT * 10n, // impossibly high
        path,
        userA.address,
        Math.floor(Date.now() / 1000) + 3600,
        { gasLimit: 500_000 }
      )
    ).to.be.revertedWith("BrokerSwapRouter: INSUFFICIENT_OUTPUT_AMOUNT");
  });

  // =========================================================================
  // 7. Deadline expired → revert
  // =========================================================================
  it("swapExactTokensForTokens reverts with expired deadline", async function () {
    const amountIn = ethers.parseEther("0.01");
    const path = [await wbkc.getAddress(), await mockUsdt.getAddress()];

    await expect(
      router.connect(userA).swapExactTokensForTokens(
        amountIn,
        0,
        path,
        userA.address,
        1,
        { gasLimit: 500_000 }
      )
    ).to.be.revertedWith("BrokerSwapRouter: EXPIRED");
  });

  // =========================================================================
  // 8. Router receive rejects non-WBKC native transfers
  // =========================================================================
  it("Router receive reverts when sender is not WBKC", async function () {
    await expect(
      deployer.sendTransaction({
        to: await router.getAddress(),
        value: ethers.parseEther("1"),
      })
    ).to.be.reverted; // assert(msg.sender == WBKC)
  });

  // =========================================================================
  // 9. Quote functions work
  // =========================================================================
  it("quote / getAmountOut / getAmountIn return sensible values", async function () {
    const path = [await wbkc.getAddress(), await mockUsdt.getAddress()];
    const amounts = await router.getAmountsOut(ethers.parseEther("1"), path);
    expect(amounts.length).to.equal(2);
    expect(amounts[1]).to.be.gt(0);

    const amountsIn = await router.getAmountsIn(amounts[1], path);
    const diff = amountsIn[0] > amounts[0]
      ? amountsIn[0] - amounts[0]
      : amounts[0] - amountsIn[0];
    const tolerance = amounts[0] / 1000n;
    expect(diff).to.be.lte(tolerance <= 0n ? 1n : tolerance);
  });

  // =========================================================================
  // 10. addLiquidity (token↔token) creates a pool correctly
  // =========================================================================
  it("addLiquidity creates a new pair and mints LP tokens", async function () {
    const MockERC20 = await ethers.getContractFactory("MockUSDT");
    const newToken = await MockERC20.deploy();
    await newToken.waitForDeployment();
    await newToken.mint(deployer.address, INITIAL_MUSDT);
    await newToken.approve(await router.getAddress(), INITIAL_MUSDT);

    await wbkc.mint(deployer.address, INITIAL_WBKC);
    await wbkc.approve(await router.getAddress(), INITIAL_WBKC);

    await router.connect(deployer).addLiquidity(
      await newToken.getAddress(),
      await wbkc.getAddress(),
      INITIAL_MUSDT,
      INITIAL_WBKC,
      0,
      0,
      deployer.address,
      Math.floor(Date.now() / 1000) + 3600,
      { gasLimit: 5_000_000 }
    );

    const pairAddr = await factory.getPair(
      await newToken.getAddress(),
      await wbkc.getAddress()
    );
    expect(pairAddr).to.not.equal(ethers.ZeroAddress);

    const pair = await ethers.getContractAt("IUniswapV2Pair", pairAddr);
    const bal = await pair.balanceOf(deployer.address);
    expect(bal).to.be.gt(0);
  });

  // =========================================================================
  // 11. Path validation
  // =========================================================================
  describe("Path validation", function () {
    it("swapExactTokensForTokens reverts with empty path", async function () {
      await expect(
        router.connect(userA).swapExactTokensForTokens(100, 0, [], userA.address, Math.floor(Date.now() / 1000) + 3600)
      ).to.be.revertedWith("BrokerSwapRouter: INVALID_PATH");
    });

    it("swapExactTokensForTokens reverts with single-element path", async function () {
      await expect(
        router.connect(userA).swapExactTokensForTokens(100, 0, [await wbkc.getAddress()], userA.address, Math.floor(Date.now() / 1000) + 3600)
      ).to.be.revertedWith("BrokerSwapRouter: INVALID_PATH");
    });

    it("swapExactBKCForTokens reverts with single-element path", async function () {
      await expect(
        router.connect(userA).swapExactBKCForTokens(0, [await wbkc.getAddress()], userA.address, Math.floor(Date.now() / 1000) + 3600, { value: 100 })
      ).to.be.revertedWith("BrokerSwapRouter: INVALID_PATH");
    });

    it("swapExactTokensForBKC reverts with single-element path", async function () {
      await expect(
        router.connect(userA).swapExactTokensForBKC(100, 0, [await wbkc.getAddress()], userA.address, Math.floor(Date.now() / 1000) + 3600)
      ).to.be.revertedWith("BrokerSwapRouter: INVALID_PATH");
    });

    it("swapTokensForExactTokens reverts with single-element path", async function () {
      await expect(
        router.connect(userA).swapTokensForExactTokens(100, 1000, [await wbkc.getAddress()], userA.address, Math.floor(Date.now() / 1000) + 3600)
      ).to.be.revertedWith("BrokerSwapRouter: INVALID_PATH");
    });

    it("swapTokensForExactBKC reverts with single-element path", async function () {
      await expect(
        router.connect(userA).swapTokensForExactBKC(100, 1000, [await wbkc.getAddress()], userA.address, Math.floor(Date.now() / 1000) + 3600)
      ).to.be.revertedWith("BrokerSwapRouter: INVALID_PATH");
    });

    it("swapBKCForExactTokens reverts with single-element path", async function () {
      await expect(
        router.connect(userA).swapBKCForExactTokens(100, [await wbkc.getAddress()], userA.address, Math.floor(Date.now() / 1000) + 3600, { value: 100 })
      ).to.be.revertedWith("BrokerSwapRouter: INVALID_PATH");
    });

    it("swapExactTokensForTokensSupportingFeeOnTransferTokens reverts with single-element path", async function () {
      await expect(
        router.connect(userA).swapExactTokensForTokensSupportingFeeOnTransferTokens(100, 0, [await wbkc.getAddress()], userA.address, Math.floor(Date.now() / 1000) + 3600)
      ).to.be.revertedWith("BrokerSwapRouter: INVALID_PATH");
    });

    it("swapExactBKCForTokensSupportingFeeOnTransferTokens reverts with single-element path", async function () {
      await expect(
        router.connect(userA).swapExactBKCForTokensSupportingFeeOnTransferTokens(0, [await wbkc.getAddress()], userA.address, Math.floor(Date.now() / 1000) + 3600, { value: 100 })
      ).to.be.revertedWith("BrokerSwapRouter: INVALID_PATH");
    });

    it("swapExactTokensForBKCSupportingFeeOnTransferTokens reverts with single-element path", async function () {
      await expect(
        router.connect(userA).swapExactTokensForBKCSupportingFeeOnTransferTokens(100, 0, [await wbkc.getAddress()], userA.address, Math.floor(Date.now() / 1000) + 3600)
      ).to.be.revertedWith("BrokerSwapRouter: INVALID_PATH");
    });
  });

  // =========================================================================
  // 12. Native BKC swaps (MockWBKC)
  // =========================================================================
  describe("Native BKC swaps (MockWBKC)", function () {
    let mockWbkc, factory2, router2, mockUsdt2;

    before(async function () {
      // Deploy MockWBKC as the real wBKC
      const MockWBKC = await ethers.getContractFactory("MockWBKC");
      mockWbkc = await MockWBKC.deploy();
      await mockWbkc.waitForDeployment();

      mockUsdt2 = await ethers.getContractFactory("MockUSDT").then(f => f.deploy());
      await mockUsdt2.waitForDeployment();

      const Factory = await ethers.getContractFactory("UniswapV2Factory");
      factory2 = await Factory.deploy(deployer.address);
      await factory2.waitForDeployment();

      const Router = await ethers.getContractFactory("BrokerSwapRouter");
      router2 = await Router.deploy(await factory2.getAddress(), await mockWbkc.getAddress());
      await router2.waitForDeployment();

      // Fund deployer and add liquidity
      await mockUsdt2.mint(deployer.address, INITIAL_MUSDT);
      await mockUsdt2.approve(await router2.getAddress(), INITIAL_MUSDT);

      // Wrap BKC to get WBKC, then add liquidity
      await mockWbkc.deposit({ value: INITIAL_WBKC });
      await mockWbkc.approve(await router2.getAddress(), INITIAL_WBKC);

      await router2.addLiquidity(
        await mockWbkc.getAddress(), await mockUsdt2.getAddress(),
        INITIAL_WBKC, INITIAL_MUSDT, 0, 0, deployer.address,
        Math.floor(Date.now() / 1000) + 3600, { gasLimit: 5_000_000 }
      );

      // Fund userA with native BKC and mUSDT
      await mockUsdt2.mint(userA.address, 1000n * USDT_UNIT);
      // deployer wraps and transfers WBKC to userA
      await mockWbkc.deposit({ value: ethers.parseEther("10") });
      await mockWbkc.transfer(userA.address, ethers.parseEther("5"));
    });

    it("swapExactBKCForTokens succeeds with real native BKC", async function () {
      const amountIn = ethers.parseEther("0.1");
      const path = [await mockWbkc.getAddress(), await mockUsdt2.getAddress()];
      const amounts = await router2.getAmountsOut(amountIn, path);
      const minOut = amounts[1] * 95n / 100n;

      const balBefore = await mockUsdt2.balanceOf(userA.address);
      await router2.connect(userA).swapExactBKCForTokens(
        minOut, path, userA.address,
        Math.floor(Date.now() / 1000) + 3600,
        { value: amountIn, gasLimit: 500_000 }
      );
      const balAfter = await mockUsdt2.balanceOf(userA.address);
      expect(balAfter).to.be.gt(balBefore);
    });

    it("swapBKCForExactTokens refunds excess BKC", async function () {
      const path = [await mockWbkc.getAddress(), await mockUsdt2.getAddress()];
      const amountOut = 10n * USDT_UNIT;
      const amounts = await router2.getAmountsIn(amountOut, path);
      const balBefore = await ethers.provider.getBalance(userA.address);
      const overpay = amounts[0] + ethers.parseEther("0.5");

      const tx = await router2.connect(userA).swapBKCForExactTokens(
        amountOut, path, userA.address,
        Math.floor(Date.now() / 1000) + 3600,
        { value: overpay, gasLimit: 500_000 }
      );
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(userA.address);
      // userA paid amounts[0] + gas, NOT overpay
      // balAfter ≈ balBefore - amounts[0] - gasCost
      // Simplistic check: user didn't lose the full overpay
      expect(balBefore - balAfter).to.be.lt(overpay);
    });

    it("swapExactTokensForBKC succeeds (token→native)", async function () {
      const amountIn = 50n * USDT_UNIT;
      const path = [await mockUsdt2.getAddress(), await mockWbkc.getAddress()];
      const amounts = await router2.getAmountsOut(amountIn, path);
      const minOut = amounts[1] * 95n / 100n;

      await mockUsdt2.connect(userA).approve(await router2.getAddress(), amountIn);

      const balBefore = await ethers.provider.getBalance(userA.address);
      const tx = await router2.connect(userA).swapExactTokensForBKC(
        amountIn, minOut, path, userA.address,
        Math.floor(Date.now() / 1000) + 3600,
        { gasLimit: 500_000 }
      );
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(userA.address);
      // Received BKC minus gas — should be more than just gas cost
      expect(balAfter + gasCost).to.be.gt(balBefore);
    });

    it("Router receive reverts when sender is not MockWBKC", async function () {
      await expect(
        deployer.sendTransaction({
          to: await router2.getAddress(),
          value: ethers.parseEther("1"),
        })
      ).to.be.reverted;
    });

    it("Direct native BKC transfer to MockWBKC mints WBKC balance", async function () {
      const balBefore = await mockWbkc.balanceOf(userB.address);
      await userB.sendTransaction({
        to: await mockWbkc.getAddress(),
        value: ethers.parseEther("0.5"),
      });
      const balAfter = await mockWbkc.balanceOf(userB.address);
      expect(balAfter - balBefore).to.equal(ethers.parseEther("0.5"));
    });
  });
});
