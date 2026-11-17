import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AbiCoder } from 'ethers';
import { root } from './compile.mjs';
import { loadDeployment, network, safeError } from './network.mjs';

export function selectVerificationInput(standardInput, contractName, address, chainId = network.chainId) {
  const input = structuredClone(standardInput);
  const historicalAddress = '0x6bfcF1343F7c1631cb5aD61513ae07Ab09f2F1ea';
  if (contractName !== 'DemoUSD' || chainId !== 46630 || address.toLowerCase() !== historicalAddress.toLowerCase()) {
    return { input };
  }

  // Verification must use the constructor source that produced this immutable
  // address. Keep the current resolved dependency sources and compiler settings.
  input.sources['src/DemoUSD.sol'] = {
    content: fs.readFileSync(path.join(root, 'deployments', 'historical', 'latqor-demo-usd', 'DemoUSD.sol'), 'utf8')
  };
  return {
    input,
    historicalSourceSnapshot: {
      contract: 'DemoUSD',
      address: historicalAddress,
      immutableOnchainName: 'LATQOR Demo USD',
      sourcePath: 'contracts/deployments/historical/latqor-demo-usd/DemoUSD.sol',
      manifestPath: 'contracts/deployments/historical/latqor-demo-usd/manifest.json',
      explorerResponsePath: 'output/latqor-contract-details.json',
      note: 'Historical source for the existing address. contracts/src/DemoUSD.sol uses Leverix Demo USD only for a future deployment.'
    }
  };
}

async function main() {
  const deployment = loadDeployment();
  const standardInput = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'standard-input.json'), 'utf8'));
  const api = `${network.explorerUrl}/api`;
  const reports = [];
  let historicalSourceSnapshot;
  for (const [key, name, types] of [['demoUSD', 'DemoUSD', []], ['indexPerpSandbox', 'IndexPerpSandbox', ['address', 'address']]]) {
    const record = deployment.contracts[key];
    const selectedSource = selectVerificationInput(standardInput, name, record.address);
    if (selectedSource.historicalSourceSnapshot) historicalSourceSnapshot = selectedSource.historicalSourceSnapshot;
    const body = new URLSearchParams({ module: 'contract', action: 'verifysourcecode',
      contractaddress: record.address, sourceCode: JSON.stringify(selectedSource.input),
      codeformat: 'solidity-standard-json-input', contractname: `src/${name}.sol:${name}`,
      compilerversion: 'v0.8.28+commit.7893614a', optimizationUsed: '1', runs: '200',
      evmversion: 'paris', licenseType: '3',
      constructorArguements: types.length ? AbiCoder.defaultAbiCoder().encode(types, record.constructorArguments).slice(2) : ''
    });
    const response = await fetch(api, { method: 'POST', body, signal: AbortSignal.timeout(30_000) });
    let submission;
    try { submission = await response.json(); } catch { submission = { error: `HTTP ${response.status}` }; }
    let status = submission;
    if (submission.status === '1' && !String(submission.result).toLowerCase().includes('verified')) {
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2_000));
        const check = new URLSearchParams({ module: 'contract', action: 'checkverifystatus', guid: submission.result });
        const result = await fetch(`${api}?${check}`, { signal: AbortSignal.timeout(30_000) });
        status = await result.json();
        if (!/pending|queue/i.test(String(status.result))) break;
      }
    }
    const detailsResponse = await fetch(`${network.explorerUrl}/api/v2/smart-contracts/${record.address}`, { signal: AbortSignal.timeout(30_000) });
    const details = detailsResponse.ok ? await detailsResponse.json() : {};
    const report = { contract: name, address: record.address, submission, status,
      sourceVerified: Boolean(details.is_verified || details.is_fully_verified),
      explorerUrl: `${network.explorerUrl}/address/${record.address}?tab=contract` };
    reports.push(report); console.log(JSON.stringify(report));
  }
  const filename = path.join(root, 'deployments', 'source-verification.json');
  fs.writeFileSync(filename, JSON.stringify({
    checkedAt: new Date().toISOString(),
    chainId: network.chainId,
    ...(historicalSourceSnapshot ? { historicalSourceSnapshot } : {}),
    reports
  }, null, 2));
  if (reports.some(report => !report.sourceVerified)) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(safeError);
}
