import fs from 'node:fs';
import path from 'node:path';
import { formatEther } from 'ethers';
import { root } from './compile.mjs';
import { connect, network, safeError } from './network.mjs';

try {
  const { provider, address, balance } = await connect({ signing: true });
  const result = { checkedAt: new Date().toISOString(), ...network, address,
    balanceWei: balance.toString(), balanceETH: formatEther(balance),
    blockNumber: await provider.getBlockNumber(), funded: balance > 0n };
  fs.mkdirSync(path.join(root, 'deployments'), { recursive: true });
  fs.writeFileSync(path.join(root, 'deployments', 'preflight.json'), JSON.stringify(result, null, 2));
  console.log(`Official testnet confirmed. Wallet ${result.funded ? 'has' : 'needs'} gas funds.`);
  provider.destroy();
} catch (error) { safeError(error); }
