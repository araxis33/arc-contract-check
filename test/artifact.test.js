const { expect } = require("chai");
const hre = require("hardhat");
const shipped = require("../docs/ContractCheckLog.json");

describe("docs/ContractCheckLog.json", function () {
  it("is the bytecode these tests compiled, so the deploy page ships what was tested", async function () {
    const artifact = await hre.artifacts.readArtifact("ContractCheckLog");
    expect(shipped.bytecode).to.equal(artifact.bytecode);
    expect(shipped.deployedBytecode).to.equal(artifact.deployedBytecode);
    expect(shipped.abi).to.deep.equal(artifact.abi);
  });
});
