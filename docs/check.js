// Arc Contract Check — the reading logic, kept free of the DOM so it runs under tests too.
//
// Everything here talks to the chain through one function, rpc(method, params), and reads every
// value at a single pinned block so a report never mixes two states of the chain.
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------------------------
  // Keccak-256. The Arc RPC does not serve eth_getProof, so code hashes are computed here.

  var MASK = (1n << 64n) - 1n;
  var RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808An, 0x8000000080008000n,
    0x000000000000808Bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008An, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000An,
    0x000000008000808Bn, 0x800000000000008Bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800An, 0x800000008000000An,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
  ];
  // Rotation offsets indexed by x + 5y.
  var ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

  function rotl(v, n) {
    if (n === 0) return v;
    var b = BigInt(n);
    return ((v << b) | (v >> (64n - b))) & MASK;
  }

  function keccakF(s) {
    var C = new Array(5), B = new Array(25), x, y, r;
    for (r = 0; r < 24; r++) {
      for (x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
      for (x = 0; x < 5; x++) {
        var D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
        for (y = 0; y < 25; y += 5) s[y + x] ^= D;
      }
      for (x = 0; x < 5; x++) {
        for (y = 0; y < 5; y++) B[y + ((2 * x + 3 * y) % 5) * 5] = rotl(s[x + 5 * y], ROT[x + 5 * y]);
      }
      for (x = 0; x < 5; x++) {
        for (y = 0; y < 5; y++) {
          s[x + 5 * y] = B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y] & MASK) & B[(x + 2) % 5 + 5 * y]);
        }
      }
      s[0] ^= RC[r];
    }
  }

  function hexToBytes(hex) {
    var h = hex.slice(0, 2) === '0x' ? hex.slice(2) : hex;
    if (h.length % 2) throw new Error('odd-length hex');
    var out = new Uint8Array(h.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }

  function keccak256(input) {
    var bytes = typeof input === 'string' ? hexToBytes(input) : input;
    var rate = 136, s = new Array(25).fill(0n);
    var padded = new Uint8Array((Math.floor(bytes.length / rate) + 1) * rate);
    padded.set(bytes);
    padded[bytes.length] ^= 0x01;
    padded[padded.length - 1] ^= 0x80;
    for (var off = 0; off < padded.length; off += rate) {
      for (var i = 0; i < rate / 8; i++) {
        var lane = 0n;
        for (var j = 7; j >= 0; j--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + j]);
        s[i] ^= lane;
      }
      keccakF(s);
    }
    var hex = '0x';
    for (var k = 0; k < 4; k++) {
      for (var m = 0; m < 8; m++) hex += Number((s[k] >> BigInt(8 * m)) & 0xFFn).toString(16).padStart(2, '0');
    }
    return hex;
  }

  function utf8(str) {
    return new TextEncoder().encode(str);
  }

  function selector(signature) {
    return keccak256(utf8(signature)).slice(0, 10);
  }

  // ---------------------------------------------------------------------------------------------
  // ABI, only as much as this tool needs.

  var ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  var ZERO_HASH = '0x' + '0'.repeat(64);
  // keccak256('') — the code hash of an account with no code.
  var EMPTY_CODE_HASH = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470';

  function isAddress(s) {
    return /^0x[0-9a-fA-F]{40}$/.test(s);
  }

  function word(hex) {
    return hex.replace(/^0x/, '').padStart(64, '0');
  }

  function encodeAddress(a) {
    return word(a.toLowerCase());
  }

  function encodeUint(n) {
    return BigInt(n).toString(16).padStart(64, '0');
  }

  function words(data) {
    var h = (data || '0x').replace(/^0x/, '');
    var out = [];
    for (var i = 0; i + 64 <= h.length; i += 64) out.push(h.slice(i, i + 64));
    return out;
  }

  // A return value counts as an address only if it is exactly one word whose top 12 bytes are
  // zero. Anything else (a revert, a fallback echoing calldata, a struct) is not an answer.
  function asAddress(data) {
    var w = words(data);
    if (w.length !== 1 || !/^0{24}/.test(w[0])) return null;
    var a = '0x' + w[0].slice(24);
    return a === ZERO_ADDRESS ? null : a;
  }

  function slotToAddress(slotValue) {
    var w = word(slotValue || '0x0');
    if (!/^0{24}/.test(w)) return null;
    var a = '0x' + w.slice(24);
    return a === ZERO_ADDRESS ? null : a;
  }

  function sameAddress(a, b) {
    return (a || ZERO_ADDRESS).toLowerCase() === (b || ZERO_ADDRESS).toLowerCase();
  }

  // ---------------------------------------------------------------------------------------------
  // Where proxies keep their pointers.

  var SLOTS = {
    eip1967Implementation: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
    eip1967Admin: '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
    eip1967Beacon: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
    // ZeppelinOS-era slots. USDC's own proxy uses these, on Arc as everywhere else.
    zosImplementation: '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3',
    zosAdmin: '0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b'
  };

  var SIG = {
    owner: 'owner()',
    implementation: 'implementation()',
    proxiableUUID: 'proxiableUUID()',
    getThreshold: 'getThreshold()',
    getOwners: 'getOwners()',
    getMinDelay: 'getMinDelay()',
    snapshotCount: 'snapshotCount(address)',
    latestSnapshot: 'latestSnapshot(address)',
    record: 'record(address,address,address,address,uint64)'
  };

  function makeReader(rpc, blockTag) {
    function call(to, sig, args) {
      var data = selector(sig) + (args || []).join('');
      return rpc('eth_call', [{ to: to, data: data }, blockTag]).then(
        function (r) { return r; },
        function () { return null; } // a revert is an answer too: "this function is not here"
      );
    }
    function code(addr) { return rpc('eth_getCode', [addr, blockTag]); }
    function slot(addr, s) { return rpc('eth_getStorageAt', [addr, s, blockTag]); }
    return { call: call, code: code, slot: slot };
  }

  function delegateOf(code) {
    // EIP-7702: an account with code 0xef0100 || address is a key with delegated behaviour.
    return /^0xef0100[0-9a-fA-F]{40}$/i.test(code) ? '0x' + code.slice(8).toLowerCase() : null;
  }

  // What kind of thing holds a given power. Follows one level of indirection (a ProxyAdmin
  // or similar that is itself owned), which is where the real key usually sits.
  function describeHolder(reader, addr, depth) {
    depth = depth || 0;
    return reader.code(addr).then(function (code) {
      if (!code || code === '0x') return { address: addr, type: 'key' };
      var delegate = delegateOf(code);
      if (delegate) return { address: addr, type: 'delegated-key', delegate: delegate };

      return Promise.all([
        reader.call(addr, SIG.getThreshold),
        reader.call(addr, SIG.getOwners),
        reader.call(addr, SIG.getMinDelay),
        reader.call(addr, SIG.owner)
      ]).then(function (res) {
        var threshold = words(res[0]).length === 1 ? Number(BigInt('0x' + words(res[0])[0])) : null;
        var owners = decodeAddressArray(res[1]);
        if (threshold !== null && owners && threshold > 0 && threshold <= owners.length) {
          return { address: addr, type: 'safe', threshold: threshold, owners: owners };
        }
        var delay = words(res[2]).length === 1 ? BigInt('0x' + words(res[2])[0]) : null;
        if (delay !== null) return { address: addr, type: 'timelock', minDelaySeconds: Number(delay) };

        var owner = asAddress(res[3]);
        if (owner && depth < 2) {
          return describeHolder(reader, owner, depth + 1).then(function (inner) {
            return { address: addr, type: 'owned-contract', owner: inner };
          });
        }
        return { address: addr, type: 'contract' };
      });
    });
  }

  function decodeAddressArray(data) {
    var w = words(data);
    if (w.length < 2) return null;
    var offset = Number(BigInt('0x' + w[0])) / 32;
    if (offset !== 1) return null;
    var len = Number(BigInt('0x' + w[1]));
    if (len < 1 || len > 64 || w.length !== 2 + len) return null;
    var out = [];
    for (var i = 0; i < len; i++) {
      if (!/^0{24}/.test(w[2 + i])) return null;
      out.push('0x' + w[2 + i].slice(24));
    }
    return out;
  }

  // The full report for one address at one block.
  function inspect(rpc, target, blockNumber) {
    if (!isAddress(target)) return Promise.reject(new Error('Not an address: expected 0x followed by 40 hex characters.'));
    var tag = '0x' + BigInt(blockNumber).toString(16);
    var reader = makeReader(rpc, tag);
    var report = { address: target.toLowerCase(), block: Number(blockNumber) };

    return reader.code(target).then(function (code) {
      if (!code || code === '0x') {
        report.kind = 'key';
        return report;
      }
      var delegate = delegateOf(code);
      if (delegate) {
        report.kind = 'delegated-key';
        report.delegate = delegate;
        return report;
      }
      report.kind = 'contract';
      report.codeSize = (code.length - 2) / 2;
      report.codehash = keccak256(code);

      return Promise.all([
        reader.slot(target, SLOTS.eip1967Implementation),
        reader.slot(target, SLOTS.eip1967Admin),
        reader.slot(target, SLOTS.eip1967Beacon),
        reader.slot(target, SLOTS.zosImplementation),
        reader.slot(target, SLOTS.zosAdmin),
        reader.call(target, SIG.owner)
      ]).then(function (v) {
        var impl1967 = slotToAddress(v[0]);
        var admin1967 = slotToAddress(v[1]);
        var beacon = slotToAddress(v[2]);
        var implZos = slotToAddress(v[3]);
        var adminZos = slotToAddress(v[4]);
        var owner = asAddress(v[5]);

        var steps = [];
        if (owner) {
          steps.push(describeHolder(reader, owner).then(function (h) { report.owner = h; }));
        }

        if (beacon) {
          steps.push(
            Promise.all([reader.call(beacon, SIG.implementation), reader.call(beacon, SIG.owner)]).then(function (b) {
              report.proxy = { pattern: 'beacon', beacon: beacon, implementation: asAddress(b[0]) };
              var beaconOwner = asAddress(b[1]);
              if (beaconOwner) {
                return describeHolder(reader, beaconOwner).then(function (h) {
                  report.upgradeAuthority = { source: "the beacon's owner()", holder: h };
                });
              }
            })
          );
        } else if (impl1967 && admin1967) {
          report.proxy = { pattern: 'transparent', implementation: impl1967 };
          steps.push(describeHolder(reader, admin1967).then(function (h) {
            report.upgradeAuthority = { source: 'the EIP-1967 admin slot', holder: h };
          }));
        } else if (impl1967) {
          steps.push(
            reader.call(impl1967, SIG.proxiableUUID).then(function (uuid) {
              var isUups = words(uuid).length === 1 && '0x' + words(uuid)[0] === SLOTS.eip1967Implementation;
              report.proxy = { pattern: isUups ? 'uups' : 'eip1967', implementation: impl1967 };
              if (isUups && report.owner) {
                report.upgradeAuthority = { source: 'owner(), which authorises upgrades in a UUPS proxy', holder: report.owner };
              }
            })
          );
        } else if (implZos) {
          report.proxy = { pattern: 'zeppelinos', implementation: implZos };
          if (adminZos) {
            steps.push(describeHolder(reader, adminZos).then(function (h) {
              report.upgradeAuthority = { source: 'the ZeppelinOS admin slot', holder: h };
            }));
          }
        }

        return Promise.all(steps).then(function () {
          // UUPS authority is owner(), and the owner lookup may have finished after the proxy
          // classification — settle it once both are known.
          if (report.proxy && report.proxy.pattern === 'uups' && !report.upgradeAuthority && report.owner) {
            report.upgradeAuthority = { source: 'owner(), which authorises upgrades in a UUPS proxy', holder: report.owner };
          }
          if (report.proxy && report.proxy.implementation) {
            return reader.code(report.proxy.implementation).then(function (implCode) {
              report.proxy.implementationCodehash = implCode && implCode !== '0x' ? keccak256(implCode) : null;
            });
          }
        });
      }).then(function () { return report; });
    });
  }

  // The five values a snapshot stores about authority, derived the same way every time so a
  // later reading can be compared with an earlier one field by field.
  function snapshotFields(report) {
    return {
      implementation: (report.proxy && report.proxy.implementation) || ZERO_ADDRESS,
      admin: (report.upgradeAuthority && report.upgradeAuthority.holder.address) || ZERO_ADDRESS,
      owner: (report.owner && report.owner.address) || ZERO_ADDRESS,
      codehash: report.codehash || ZERO_HASH,
      implementationCodehash: (report.proxy && report.proxy.implementationCodehash) || ZERO_HASH
    };
  }

  // ---------------------------------------------------------------------------------------------
  // The onchain log.

  function decodeSnapshot(data) {
    var w = words(data);
    if (w.length !== 9) return null;
    var addr = function (x) { return '0x' + x.slice(24); };
    var num = function (x) { return Number(BigInt('0x' + x)); };
    return {
      implementation: addr(w[0]),
      readAtBlock: num(w[1]),
      admin: addr(w[2]),
      recordedAtBlock: num(w[3]),
      owner: addr(w[4]),
      recordedAt: num(w[5]),
      reporter: addr(w[6]),
      codehash: '0x' + w[7],
      implementationCodehash: '0x' + w[8]
    };
  }

  function readLatestSnapshot(rpc, logAddress, target) {
    var reader = makeReader(rpc, 'latest');
    return reader.call(logAddress, SIG.snapshotCount, [encodeAddress(target)]).then(function (countData) {
      var w = words(countData);
      var count = w.length === 1 ? Number(BigInt('0x' + w[0])) : 0;
      if (!count) return { count: 0, latest: null };
      return reader.call(logAddress, SIG.latestSnapshot, [encodeAddress(target)]).then(function (d) {
        return { count: count, latest: decodeSnapshot(d) };
      });
    });
  }

  // Which of the stored fields no longer match the chain.
  function compareSnapshot(snapshot, report) {
    var now = snapshotFields(report);
    var changes = [];
    ['implementation', 'admin', 'owner'].forEach(function (k) {
      if (!sameAddress(snapshot[k], now[k])) changes.push({ field: k, was: snapshot[k], now: now[k] });
    });
    ['codehash', 'implementationCodehash'].forEach(function (k) {
      if (snapshot[k].toLowerCase() !== now[k].toLowerCase()) changes.push({ field: k, was: snapshot[k], now: now[k] });
    });
    return changes;
  }

  function encodeRecord(report) {
    var f = snapshotFields(report);
    return selector(SIG.record) +
      encodeAddress(report.address) +
      encodeAddress(f.implementation) +
      encodeAddress(f.admin) +
      encodeAddress(f.owner) +
      encodeUint(report.block);
  }

  var api = {
    keccak256: keccak256,
    selector: selector,
    isAddress: isAddress,
    asAddress: asAddress,
    decodeAddressArray: decodeAddressArray,
    inspect: inspect,
    snapshotFields: snapshotFields,
    decodeSnapshot: decodeSnapshot,
    readLatestSnapshot: readLatestSnapshot,
    compareSnapshot: compareSnapshot,
    encodeRecord: encodeRecord,
    SIG: SIG,
    SLOTS: SLOTS,
    ZERO_ADDRESS: ZERO_ADDRESS,
    ZERO_HASH: ZERO_HASH,
    EMPTY_CODE_HASH: EMPTY_CODE_HASH
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArcCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
