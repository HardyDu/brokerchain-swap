const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TransferFromProbe", function () {
  it("pulls approved MockUSDT and refunds it in the same transaction", async function () {
    const [owner, user] = await ethers.getSigners();
    const token = await ethers.getContractFactory("MockUSDT").then((factory) => factory.deploy());
    const probe = await ethers.getContractFactory("TransferFromProbe").then((factory) => factory.deploy());
    const amount = 1_000_000n;

    await token.transfer(user.address, amount);
    await token.connect(user).approve(await probe.getAddress(), amount);
    const balanceBefore = await token.balanceOf(user.address);

    await expect(probe.connect(user).probe(await token.getAddress(), amount))
      .to.emit(probe, "ProbeResult")
      .withArgs(true, true, ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [true]), amount, 0);

    expect(await token.balanceOf(user.address)).to.equal(balanceBefore);
    expect(await token.balanceOf(await probe.getAddress())).to.equal(0);
    expect(owner.address).to.not.equal(user.address);
  });

  it("emits return data from a static call", async function () {
    const token = await ethers.getContractFactory("MockUSDT").then((factory) => factory.deploy());
    const probe = await ethers.getContractFactory("TransferFromProbe").then((factory) => factory.deploy());
    const callData = token.interface.encodeFunctionData("decimals");
    const expected = ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [6]);

    await expect(probe.staticProbe(await token.getAddress(), callData))
      .to.emit(probe, "StaticCallResult")
      .withArgs(await token.getAddress(), true, expected);
  });

  it("restricts diagnostic approvals and token recovery to the deployer", async function () {
    const [owner, other] = await ethers.getSigners();
    const token = await ethers.getContractFactory("MockUSDT").then((factory) => factory.deploy());
    const probe = await ethers.getContractFactory("TransferFromProbe").then((factory) => factory.deploy());
    const amount = 1_000_000n;

    await token.transfer(await probe.getAddress(), amount);
    await expect(
      probe.connect(other).approveToken(await token.getAddress(), other.address, amount)
    ).to.be.revertedWith("TransferFromProbe: FORBIDDEN");
    await expect(
      probe.connect(other).recoverToken(await token.getAddress(), other.address, amount)
    ).to.be.revertedWith("TransferFromProbe: FORBIDDEN");

    await expect(probe.approveToken(await token.getAddress(), other.address, amount))
      .to.emit(probe, "TokenCallResult");
    await expect(probe.recoverToken(await token.getAddress(), owner.address, amount))
      .to.emit(probe, "TokenCallResult");
    expect(await token.balanceOf(await probe.getAddress())).to.equal(0);
  });
});
