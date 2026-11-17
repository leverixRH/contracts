import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract } from 'ethers';
import { connect, loadDeployment, artifact, safeError } from './network.mjs';

export async function refreshDemoPrices() {
  const deployment = loadDeployment();
  if (deployment.version !== 2 || deployment.markets.length !== 32) throw new Error('Expected v2 deployment with 32 benchmarks.');
  const { provider, signer, address } = await connect({ signing: true });
  try {
    const engine = new Contract(deployment.addresses.indexPerpSandbox, artifact('IndexPerpSandbox').abi, signer);
    if ((await engine.owner()).toLowerCase() !== address.toLowerCase()) throw new Error('Configured signer is not the demo oracle owner.');
    console.log('Publishing 32 fixed synthetic DEMO quotes; no live index data is fetched.');
    const tx = await engine.setDemoPrices(deployment.markets.map(m => m.id), deployment.markets.map(m => m.price));
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error('Batch demo price update failed.');
    console.log(`32 DEMO quotes refreshed at ${new Date().toISOString()}: ${receipt.hash}`);
    return { hash: receipt.hash, blockNumber: receipt.blockNumber, marketCount: 32 };
  } finally { provider.destroy(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  refreshDemoPrices().catch(safeError);
}
