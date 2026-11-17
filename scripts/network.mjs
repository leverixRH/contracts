import fs from 'node:fs';
import path from 'node:path';
import { JsonRpcProvider, Wallet, NonceManager, formatEther } from 'ethers';
import { root } from './compile.mjs';

export const network = Object.freeze({
  name: 'Robinhood Chain Testnet', chainId: 46630, chainIdHex: '0xb626',
  rpcUrl: 'https://rpc.testnet.chain.robinhood.com',
  explorerUrl: 'https://explorer.testnet.chain.robinhood.com',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  documentation: 'https://docs.robinhood.com/chain/connecting',
  faucetUrl: 'https://faucet.testnet.chain.robinhood.com'
});

export async function connect({ signing = false } = {}) {
  // Network is deliberately hardcoded: never accept a mainnet or arbitrary RPC override.
  const provider = new JsonRpcProvider(network.rpcUrl);
  const actualId = Number(BigInt(await provider.send('eth_chainId', [])));
  if (actualId !== network.chainId) throw new Error('Refusing network: expected official Robinhood testnet 46630.');
  if (!signing) return { provider };
  const keyPath = process.env.TESTNET_KEY_FILE || path.join(root, '..', 'key.txt');
  let secret;
  try { secret = fs.readFileSync(keyPath, 'utf8').replace(/^\uFEFF/, '').trim(); }
  catch { throw new Error('Cannot read testnet key file. Set TESTNET_KEY_FILE to a local private file.'); }
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(secret)) throw new Error('Testnet key file must contain exactly one 32-byte hex key.');
  const wallet = new Wallet(secret.startsWith('0x') ? secret : `0x${secret}`, provider);
  secret = undefined;
  const signer = new NonceManager(wallet);
  const balance = await provider.getBalance(wallet.address);
  console.log(JSON.stringify({ network: network.name, chainId: actualId, address: wallet.address, gasBalanceETH: formatEther(balance) }));
  return { provider, signer, address: wallet.address, balance };
}

export function loadDeployment() {
  const filename = path.join(root, 'deployments', 'robinhood-testnet.json');
  if (!fs.existsSync(filename)) throw new Error('No testnet deployment file. Run npm run deploy first.');
  const deployment = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (deployment.chainId !== network.chainId) throw new Error('Deployment chain mismatch.');
  return deployment;
}

export function artifact(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'artifacts', `${name}.json`), 'utf8'));
}

export function safeError(error) {
  // Do not stringify RPC request objects or signer internals: keep secret material out of logs.
  console.error(`Operation failed: ${error.shortMessage || error.reason || error.message || 'unknown error'}`);
  process.exitCode = 1;
}
