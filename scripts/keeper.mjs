import { refreshDemoPrices } from './refresh-prices.mjs';
import { safeError } from './network.mjs';

// Optional local operator process. It is never automatically launched by deploy or the website.
// Every publication re-checks official testnet chain ID and signer ownership.
const INTERVAL_MS = 5 * 60 * 1_000;
let stopping = false;
let wake;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { stopping = true; wake?.(); });
}

async function main() {
  console.log('Leverix synthetic demo keeper: 32 fixed quotes every 5 minutes, official testnet only. Ctrl+C to stop.');
  let consecutiveFailures = 0;
  while (!stopping) {
    try {
      await refreshDemoPrices();
      consecutiveFailures = 0;
    } catch (error) {
      console.error(`Demo refresh failed: ${error.shortMessage || error.reason || error.message || 'unknown failure'}`);
      consecutiveFailures++;
      if (consecutiveFailures >= 3 || process.argv.includes('--once')) throw new Error('Keeper stopped after refresh failure; inspect testnet gas/RPC/owner settings.');
    }
    if (process.argv.includes('--once') || stopping) break;
    await new Promise(resolve => {
      if (stopping) { resolve(); return; }
      const timer = setTimeout(resolve, INTERVAL_MS);
      wake = () => { clearTimeout(timer); resolve(); };
    });
    wake = undefined;
  }
  console.log('Demo keeper stopped. Onchain freshness expires 15 minutes after the last successful publication.');
}
main().catch(safeError);
