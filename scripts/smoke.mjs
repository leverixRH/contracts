import fs from 'node:fs';
import path from 'node:path';
import { Contract, formatUnits } from 'ethers';
import { root } from './compile.mjs';
import { connect, loadDeployment, artifact, network, safeError } from './network.mjs';

async function main() {
  const deployment = loadDeployment();
  const { provider, signer, address } = await connect({ signing: true });
  const token = new Contract(deployment.addresses.demoUSD, artifact('DemoUSD').abi, signer);
  const engine = new Contract(deployment.addresses.indexPerpSandbox, artifact('IndexPerpSandbox').abi, signer);
  const market = deployment.markets[0];
  const transactions = [];
  async function send(step, tx) {
    const receipt = await (await tx).wait();
    if (receipt.status !== 1) throw new Error(`Smoke failed: ${step}`);
    const event = { step, hash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(),
      explorerUrl: `${network.explorerUrl}/tx/${receipt.hash}` };
    transactions.push(event); console.log(`${step}: ${receipt.hash}`); return receipt;
  }
  const initialWalletBalance = await token.balanceOf(address);
  const initialCollateral = await engine.balances(address);
  const nextFaucetAt = await token.nextFaucetAt(address);
  if (nextFaucetAt <= BigInt(Math.floor(Date.now() / 1000))) await send('Claim 10,000 worthless dUSD', token.faucet());
  const afterFaucet = await token.balanceOf(address);
  const amount = 100n * 10n ** 6n;
  await send(`Refresh ${market.symbol} synthetic DEMO price`, engine.setDemoPrice(market.id, market.price));
  await send('Approve exactly 100 dUSD', token.approve(deployment.addresses.indexPerpSandbox, amount));
  await send('Deposit 100 dUSD', engine.deposit(amount));
  const opened = await send('Open 20x long with 25 dUSD margin', engine.openPosition(market.id, true, 25n * 10n ** 6n, 20, market.price, 0));
  const openedEvent = opened.logs.map(log => {
    try { return engine.interface.parseLog(log); } catch { return null; }
  }).find(event => event?.name === 'PositionOpened' && event.args.trader.toLowerCase() === address.toLowerCase());
  if (!openedEvent) throw new Error('Open transaction did not emit expected PositionOpened event.');
  const positionId = openedEvent.args.id;
  await send('Close at unchanged DEMO price', engine.closePosition(positionId, market.price, 0));
  await send('Withdraw 100 dUSD', engine.withdraw(amount));
  const finalWalletBalance = await token.balanceOf(address);
  const finalCollateral = await engine.balances(address);
  const position = await engine.positions(positionId);
  const tokenBalance = await token.balanceOf(deployment.addresses.indexPerpSandbox);
  const accounted = await engine.accountedCollateral();
  const maxLeverage = await engine.MAX_LEVERAGE();
  const marketStates = await Promise.all(deployment.markets.map(async m => {
    const state = await engine.markets(m.id);
    return { symbol: m.symbol, price: state.price.toString(), enabled: state.enabled };
  }));
  if (finalWalletBalance !== afterFaucet || finalCollateral !== initialCollateral || position.isOpen || tokenBalance < accounted ||
      maxLeverage !== 20n || marketStates.length !== 32 || marketStates.some(m => !m.enabled || m.price === '0')) {
    throw new Error('Smoke invariants failed. Inspect receipts.');
  }
  const result = { checkedAt: new Date().toISOString(), chainId: network.chainId, address, status: 'passed',
    positionId: positionId.toString(), initialWalletDUSD: formatUnits(initialWalletBalance, 6),
    finalWalletDUSD: formatUnits(finalWalletBalance, 6), finalAvailableCollateralDUSD: formatUnits(finalCollateral, 6),
    engineTokenBalanceDUSD: formatUnits(tokenBalance, 6), accountedDUSD: formatUnits(accounted, 6),
    positionClosed: !position.isOpen, maxLeverage: Number(maxLeverage), marketStates, transactions };
  fs.writeFileSync(path.join(root, 'deployments', 'smoke-test.json'), JSON.stringify(result, null, 2));
  console.log('PASS: faucet → approval → deposit → open → close → withdraw; collateral conserved.');
  provider.destroy();
}
main().catch(safeError);
