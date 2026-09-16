// The page's reading logic, run against real contracts on the in-process Hardhat chain.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const check = require("../docs/check.js");

const rpc = (method, params) => network.provider.request({ method, params });
const latest = async () => BigInt(await ethers.provider.getBlockNumber());
const lower = (a) => a.toLowerCase();

describe("check.js", function () {
  describe("keccak256", function () {
    it("matches ethers across padding boundaries", function () {
      for (const len of [0, 1, 55, 56, 135, 136, 137, 200, 271, 272, 273, 1000]) {
        const bytes = ethers.randomBytes(len);
        expect(check.keccak256(ethers.hexlify(bytes)), `length ${len}`).to.equal(ethers.keccak256(bytes));
      }
    });

    it("matches ethers on a full-size contract", function () {
      const bytes = ethers.randomBytes(24576);
      expect(check.keccak256(bytes)).to.equal(ethers.keccak256(bytes));
    });

    it("knows the hash of empty code", function () {
      expect(check.keccak256("0x")).to.equal(check.EMPTY_CODE_HASH);
    });

    it("derives every selector the page uses the same way ethers does", function () {
      for (const sig of Object.values(check.SIG)) {
        expect(check.selector(sig), sig).to.equal(ethers.id(sig).slice(0, 10));
      }
    });
  });

  describe("decoding", function () {
    it("reads an address only from a single clean word", function () {
      const a = ethers.Wallet.createRandom().address;
      expect(check.asAddress(ethers.zeroPadValue(a, 32))).to.equal(lower(a));
      expect(check.asAddress("0x")).to.equal(null);
      expect(check.asAddress(ethers.ZeroHash)).to.equal(null);
      expect(check.asAddress("0x" + "ff".repeat(32))).to.equal(null);
      expect(check.asAddress(ethers.zeroPadValue(a, 32) + "00".repeat(32))).to.equal(null);
    });

    it("decodes an address[] return", function () {
      const owners = [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address];
      const data = ethers.AbiCoder.defaultAbiCoder().encode(["address[]"], [owners]);
      expect(check.decodeAddressArray(data)).to.deep.equal(owners.map(lower));
    });
  });

  describe("inspect", function () {
    let signer, other, impl, replacement;

    beforeEach(async function () {
      [signer, other] = await ethers.getSigners();
      impl = await ethers.deployContract("PlainTarget");
      replacement = await ethers.deployContract("ReplacementTarget");
    });

    it("recognises a plain key", async function () {
      const r = await check.inspect(rpc, other.address, await latest());
      expect(r.kind).to.equal("key");
    });

    it("recognises a key with EIP-7702 delegated code", async function () {
      const key = ethers.Wallet.createRandom().address;
      const delegate = await impl.getAddress();
      await rpc("hardhat_setCode", [key, "0xef0100" + delegate.slice(2).toLowerCase()]);
      const r = await check.inspect(rpc, key, await latest());
      expect(r.kind).to.equal("delegated-key");
      expect(r.delegate).to.equal(lower(delegate));
    });

    it("reports a plain contract with no owner and no proxy", async function () {
      const target = await impl.getAddress();
      const r = await check.inspect(rpc, target, await latest());
      expect(r.kind).to.equal("contract");
      expect(r.codehash).to.equal(ethers.keccak256(await ethers.provider.getCode(target)));
      expect(r.proxy).to.equal(undefined);
      expect(r.owner).to.equal(undefined);
    });

    it("finds an owner held by a single key", async function () {
      const owned = await ethers.deployContract("Owned", [other.address]);
      const r = await check.inspect(rpc, await owned.getAddress(), await latest());
      expect(r.owner).to.deep.equal({ address: lower(other.address), type: "key" });
    });

    it("finds a transparent proxy and follows its ProxyAdmin to the key behind it", async function () {
      const proxyAdmin = await ethers.deployContract("Owned", [other.address]);
      const proxy = await ethers.deployContract("MiniProxy", [await impl.getAddress(), await proxyAdmin.getAddress()]);

      const r = await check.inspect(rpc, await proxy.getAddress(), await latest());
      expect(r.proxy.pattern).to.equal("transparent");
      expect(r.proxy.implementation).to.equal(lower(await impl.getAddress()));
      expect(r.proxy.implementationCodehash).to.equal(
        ethers.keccak256(await ethers.provider.getCode(await impl.getAddress()))
      );
      expect(r.upgradeAuthority.holder.type).to.equal("owned-contract");
      expect(r.upgradeAuthority.holder.owner).to.deep.equal({ address: lower(other.address), type: "key" });
    });

    it("finds a UUPS proxy and names owner() as the upgrade authority", async function () {
      const uupsImpl = await ethers.deployContract("UupsImplementation");
      const proxy = await ethers.deployContract("MiniUupsProxy", [await uupsImpl.getAddress(), other.address]);

      const r = await check.inspect(rpc, await proxy.getAddress(), await latest());
      expect(r.proxy.pattern).to.equal("uups");
      expect(r.upgradeAuthority.holder.address).to.equal(lower(other.address));
    });

    it("does not call a proxy UUPS when the implementation does not say so", async function () {
      const proxy = await ethers.deployContract("MiniUupsProxy", [await impl.getAddress(), other.address]);
      const r = await check.inspect(rpc, await proxy.getAddress(), await latest());
      expect(r.proxy.pattern).to.equal("eip1967");
      expect(r.upgradeAuthority).to.equal(undefined);
    });

    it("finds a beacon proxy, its implementation and the beacon's owner", async function () {
      const beacon = await ethers.deployContract("MiniBeacon", [await impl.getAddress(), other.address]);
      const proxy = await ethers.deployContract("MiniBeaconProxy", [await beacon.getAddress()]);

      const r = await check.inspect(rpc, await proxy.getAddress(), await latest());
      expect(r.proxy.pattern).to.equal("beacon");
      expect(r.proxy.beacon).to.equal(lower(await beacon.getAddress()));
      expect(r.proxy.implementation).to.equal(lower(await impl.getAddress()));
      expect(r.upgradeAuthority.holder.address).to.equal(lower(other.address));
    });

    it("reads the ZeppelinOS slots that USDC uses", async function () {
      const proxy = await ethers.deployContract("MiniZosProxy", [await impl.getAddress(), other.address]);
      const r = await check.inspect(rpc, await proxy.getAddress(), await latest());
      expect(r.proxy.pattern).to.equal("zeppelinos");
      expect(r.upgradeAuthority.holder).to.deep.equal({ address: lower(other.address), type: "key" });
    });

    it("recognises a Safe holding the upgrade key, with its threshold", async function () {
      const owners = [signer.address, other.address, ethers.Wallet.createRandom().address];
      const safe = await ethers.deployContract("MiniSafe", [owners, 2]);
      const proxy = await ethers.deployContract("MiniProxy", [await impl.getAddress(), await safe.getAddress()]);

      const h = (await check.inspect(rpc, await proxy.getAddress(), await latest())).upgradeAuthority.holder;
      expect(h.type).to.equal("safe");
      expect(h.threshold).to.equal(2);
      expect(h.owners).to.deep.equal(owners.map(lower));
    });

    it("recognises a timelock holding the upgrade key, with its delay", async function () {
      const timelock = await ethers.deployContract("MiniTimelock");
      const proxy = await ethers.deployContract("MiniProxy", [await impl.getAddress(), await timelock.getAddress()]);

      const h = (await check.inspect(rpc, await proxy.getAddress(), await latest())).upgradeAuthority.holder;
      expect(h.type).to.equal("timelock");
      expect(h.minDelaySeconds).to.equal(2 * 24 * 3600);
    });

    it("reads at the pinned block, not at whatever is latest by the time it finishes", async function () {
      const proxyAdmin = await ethers.deployContract("Owned", [other.address]);
      const proxy = await ethers.deployContract("MiniProxy", [await impl.getAddress(), await proxyAdmin.getAddress()]);
      const pinned = await latest();
      await proxy.upgradeTo(await replacement.getAddress());

      const r = await check.inspect(rpc, await proxy.getAddress(), pinned);
      expect(r.proxy.implementation).to.equal(lower(await impl.getAddress()));
    });
  });

  describe("round trip through ContractCheckLog", function () {
    it("records a snapshot, reads it back, and spots the upgrade that follows", async function () {
      const [signer, other] = await ethers.getSigners();
      const log = await ethers.deployContract("ContractCheckLog");
      const impl = await ethers.deployContract("PlainTarget");
      const replacement = await ethers.deployContract("ReplacementTarget");
      const proxy = await ethers.deployContract("MiniProxy", [await impl.getAddress(), other.address]);
      const target = await proxy.getAddress();
      const logAddress = await log.getAddress();

      const before = await check.inspect(rpc, target, await latest());
      const data = check.encodeRecord(before);
      const f = check.snapshotFields(before);
      expect(data).to.equal(
        log.interface.encodeFunctionData("record", [target, f.implementation, f.admin, f.owner, before.block])
      );
      await signer.sendTransaction({ to: logAddress, data });

      const stored = await check.readLatestSnapshot(rpc, logAddress, target);
      expect(stored.count).to.equal(1);
      expect(stored.latest.reporter).to.equal(lower(signer.address));
      expect(stored.latest.readAtBlock).to.equal(before.block);
      expect(check.compareSnapshot(stored.latest, before)).to.deep.equal([]);

      await proxy.upgradeTo(await replacement.getAddress());
      const after = await check.inspect(rpc, target, await latest());
      const changed = check.compareSnapshot(stored.latest, after).map((c) => c.field);
      expect(changed).to.deep.equal(["implementation", "implementationCodehash"]);
    });

    it("reports no snapshot for a target nobody has recorded", async function () {
      const log = await ethers.deployContract("ContractCheckLog");
      const impl = await ethers.deployContract("PlainTarget");
      const stored = await check.readLatestSnapshot(rpc, await log.getAddress(), await impl.getAddress());
      expect(stored).to.deep.equal({ count: 0, latest: null });
    });
  });
});
