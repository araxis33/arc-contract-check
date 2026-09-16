// Talking to the visitor's own wallet (EIP-1193). Signing happens there; this page never
// sees a key. Receipts are polled from the public RPC so a slow wallet UI cannot stall them.
(function () {
  'use strict';

  var D = window.ARC_CHECK_DEPLOYMENT;
  var CHAIN_HEX = '0x' + D.chainId.toString(16);

  function provider() {
    if (!window.ethereum) {
      throw new Error('No browser wallet found. Install one (Rabby, MetaMask, Coinbase Wallet) and reload.');
    }
    return window.ethereum;
  }

  function publicRpc(method, params) {
    return fetch(D.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params || [] })
    }).then(function (r) {
      if (!r.ok) throw new Error('Arc RPC returned ' + r.status);
      return r.json();
    }).then(function (j) {
      if (j.error) throw new Error(j.error.message || 'RPC error');
      return j.result;
    });
  }

  function ensureArc(eth) {
    return eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] }).catch(function (e) {
      // 4902: the wallet has never heard of this chain. Offer it, then switch.
      var unknown = e && (e.code === 4902 || (e.data && e.data.originalError && e.data.originalError.code === 4902) ||
        /unrecognized|not added|unknown chain/i.test(e.message || ''));
      if (!unknown) throw e;
      return eth.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: CHAIN_HEX,
          chainName: 'Arc',
          nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
          rpcUrls: [D.rpc]
        }]
      }).then(function () {
        return eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
      });
    });
  }

  function connect() {
    var eth = provider();
    return eth.request({ method: 'eth_requestAccounts' }).then(function (accounts) {
      if (!accounts || !accounts.length) throw new Error('The wallet returned no account.');
      return ensureArc(eth).then(function () {
        return eth.request({ method: 'eth_chainId' });
      }).then(function (chainId) {
        if (parseInt(chainId, 16) !== D.chainId) {
          throw new Error('The wallet is still on chain ' + parseInt(chainId, 16) + ', not Arc (' + D.chainId + ').');
        }
        return accounts[0];
      });
    });
  }

  // Some wallets (Rabby on launch day, for one) refuse to build a transaction on a chain they
  // cannot simulate, reporting it as a rejection. Handing them gas, value and chain explicitly
  // is enough. Gas comes from the public RPC with a 25% margin.
  function send(tx) {
    return connect().then(function (from) {
      tx.from = from;
      tx.value = tx.value || '0x0';
      tx.chainId = CHAIN_HEX;
      if (tx.gas) return tx;
      return publicRpc('eth_estimateGas', [{ from: from, to: tx.to, data: tx.data, value: tx.value }]).then(function (g) {
        tx.gas = '0x' + (BigInt(g) * 125n / 100n).toString(16);
        return tx;
      });
    }).then(function (ready) {
      return provider().request({ method: 'eth_sendTransaction', params: [ready] });
    });
  }

  function waitForReceipt(hash, onTick) {
    var started = Date.now();
    return new Promise(function (resolve, reject) {
      (function poll() {
        publicRpc('eth_getTransactionReceipt', [hash]).then(function (rc) {
          if (rc) return resolve(rc);
          if (Date.now() - started > 120000) return reject(new Error('No receipt after two minutes. The transaction may still land; hash ' + hash));
          if (onTick) onTick(Math.round((Date.now() - started) / 1000));
          setTimeout(poll, 1000);
        }, function () { setTimeout(poll, 2000); });
      })();
    });
  }

  function describeError(e) {
    if (!e) return 'Unknown error.';
    if (e.code === 4001) return 'Cancelled in the wallet.';
    return e.message || String(e);
  }

  window.ArcWallet = { connect: connect, send: send, waitForReceipt: waitForReceipt, publicRpc: publicRpc, describeError: describeError };
})();
