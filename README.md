# Arc Contract Check

[![test](https://github.com/araxis33/arc-contract-check/actions/workflows/test.yml/badge.svg)](https://github.com/araxis33/arc-contract-check/actions/workflows/test.yml)

**Who can change this contract?** Paste an address on Arc mainnet and get one plain sentence back:
whether the code behind it can be replaced, and what holds that power — a single key, a Safe with
its threshold, or a timelock with its delay. Then pin what you saw onchain, so if it ever changes,
the difference is visible to everyone who checks after you.

**Live:** https://araxis33.github.io/arc-contract-check/

Try it on USDC's own interface on Arc,
[`0x3600…0000`](https://araxis33.github.io/arc-contract-check/?address=0x3600000000000000000000000000000000000000):
it is a proxy in the ZeppelinOS layout, and on 16 September 2026 both its upgrade admin and its
`owner()` were accounts with no code. The chain cannot say how those keys are held, only that
each is one key rather than a multisig or a timelock. That is exactly the kind of fact this tool
exists to put in front of people before they approve anything.

## What it reads

Everything is read from `rpc.mainnet.arc.io` in the browser, at **one pinned block**, so a report
never mixes two states of the chain.

| Question | How |
|---|---|
| Is this a contract at all? | `eth_getCode`; recognises plain keys and EIP-7702 delegated keys |
| Is it a proxy, and which kind? | EIP-1967 implementation, admin and beacon slots; the older ZeppelinOS slots USDC uses; `proxiableUUID()` to tell UUPS apart |
| Who can upgrade it? | admin slot (transparent), `owner()` (UUPS), the beacon's `owner()` (beacon) |
| What is that holder? | `getThreshold()` + `getOwners()` → Safe; `getMinDelay()` → timelock; `owner()` of an owned contract, followed one level down |
| Has it changed since someone looked? | code hashes and addresses compared with the latest snapshot in `ContractCheckLog` |

The Arc RPC does not serve `eth_getProof`, so code hashes are computed in the page with a small
Keccak-256 ([`docs/check.js`](docs/check.js)), tested against ethers on every padding boundary
and on a full 24 KB contract.

**What it does not see:** role-based permissions (`AccessControl`), upgrade functions with custom
names, pause switches, and anything an owner can do besides upgrading. A clean result narrows the
question; it is not an audit.

## The onchain record

[`ContractCheckLog`](contracts/ContractCheckLog.sol) is an append-only log anyone can write to.
A snapshot holds two kinds of data, and they deserve different amounts of trust:

- **Code hashes** of the target and of its implementation are read by the contract itself, with
  `EXTCODEHASH`, in the block the snapshot lands. They cannot be misreported.
- **Implementation, upgrade authority and owner** live in storage slots and view calls that one
  contract cannot read on another, so they are what the reporter's browser read at
  `readAtBlock`. The contract refuses a `readAtBlock` in the future or more than 7 200 blocks
  (about an hour) old, so a reading cannot be backdated, and the page compares every stored value
  with the live chain before it says "nothing has changed".

Snapshots are kept in storage rather than only in events because the public Arc RPC refuses wide
`eth_getLogs` ranges; the page needs one `eth_call` to show the latest record.

| | |
|---|---|
| Network | Arc mainnet, chain ID 5042 |
| Address | *deployment pending* |
| Compiler | solc 0.8.28, EVM `cancun`, optimizer 200 runs |
| Deploy cost | ~581 000 gas, about $0.012 at the 20 gwei floor |

## Develop

```sh
npm ci
npm test          # contract + page logic, 32 tests
npm run export    # refresh docs/ContractCheckLog.json after changing the contract
```

The page is plain HTML and JavaScript in [`docs/`](docs) with no build step; serve that folder
with any static server. [`docs/deploy.html`](docs/deploy.html) deploys the exported bytecode from
your own wallet and then compares the code on chain with it byte for byte.

## Related

- [deftools.xyz/arc.html](https://deftools.xyz/arc.html) — Arc fees in dollars, and a checker for
  the 18-vs-6 decimals mismatch between native USDC and its ERC-20 interface.

MIT licence.
