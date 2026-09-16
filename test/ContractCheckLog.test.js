const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const ZERO = ethers.ZeroAddress;
const ZERO_HASH = ethers.ZeroHash;

async function mine(blocks) {
  await network.provider.send("hardhat_mine", ["0x" + blocks.toString(16)]);
}

async function codehashOf(address) {
  return ethers.keccak256(await ethers.provider.getCode(address));
}

describe("ContractCheckLog", function () {
  let log, plain, replacement, proxy, reporter, other;

  beforeEach(async function () {
    [reporter, other] = await ethers.getSigners();
    log = await ethers.deployContract("ContractCheckLog");
    plain = await ethers.deployContract("PlainTarget");
    replacement = await ethers.deployContract("ReplacementTarget");
    proxy = await ethers.deployContract("MiniProxy", [await plain.getAddress(), other.address]);
  });

  async function readBlock() {
    return BigInt(await ethers.provider.getBlockNumber());
  }

  describe("record", function () {
    it("stores a plain contract with its onchain codehash", async function () {
      const target = await plain.getAddress();
      const at = await readBlock();

      await log.record(target, ZERO, ZERO, ZERO, at);

      const s = await log.latestSnapshot(target);
      expect(s.codehash).to.equal(await codehashOf(target));
      expect(s.implementation).to.equal(ZERO);
      expect(s.implementationCodehash).to.equal(ZERO_HASH);
      expect(s.reporter).to.equal(reporter.address);
      expect(s.readAtBlock).to.equal(at);
      expect(s.recordedAtBlock).to.equal(await readBlock());
      expect(await log.snapshotCount(target)).to.equal(1n);
      expect(await log.totalSnapshots()).to.equal(1n);
    });

    it("hashes the implementation behind a proxy, not just the proxy", async function () {
      const target = await proxy.getAddress();
      const impl = await plain.getAddress();

      await log.record(target, impl, other.address, ZERO, await readBlock());

      const s = await log.latestSnapshot(target);
      expect(s.codehash).to.equal(await codehashOf(target));
      expect(s.implementationCodehash).to.equal(await codehashOf(impl));
      expect(s.implementationCodehash).to.not.equal(s.codehash);
      expect(s.admin).to.equal(other.address);
    });

    it("keeps history, so an upgrade shows up as a different implementation hash", async function () {
      const target = await proxy.getAddress();

      await log.record(target, await plain.getAddress(), other.address, ZERO, await readBlock());
      await proxy.upgradeTo(await replacement.getAddress());
      await log.record(target, await replacement.getAddress(), other.address, ZERO, await readBlock());

      expect(await log.snapshotCount(target)).to.equal(2n);
      const before = await log.snapshotAt(target, 0);
      const after = await log.snapshotAt(target, 1);
      // The proxy's own code did not change — only the implementation did. That is the
      // whole reason the implementation hash is recorded separately.
      expect(after.codehash).to.equal(before.codehash);
      expect(after.implementationCodehash).to.not.equal(before.implementationCodehash);
    });

    it("emits Recorded with the index and every field", async function () {
      const target = await proxy.getAddress();
      const impl = await plain.getAddress();
      const at = await readBlock();

      await expect(log.record(target, impl, other.address, reporter.address, at))
        .to.emit(log, "Recorded")
        .withArgs(
          target,
          0n,
          reporter.address,
          impl,
          other.address,
          reporter.address,
          await codehashOf(target),
          await codehashOf(impl),
          at
        );
    });

    it("keeps separate histories per target", async function () {
      await log.record(await plain.getAddress(), ZERO, ZERO, ZERO, await readBlock());
      await log.record(await proxy.getAddress(), await plain.getAddress(), ZERO, ZERO, await readBlock());
      await log.record(await proxy.getAddress(), await plain.getAddress(), ZERO, ZERO, await readBlock());

      expect(await log.snapshotCount(await plain.getAddress())).to.equal(1n);
      expect(await log.snapshotCount(await proxy.getAddress())).to.equal(2n);
      expect(await log.totalSnapshots()).to.equal(3n);
    });

    it("refuses an address with no code as the target", async function () {
      await expect(log.record(other.address, ZERO, ZERO, ZERO, await readBlock()))
        .to.be.revertedWithCustomError(log, "NotAContract")
        .withArgs(other.address);
    });

    it("refuses an implementation with no code", async function () {
      await expect(log.record(await proxy.getAddress(), other.address, ZERO, ZERO, await readBlock()))
        .to.be.revertedWithCustomError(log, "NotAContract")
        .withArgs(other.address);
    });

    it("refuses a read block in the future", async function () {
      const future = (await readBlock()) + 10n;
      await expect(log.record(await plain.getAddress(), ZERO, ZERO, ZERO, future)).to.be.revertedWithCustomError(
        log,
        "ReadAtFutureBlock"
      );
    });

    it("accepts a read exactly MAX_READ_AGE blocks old and refuses one block older", async function () {
      const maxAge = await log.MAX_READ_AGE();
      const target = await plain.getAddress();
      const at = await readBlock();

      // record() executes in the next block, so mine up to one block short of the limit.
      await mine(Number(maxAge) - 1);
      await log.record(target, ZERO, ZERO, ZERO, at);

      await expect(log.record(target, ZERO, ZERO, ZERO, at)).to.be.revertedWithCustomError(log, "ReadTooOld");
    });
  });

  describe("reads", function () {
    it("latestSnapshot and snapshotAt revert when there is nothing to return", async function () {
      const target = await plain.getAddress();
      await expect(log.latestSnapshot(target)).to.be.revertedWithCustomError(log, "NoSnapshot").withArgs(target, 0n);

      await log.record(target, ZERO, ZERO, ZERO, await readBlock());
      await expect(log.snapshotAt(target, 1)).to.be.revertedWithCustomError(log, "NoSnapshot").withArgs(target, 1n);
    });

    it("returns the snapshot as nine static words, which the page decodes by hand", async function () {
      const target = await plain.getAddress();
      await log.record(target, ZERO, ZERO, ZERO, await readBlock());

      const data = log.interface.encodeFunctionData("latestSnapshot", [target]);
      const raw = await ethers.provider.call({ to: await log.getAddress(), data });
      // 0x + 9 * 64 hex chars: no offset word, no length word.
      expect(raw.length).to.equal(2 + 9 * 64);
    });
  });
});
