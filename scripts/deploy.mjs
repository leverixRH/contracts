import fs from 'node:fs';
import path from 'node:path';
import { ContractFactory, formatEther, keccak256 } from 'ethers';
import { compile, root } from './compile.mjs';
import { connect, network, safeError } from './network.mjs';
import { marketDefinitions } from './markets.mjs';

async function main() {
  const directory = path.join(root, 'deployments');
  const filename = path.join(directory, 'robinhood-testnet.json');
  if (fs.existsSync(filename)) {
    const previous = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const archiveFile = path.join(directory, 'v1', 'robinhood-testnet.json');
    const upgrade = process.argv.includes('--upgrade-from-v1') && !previous.version && fs.existsSync(archiveFile);
    if (!upgrade) throw new Error('Deployment already exists; refusing accidental duplicate.');
    const archive = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
    if (archive.addresses.indexPerpSandbox !== previous.addresses.indexPerpSandbox) throw new Error('v1 archive mismatch.');
  }
  const artifacts = compile();
  const { provider, signer, address, balance } = await connect({ signing: true });
  if (balance === 0n) throw new Error(`No testnet ETH at ${address}. Use the official faucet.`);
  const transactions = [];
  const record = async (label, tx) => {
    const receipt = await tx.wait(1);
    if (receipt.status !== 1) throw new Error(`Transaction failed: ${label}`);
    const item = { label, hash: receipt.hash, blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(), gasPrice: receipt.gasPrice.toString(),
      feeETH: formatEther(receipt.fee), explorerUrl: `${network.explorerUrl}/tx/${receipt.hash}` };
    transactions.push(item);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'deployment-progress.json'), JSON.stringify({ chainId: network.chainId, deployer: address, transactions }, null, 2));
    console.log(`${label}: ${receipt.hash}`);
    return receipt;
  };

  const token = await new ContractFactory(artifacts.DemoUSD.abi, artifacts.DemoUSD.bytecode, signer).deploy();
  await record('Deploy Leverix Demo USD', token.deploymentTransaction());
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  const engine = await new ContractFactory(artifacts.IndexPerpSandbox.abi, artifacts.IndexPerpSandbox.bytecode, signer)
    .deploy(tokenAddress, address);
  await record('Deploy index perpetual sandbox', engine.deploymentTransaction());
  await engine.waitForDeployment();
  const engineAddress = await engine.getAddress();
  const seed = 500_000n * 10n ** 6n;
  await record('Approve demo reserve', await token.approve(engineAddress, seed));
  await record('Seed 500,000 dUSD reserve', await engine.fundLiquidity(seed));
  await record('Initialize all 32 synthetic DEMO benchmark prices', await engine.setDemoPrices(
    marketDefinitions.map(m => m.id), marketDefinitions.map(m => m.price)));
  const codes = await Promise.all([provider.getCode(tokenAddress), provider.getCode(engineAddress)]);
  if (codes.some(code => code === '0x')) throw new Error('Post-deploy bytecode missing.');
  const deployment = {
    project: 'Leverix', version: 2, status: 'deployed-testnet', deployedAt: new Date().toISOString(), ...network,
    deployer: address, addresses: { demoUSD: tokenAddress, indexPerpSandbox: engineAddress },
    contracts: {
      demoUSD: { address: tokenAddress, constructorArguments: [], bytecodeHash: keccak256(codes[0]) },
      indexPerpSandbox: { address: engineAddress, constructorArguments: [tokenAddress, address], bytecodeHash: keccak256(codes[1]) }
    },
    markets: marketDefinitions, maxLeverage: 20, seedLiquidityDUSD: '500000',
    limitations: ['Test tokens only; dUSD is not USDG and has no monetary value.',
      'Operator-set synthetic demonstration quotes; not current index prices.',
      '1-20x leverage. Profit and loss capped to initial margin. No funding.',
      'Prices expire after 15 minutes. Operator must run refresh-prices.',
      'After 24h without quotes, trader may cancel position at zero PnL.',
      'Unaudited prototype, no real-money use or Robinhood affiliation.'],
    compiler: artifacts.DemoUSD.compiler, transactions,
    gasBalanceBeforeETH: formatEther(balance), gasBalanceAfterETH: formatEther(await provider.getBalance(address))
  };
  fs.writeFileSync(filename, JSON.stringify(deployment, null, 2));
  const frontend = {
    network, addresses: deployment.addresses,
    abi: { demoUSD: artifacts.DemoUSD.abi, indexPerpSandbox: artifacts.IndexPerpSandbox.abi },
    markets: marketDefinitions, maxLeverage: 20,
    deployment: { version: 2, status: deployment.status, deployedAt: deployment.deployedAt,
      explorerUrls: { demoUSD: `${network.explorerUrl}/address/${tokenAddress}`, indexPerpSandbox: `${network.explorerUrl}/address/${engineAddress}` } }
  };
  fs.writeFileSync(path.join(root, 'frontend.json'), JSON.stringify(frontend, null, 2));
  console.log(JSON.stringify({ status: deployment.status, addresses: deployment.addresses, remainingETH: deployment.gasBalanceAfterETH }));
  provider.destroy();
}
main().catch(safeError);
