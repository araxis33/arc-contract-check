// Copies the compiled ContractCheckLog into docs/ so the deploy page ships exactly the bytecode
// the tests ran against. test/artifact.test.js fails if the two ever drift apart.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  await hre.run("compile");
  const artifact = await hre.artifacts.readArtifact("ContractCheckLog");
  const settings = hre.config.solidity.compilers[0];
  const out = {
    contractName: artifact.contractName,
    sourceName: artifact.sourceName,
    compiler: {
      version: settings.version,
      evmVersion: settings.settings.evmVersion,
      optimizer: settings.settings.optimizer,
    },
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    deployedBytecode: artifact.deployedBytecode,
  };
  const file = path.join(__dirname, "..", "docs", "ContractCheckLog.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log("wrote", path.relative(process.cwd(), file), (artifact.deployedBytecode.length - 2) / 2, "bytes runtime");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
