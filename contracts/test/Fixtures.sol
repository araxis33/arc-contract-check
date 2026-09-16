// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Test-only contracts that imitate the storage layouts and entry points of real proxies,
// multisigs and timelocks. None of these are deployed to Arc.

contract PlainTarget {
    uint256 public value = 1;
}

contract ReplacementTarget {
    uint256 public value = 2;
}

contract Owned {
    address public owner;

    constructor(address owner_) {
        owner = owner_;
    }
}

/// Minimal transparent proxy: implementation and admin in the EIP-1967 slots.
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

/// A UUPS implementation answers proxiableUUID() with the implementation slot.
contract UupsImplementation {
    function proxiableUUID() external pure returns (bytes32) {
        return 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    }
}

/// UUPS proxy stand-in: implementation slot set, admin slot empty, owner() on the proxy.
contract MiniUupsProxy {
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    address public owner;

    constructor(address implementation, address owner_) {
        owner = owner_;
        assembly {
            sstore(IMPLEMENTATION_SLOT, implementation)
        }
    }
}

contract MiniBeacon {
    address public implementation;
    address public owner;

    constructor(address implementation_, address owner_) {
        implementation = implementation_;
        owner = owner_;
    }
}

contract MiniBeaconProxy {
    bytes32 private constant BEACON_SLOT = 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50;

    constructor(address beacon) {
        assembly {
            sstore(BEACON_SLOT, beacon)
        }
    }
}

/// The layout USDC's proxy uses, on Arc and elsewhere.
contract MiniZosProxy {
    bytes32 private constant IMPLEMENTATION_SLOT = 0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3;
    bytes32 private constant ADMIN_SLOT = 0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b;

    constructor(address implementation, address admin) {
        assembly {
            sstore(IMPLEMENTATION_SLOT, implementation)
            sstore(ADMIN_SLOT, admin)
        }
    }
}

contract MiniSafe {
    address[] private _owners;
    uint256 private _threshold;

    constructor(address[] memory owners_, uint256 threshold_) {
        _owners = owners_;
        _threshold = threshold_;
    }

    function getOwners() external view returns (address[] memory) {
        return _owners;
    }

    function getThreshold() external view returns (uint256) {
        return _threshold;
    }
}

contract MiniTimelock {
    function getMinDelay() external pure returns (uint256) {
        return 2 days;
    }
}
