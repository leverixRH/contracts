import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, encodeBytes32String } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { marketDefinitions } from '../scripts/markets.mjs';

const USD = 10n ** 6n;
const PRICE = 10n ** 8n;
const ID = encodeBytes32String('DAX');
let artifacts, rpc, provider, owner, alice, bob;
before(async () => {
  artifacts = compile();
  rpc = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' },
    wallet: { totalAccounts: 5 }, miner: { blockGasLimit: 30_000_000 } });
  provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  owner = await provider.getSigner(0); alice = await provider.getSigner(1); bob = await provider.getSigner(2);
});
after(async () => { provider?.destroy(); await rpc?.disconnect(); });

async function reject(call) { await assert.rejects(async () => { const tx = await call; await tx.wait(); }); }
async function mined(call) { return (await call).wait(); }
async function fixture({ fund = true } = {}) {
  const token = await new ContractFactory(artifacts.DemoUSD.abi, artifacts.DemoUSD.bytecode, owner).deploy();
  await token.waitForDeployment();
  const engine = await new ContractFactory(artifacts.IndexPerpSandbox.abi, artifacts.IndexPerpSandbox.bytecode, owner)
    .deploy(await token.getAddress(), await owner.getAddress());
  await engine.waitForDeployment();
  const address = await engine.getAddress();
  if (fund) {
    await mined(token.approve(address, 100_000n * USD));
    await mined(engine.fundLiquidity(100_000n * USD));
  }
  await mined(engine.setDemoPrice(ID, 5_000n * PRICE));
  await mined(token.connect(alice).faucet());
  await mined(token.connect(alice).approve(address, 10_000n * USD));
  await mined(engine.connect(alice).deposit(1_000n * USD));
  return { token, engine, trader: engine.connect(alice), address, aliceAddress: await alice.getAddress() };
}
async function solvent(token, engine) {
  assert.equal(await token.balanceOf(await engine.getAddress()), await engine.accountedCollateral());
}
async function open(trader, isLong = true, leverage = 2) {
  await mined(trader.openPosition(ID, isLong, 100n * USD, leverage, 5_000n * PRICE, 0));
}

test('faucet enforces 24h cooldown; token is 6-decimal dUSD', async () => {
  const { token } = await fixture();
  assert.equal(await token.decimals(), 6n);
  assert.equal(await token.symbol(), 'dUSD');
  await reject(token.connect(alice).faucet());
  await rpc.request({ method: 'evm_increaseTime', params: [86_401] });
  await rpc.request({ method: 'evm_mine', params: [] });
  await mined(token.connect(alice).faucet({ gasLimit: 100_000 }));
});

test('full long cycle settles profit, conserves reserves, and withdraws exact funds', async () => {
  const { token, engine, trader, aliceAddress } = await fixture();
  await open(trader);
  assert.equal(await engine.balances(aliceAddress), 900n * USD);
  assert.equal(await engine.lockedCollateral(aliceAddress), 100n * USD);
  assert.equal(await engine.reservedLiquidity(), 100n * USD);
  await mined(engine.setDemoPrice(ID, 5_250n * PRICE));
  assert.equal((await engine.previewPnl(1)).pnl, 10n * USD);
  await mined(trader.closePosition(1, 5_250n * PRICE, 0));
  assert.equal(await engine.balances(aliceAddress), 1_010n * USD);
  assert.equal(await engine.reservedLiquidity(), 0n);
  assert.equal(await engine.freeLiquidity(), 99_990n * USD);
  await solvent(token, engine);
  await mined(trader.withdraw(1_010n * USD));
  assert.equal(await token.balanceOf(aliceAddress), 10_010n * USD);
  assert.equal(await engine.totalUserCollateral(), 0n);
  await solvent(token, engine);
});

test('short position profits when demo index falls', async () => {
  const { token, engine, trader, aliceAddress } = await fixture();
  await open(trader, false, 3);
  await mined(engine.setDemoPrice(ID, 4_500n * PRICE));
  await mined(trader.closePosition(1, 4_500n * PRICE, 0));
  assert.equal(await engine.balances(aliceAddress), 1_030n * USD);
  await solvent(token, engine);
});

test('max profit is initial margin and cannot drain other traders collateral', async () => {
  const { token, engine, trader, aliceAddress } = await fixture();
  await open(trader, true, 5);
  await mined(engine.setDemoPrice(ID, 15_000n * PRICE));
  assert.equal((await engine.previewPnl(1)).payout, 200n * USD);
  await mined(trader.closePosition(1, 15_000n * PRICE, 0));
  assert.equal(await engine.balances(aliceAddress), 1_100n * USD);
  await solvent(token, engine);
});

test('liquidation threshold and full-loss cap preserve solvency', async () => {
  const { token, engine, trader, aliceAddress } = await fixture();
  await open(trader, true, 5);
  await reject(engine.connect(bob).liquidate(1));
  await mined(engine.setDemoPrice(ID, 1_000n * PRICE));
  await mined(engine.connect(bob).liquidate(1));
  assert.equal(await engine.balances(aliceAddress), 900n * USD);
  assert.equal((await engine.positions(1)).isOpen, false);
  assert.equal(await engine.freeLiquidity(), 100_100n * USD);
  await solvent(token, engine);
});

test('stale demo prices prevent open, close and liquidation, but not withdrawal', async () => {
  const { token, engine, trader } = await fixture();
  await open(trader);
  await rpc.request({ method: 'evm_increaseTime', params: [901] });
  await rpc.request({ method: 'evm_mine', params: [] });
  assert.equal((await engine.previewPnl(1)).priceFresh, false);
  await reject(trader.openPosition(ID, true, 100n * USD, 2, 5_000n * PRICE, 0));
  await reject(trader.closePosition(1, 5_000n * PRICE, 0));
  await reject(engine.liquidate(1));
  await mined(trader.withdraw(900n * USD));
  await solvent(token, engine);
});

test('slippage guard, leverage bounds, margin bounds and trader ownership', async () => {
  const { engine, trader } = await fixture();
  await reject(trader.openPosition(ID, true, 100n * USD, 21, 5_000n * PRICE, 0));
  await reject(trader.openPosition(ID, true, 0, 2, 5_000n * PRICE, 0));
  await reject(trader.openPosition(ID, true, 100n * USD, 2, 4_000n * PRICE, 50));
  await reject(trader.openPosition(ID, true, 100n * USD, 2, 5_000n * PRICE, 501));
  await open(trader);
  await reject(engine.connect(bob).closePosition(1, 5_000n * PRICE, 0));
  await mined(trader.closePosition(1, 5_000n * PRICE, 0));
  await reject(trader.closePosition(1, 5_000n * PRICE, 0));
});

test('pause blocks new exposure but allows closing and withdrawing', async () => {
  const { token, engine, trader, aliceAddress } = await fixture();
  await open(trader);
  await mined(engine.setPaused(true));
  await reject(trader.deposit(100n * USD));
  await reject(trader.openPosition(ID, true, 100n * USD, 2, 5_000n * PRICE, 0));
  await mined(trader.closePosition(1, 5_000n * PRICE, 0));
  await mined(trader.withdraw(1_000n * USD));
  assert.equal(await engine.balances(aliceAddress), 0n);
  await solvent(token, engine);
});

test('only owner updates demo prices, disabling a market keeps exits open', async () => {
  const { engine, trader } = await fixture();
  await reject(trader.setDemoPrice(ID, 7_000n * PRICE));
  await reject(engine.setDemoPrice(ID, 0));
  await open(trader);
  await mined(engine.setMarketEnabled(ID, false));
  await reject(trader.openPosition(ID, true, 100n * USD, 2, 5_000n * PRICE, 0));
  await mined(trader.closePosition(1, 5_000n * PRICE, 0));
  assert.deepEqual(Array.from(await engine.getPositionIds(await alice.getAddress())), [1n]);
});

test('underfunded reserve rejects exposure and users cannot withdraw locked margin', async () => {
  const { engine, trader } = await fixture({ fund: false });
  await reject(trader.openPosition(ID, true, 100n * USD, 2, 5_000n * PRICE, 0));
  await reject(trader.withdraw(1_001n * USD));
  assert.equal(await engine.reservedLiquidity(), 0n);
});

test('24h oracle outage permits trader-only zero-PnL cancellation and withdrawal', async () => {
  const { token, engine, trader, aliceAddress } = await fixture();
  await open(trader);
  await reject(trader.cancelStalePosition(1));
  await rpc.request({ method: 'evm_increaseTime', params: [86_401] });
  await rpc.request({ method: 'evm_mine', params: [] });
  await reject(engine.connect(bob).cancelStalePosition(1));
  await mined(trader.cancelStalePosition(1, { gasLimit: 300_000 }));
  assert.equal(await engine.balances(aliceAddress), 1_000n * USD);
  assert.equal(await engine.reservedLiquidity(), 0n);
  await mined(trader.withdraw(1_000n * USD));
  await solvent(token, engine);
});

test('20x leverage is accepted and 5% index movement caps profit to initial margin', async () => {
  const { token, engine, trader, aliceAddress } = await fixture();
  assert.equal(await engine.MAX_LEVERAGE(), 20n);
  await open(trader, true, 20);
  await mined(engine.setDemoPrice(ID, 5_250n * PRICE));
  assert.equal((await engine.previewPnl(1)).pnl, 100n * USD);
  await mined(trader.closePosition(1, 5_250n * PRICE, 0));
  assert.equal(await engine.balances(aliceAddress), 1_100n * USD);
  await solvent(token, engine);
});

test('32 benchmark batch initializes all markets and enforces atomic bounds and owner access', async () => {
  const { engine, trader } = await fixture();
  const ids = marketDefinitions.map(m => m.id);
  const prices = marketDefinitions.map(m => m.price);
  await reject(trader.setDemoPrices(ids, prices));
  await reject(engine.setDemoPrices([], []));
  await reject(engine.setDemoPrices(ids, prices.slice(1)));
  await reject(engine.setDemoPrices(Array(65).fill(ID), Array(65).fill(5_000n * PRICE)));
  await mined(engine.setDemoPrices(ids, prices));
  for (const market of marketDefinitions) {
    const stored = await engine.markets(market.id);
    assert.equal(stored.price, BigInt(market.price));
    assert.equal(stored.enabled, true);
  }
  const firstPrice = (await engine.markets(ids[0])).price;
  await reject(engine.setDemoPrices([ids[0], ids[1]], [firstPrice + PRICE, 0]));
  assert.equal((await engine.markets(ids[0])).price, firstPrice);
});
