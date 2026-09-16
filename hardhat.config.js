require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      // Arc mainnet accepts Cancun opcodes (checked with eth_call on 16.09.2026).
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
    },
  },
};
