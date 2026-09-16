// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ContractCheckLog
/// @notice A public, append-only record of who could change a contract on Arc, as read at a
/// given block. Anyone can record a snapshot of any contract.
///
/// Two kinds of data go into a snapshot, and they deserve different amounts of trust:
///   - Code hashes are read here, onchain, when the snapshot is recorded. They cannot be
///     misreported.
///   - Implementation, admin and owner come from storage slots and view calls that one contract
///     cannot read on another. They are what the reporter read at `readAtBlock`, so anyone can
///     re-check them against that block. The checker page does exactly that before trusting them.
contract ContractCheckLog {
    struct Snapshot {
        address implementation;
        uint64 readAtBlock;
        address admin;
        uint64 recordedAtBlock;
        address owner;
        uint64 recordedAt;
        address reporter;
        bytes32 codehash;
        bytes32 implementationCodehash;
    }

    /// @notice How far back `readAtBlock` may be. About an hour at Arc's ~0.5 s blocks; old
    /// enough for a slow wallet confirmation, too recent to backdate a snapshot meaningfully.
    uint64 public constant MAX_READ_AGE = 7200;

    uint256 public totalSnapshots;

    mapping(address target => Snapshot[]) private _history;

    event Recorded(
        address indexed target,
        uint256 indexed index,
        address indexed reporter,
        address implementation,
        address admin,
        address owner,
        bytes32 codehash,
        bytes32 implementationCodehash,
        uint64 readAtBlock
    );

    error NotAContract(address account);
    error ReadAtFutureBlock(uint64 readAtBlock, uint256 currentBlock);
    error ReadTooOld(uint64 readAtBlock, uint256 currentBlock);
    error NoSnapshot(address target, uint256 index);

    /// @param target The contract being described.
    /// @param implementation Implementation behind a proxy, or zero if the target is not a proxy.
    /// @param admin Upgrade admin read from the proxy's admin slot, or zero if none.
    /// @param owner Result of owner() on the target, or zero if it has none.
    /// @param readAtBlock The block the three values above were read at.
    /// @return index Position of the new snapshot in the target's history.
    function record(address target, address implementation, address admin, address owner, uint64 readAtBlock)
        external
        returns (uint256 index)
    {
        if (target.code.length == 0) revert NotAContract(target);
        if (implementation != address(0) && implementation.code.length == 0) {
            revert NotAContract(implementation);
        }
        if (readAtBlock > block.number) revert ReadAtFutureBlock(readAtBlock, block.number);
        if (block.number - readAtBlock > MAX_READ_AGE) revert ReadTooOld(readAtBlock, block.number);

        bytes32 codehash = target.codehash;
        bytes32 implementationCodehash = implementation == address(0) ? bytes32(0) : implementation.codehash;

        Snapshot[] storage history = _history[target];
        index = history.length;
        history.push(
            Snapshot({
                implementation: implementation,
                readAtBlock: readAtBlock,
                admin: admin,
                recordedAtBlock: uint64(block.number),
                owner: owner,
                recordedAt: uint64(block.timestamp),
                reporter: msg.sender,
                codehash: codehash,
                implementationCodehash: implementationCodehash
            })
        );
        unchecked {
            ++totalSnapshots;
        }

        emit Recorded(target, index, msg.sender, implementation, admin, owner, codehash, implementationCodehash, readAtBlock);
    }

    function snapshotCount(address target) external view returns (uint256) {
        return _history[target].length;
    }

    function snapshotAt(address target, uint256 index) external view returns (Snapshot memory) {
        Snapshot[] storage history = _history[target];
        if (index >= history.length) revert NoSnapshot(target, index);
        return history[index];
    }

    function latestSnapshot(address target) external view returns (Snapshot memory) {
        Snapshot[] storage history = _history[target];
        if (history.length == 0) revert NoSnapshot(target, 0);
        return history[history.length - 1];
    }
}
