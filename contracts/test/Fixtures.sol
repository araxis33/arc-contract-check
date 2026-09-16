// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Test-only contracts. None of these are deployed to Arc.

contract PlainTarget {
    uint256 public value = 1;
}

contract ReplacementTarget {
    uint256 public value = 2;
}

/// Minimal EIP-1967 proxy: enough storage layout to stand in for a real upgradeable contract.
contract MiniProxy {
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 private constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    constructor(address implementation, address admin) {
        assembly {
            sstore(IMPLEMENTATION_SLOT, implementation)
            sstore(ADMIN_SLOT, admin)
        }
    }

    function upgradeTo(address implementation) external {
        assembly {
            sstore(IMPLEMENTATION_SLOT, implementation)
        }
    }
}
