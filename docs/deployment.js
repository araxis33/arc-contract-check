// Where the ContractCheckLog lives. Filled in once, right after the deployment transaction
// confirms; until then the page runs the checker and hides the recording controls.
window.ARC_CHECK_DEPLOYMENT = {
  chainId: 5042,
  rpc: 'https://rpc.mainnet.arc.io',
  log: null,          // address of ContractCheckLog on Arc mainnet
  deployTx: null,
  deployBlock: null
};
