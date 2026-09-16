(function () {
  'use strict';

  var C = window.ArcCheck;
  var W = window.ArcWallet;
  var D = window.ARC_CHECK_DEPLOYMENT;
  var $ = function (id) { return document.getElementById(id); };

  var rpc = W.publicRpc;
  var current = null;   // the report on screen
  var stored = null;    // the latest onchain snapshot for it, if any

  // --- small DOM helpers: every value from the chain goes in as text, never as HTML ------------

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function mono(text) {
    return el('span', 'mono', text);
  }

  function short(a) {
    return a.slice(0, 6) + '…' + a.slice(-4);
  }

  function duration(seconds) {
    if (seconds % 86400 === 0) return (seconds / 86400) + (seconds === 86400 ? ' day' : ' days');
    if (seconds % 3600 === 0) return (seconds / 3600) + (seconds === 3600 ? ' hour' : ' hours');
    if (seconds >= 60) return Math.round(seconds / 60) + ' minutes';
    return seconds + ' seconds';
  }

  function setStamp(cls, text) {
    var s = $('stamp');
    s.textContent = '';
    s.appendChild(el('span', 'dot ' + cls));
    s.appendChild(document.createTextNode(text));
  }

  // --- words for what the chain says -----------------------------------------------------------

  function holderPhrase(h) {
    switch (h.type) {
      case 'key': return 'a single key';
      case 'delegated-key': return 'a single key with EIP-7702 delegated code';
      case 'safe': return 'a Safe multisig needing ' + h.threshold + ' of ' + h.owners.length + ' signers';
      case 'timelock': return 'a timelock that makes every change wait at least ' + duration(h.minDelaySeconds);
      case 'owned-contract': return 'a contract whose owner is ' + holderPhrase(h.owner);
      default: return 'a contract this page does not recognise';
    }
  }

  function holderHint(h) {
    switch (h.type) {
      case 'key': return 'An account with no code. It may sit in a hardware module or on a laptop; the chain cannot tell which.';
      case 'delegated-key': return 'Still one private key in the end. Delegates to ' + h.delegate + '.';
      case 'safe': return 'Signers: ' + h.owners.join(', ');
      case 'timelock': return 'Scheduled changes are public for that long before they can run.';
      case 'owned-contract': return 'Contract ' + h.address + ' → owner ' + h.owner.address;
      default: return 'Read its code before trusting it.';
    }
  }

  function patternName(p) {
    return {
      transparent: 'Transparent proxy (EIP-1967)',
      uups: 'UUPS proxy (EIP-1822 / EIP-1967)',
      eip1967: 'Proxy (EIP-1967 implementation slot)',
      beacon: 'Beacon proxy (EIP-1967)',
      zeppelinos: 'Proxy (ZeppelinOS slots, the layout USDC uses)'
    }[p] || p;
  }

  function verdictFor(r) {
    if (r.kind === 'key') {
      return { cls: 'info', parts: ['This address is ', ['strong', 'not a contract'], '. It is an account controlled by a private key, so there is no code to check.'] };
    }
    if (r.kind === 'delegated-key') {
      return { cls: 'info', parts: ['This is ', ['strong', 'a key with delegated code'], ' (EIP-7702). Its behaviour comes from ', ['mono', r.delegate], ', and the key can point it somewhere else at any time.'] };
    }
    if (r.proxy && r.upgradeAuthority) {
      return { cls: 'warn', parts: ['The code behind this address ', ['strong', 'can be replaced'], '. That power sits with ', ['strong', holderPhrase(r.upgradeAuthority.holder)], '.'] };
    }
    if (r.proxy) {
      return { cls: 'warn', parts: ['This is ', ['strong', 'a proxy'], ', so its code can change, but this page could not tell who controls upgrades. Read the implementation before relying on it.'] };
    }
    if (r.owner) {
      return { cls: 'ok', parts: ['No proxy found: ', ['strong', 'the code at this address is fixed'], '. It does have an owner, ', ['strong', holderPhrase(r.owner)], ', so check what the owner is allowed to call.'] };
    }
    return { cls: 'ok', parts: ['No proxy and no owner() found: ', ['strong', 'the code at this address is fixed'], ' and has no single obvious controller.'] };
  }

  function renderVerdict(r) {
    var v = verdictFor(r), box = $('verdict');
    box.className = 'verdict ' + v.cls;
    box.textContent = '';
    v.parts.forEach(function (p) {
      if (typeof p === 'string') box.appendChild(document.createTextNode(p));
      else box.appendChild(p[0] === 'mono' ? mono(p[1]) : el(p[0], null, p[1]));
    });
  }

  function fact(label, value, hint) {
    var row = el('div', 'fact');
    row.appendChild(el('div', 'lab', label));
    var val = el('div', 'val');
    if (typeof value === 'string') val.appendChild(document.createTextNode(value));
    else val.appendChild(value);
    if (hint) val.appendChild(el('span', 'hint', hint));
    row.appendChild(val);
    return row;
  }

  function renderFacts(r) {
    var f = $('facts');
    f.textContent = '';
    f.appendChild(fact('Address', mono(r.address)));
    if (r.kind !== 'contract') {
      f.appendChild(fact('Read at block', r.block.toLocaleString('en-US')));
      return;
    }
    f.appendChild(fact('Code', r.codeSize.toLocaleString('en-US') + ' bytes', 'hash ' + r.codehash));
    if (r.proxy) {
      f.appendChild(fact('Proxy', patternName(r.proxy.pattern), r.proxy.beacon ? 'beacon ' + r.proxy.beacon : undefined));
      if (r.proxy.implementation) {
        f.appendChild(fact('Implementation', mono(r.proxy.implementation),
          r.proxy.implementationCodehash ? 'code hash ' + r.proxy.implementationCodehash : 'no code at this address'));
      }
    } else {
      f.appendChild(fact('Proxy', 'None found', 'Checked the EIP-1967 implementation, admin and beacon slots and the older ZeppelinOS slots.'));
    }
    if (r.upgradeAuthority) {
      var h = r.upgradeAuthority.holder;
      f.appendChild(fact('Can upgrade', mono(h.address), holderPhrase(h) + ', from ' + r.upgradeAuthority.source + '. ' + holderHint(h)));
    }
    if (r.owner) {
      f.appendChild(fact('owner()', mono(r.owner.address), holderPhrase(r.owner) + '. ' + holderHint(r.owner)));
    } else {
      f.appendChild(fact('owner()', 'No answer', 'Either there is no owner() function or it reverted.'));
    }
    f.appendChild(fact('Read at block', r.block.toLocaleString('en-US'), 'Every value above comes from this one block.'));
  }

  // --- the onchain record -------------------------------------------------------------------------

  var FIELD_NAMES = {
    implementation: 'Implementation',
    admin: 'Upgrade authority',
    owner: 'owner()',
    codehash: 'Code at the address',
    implementationCodehash: 'Implementation code'
  };

  function renderSnapshot() {
    var section = $('snapshot');
    if (!current || current.kind !== 'contract') { section.hidden = true; return; }
    section.hidden = false;

    var summary = $('snap-summary'), list = $('changes'), btn = $('record');
    list.hidden = true;
    list.textContent = '';

    if (!D.log) {
      $('snap-note').textContent = 'The log contract is not deployed yet. The checker above works; recording opens once it is live.';
      summary.textContent = 'Recording is not open yet.';
      btn.hidden = true;
      return;
    }

    btn.hidden = false;
    $('snap-note').textContent = 'Anyone can pin a reading to ContractCheckLog at ' + D.log +
      '. Code hashes are checked by the contract itself; the addresses are what your browser read at block ' +
      current.block.toLocaleString('en-US') + '.';

    if (!stored) { summary.textContent = 'Loading the last record…'; return; }

    summary.textContent = '';
    if (!stored.count) {
      summary.appendChild(document.createTextNode('Nobody has recorded this contract yet.'));
      return;
    }
    var s = stored.latest;
    var when = new Date(s.recordedAt * 1000);
    summary.appendChild(document.createTextNode(
      'Record ' + stored.count + ' of ' + stored.count + ', made at block ' + s.recordedAtBlock.toLocaleString('en-US') +
      ' (' + when.toLocaleString() + ') by '));
    summary.appendChild(mono(short(s.reporter)));
    summary.appendChild(document.createTextNode('. '));

    var changes = C.compareSnapshot(s, current);
    if (!changes.length) {
      summary.appendChild(el('strong', null, 'Nothing has changed since.'));
      return;
    }
    summary.appendChild(el('strong', null, changes.length === 1 ? 'One thing has changed since:' : changes.length + ' things have changed since:'));
    changes.forEach(function (c) {
      var li = el('li');
      li.appendChild(el('strong', null, FIELD_NAMES[c.field] + ': '));
      li.appendChild(el('span', 'was mono', c.was));
      li.appendChild(document.createTextNode(' → '));
      li.appendChild(mono(c.now));
      list.appendChild(li);
    });
    list.hidden = false;
  }

  function loadSnapshot() {
    stored = null;
    renderSnapshot();
    if (!D.log || !current || current.kind !== 'contract') return;
    var forAddress = current.address;
    C.readLatestSnapshot(rpc, D.log, forAddress).then(function (s) {
      if (!current || current.address !== forAddress) return;
      stored = s;
      renderSnapshot();
    }, function (e) {
      $('snap-summary').textContent = 'Could not read the log: ' + e.message;
    });
  }

  function status(cls, text) {
    var s = $('rec-status');
    s.hidden = false;
    s.className = 'status' + (cls ? ' ' + cls : '');
    s.textContent = text;
  }

  function record() {
    if (!current || !D.log) return;
    var report = current, btn = $('record');
    btn.disabled = true;
    status('', 'Re-reading the contract at the latest block before you sign…');

    // Read again right before signing so the snapshot is as fresh as the transaction.
    rpc('eth_blockNumber', []).then(function (b) {
      return C.inspect(rpc, report.address, BigInt(b));
    }).then(function (fresh) {
      current = fresh;
      renderVerdict(fresh);
      renderFacts(fresh);
      status('', 'Confirm the transaction in your wallet. It calls record() and costs a fraction of a cent in USDC.');
      return W.send({ to: D.log, data: C.encodeRecord(fresh) });
    }).then(function (hash) {
      status('', 'Sent: ' + hash + '. Waiting for it to land…');
      return W.waitForReceipt(hash, function (s) { status('', 'Sent: ' + hash + '. Waiting ' + s + 's…'); });
    }).then(function (rc) {
      if (rc.status !== '0x1') throw new Error('The transaction reverted. Hash ' + rc.transactionHash);
      status('ok', 'Recorded in block ' + parseInt(rc.blockNumber, 16).toLocaleString('en-US') + '. Transaction ' + rc.transactionHash);
      loadSnapshot();
    }).catch(function (e) {
      status('bad', W.describeError(e));
    }).then(function () {
      btn.disabled = false;
    });
  }

  // --- checking an address -------------------------------------------------------------------------

  function showError(text) {
    $('err').textContent = text;
    $('err').hidden = false;
  }

  function check(address) {
    $('err').hidden = true;
    $('rec-status').hidden = true;
    address = (address || '').trim();
    if (!C.isAddress(address)) {
      showError('That does not look like an address: 0x followed by 40 hex characters.');
      return;
    }
    var btn = $('check');
    btn.disabled = true;
    btn.textContent = 'Reading…';
    try { history.replaceState(null, '', '?address=' + address.toLowerCase()); } catch (e) { /* file:// */ }

    rpc('eth_blockNumber', []).then(function (b) {
      return C.inspect(rpc, address, BigInt(b));
    }).then(function (r) {
      current = r;
      renderVerdict(r);
      renderFacts(r);
      $('report').hidden = false;
      loadSnapshot();
    }).catch(function (e) {
      showError('Could not read Arc: ' + e.message);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Check';
    });
  }

  // --- wiring ---------------------------------------------------------------------------------------

  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    check($('addr').value);
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-sample]'), function (b) {
    b.addEventListener('click', function () {
      $('addr').value = b.getAttribute('data-sample');
      check(b.getAttribute('data-sample'));
    });
  });

  if (D.log) {
    var s = $('sample-log');
    s.hidden = false;
    s.addEventListener('click', function () { $('addr').value = D.log; check(D.log); });
    $('foot-log').textContent = D.log;
  }

  $('record').addEventListener('click', record);

  // The network stamp doubles as a liveness check on the RPC.
  function heartbeat() {
    rpc('eth_chainId', []).then(function (id) {
      if (parseInt(id, 16) !== D.chainId) {
        setStamp('dead', 'The RPC answered with chain ' + parseInt(id, 16) + ', not Arc mainnet.');
        return;
      }
      return rpc('eth_blockNumber', []).then(function (b) {
        setStamp('', 'Arc mainnet · chain ' + D.chainId + ' · block ' + parseInt(b, 16).toLocaleString('en-US'));
      });
    }).catch(function (e) {
      setStamp('dead', 'Cannot reach the Arc RPC: ' + e.message);
    });
  }
  heartbeat();
  setInterval(heartbeat, 15000);

  var fromUrl = new URLSearchParams(location.search).get('address');
  if (fromUrl && C.isAddress(fromUrl)) {
    $('addr').value = fromUrl;
    check(fromUrl);
  }
})();
