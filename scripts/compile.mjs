import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function compile() {
  const sources = Object.fromEntries(['DemoUSD.sol', 'IndexPerpSandbox.sol'].map(name =>
    [`src/${name}`, { content: fs.readFileSync(path.join(root, 'src', name), 'utf8') }]));
  const input = { language: 'Solidity', sources, settings: {
    optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'metadata'] } }
  } };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: name => {
    try { return { contents: fs.readFileSync(path.join(root, 'node_modules', name), 'utf8') }; }
    catch { return { error: `Import not found: ${name}` }; }
  } }));
  const errors = (output.errors || []).filter(error => error.severity === 'error');
  if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join('\n'));
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  for (const name of ['DemoUSD', 'IndexPerpSandbox']) {
    const contract = output.contracts[`src/${name}.sol`][name];
    fs.writeFileSync(path.join(root, 'artifacts', `${name}.json`), JSON.stringify({
      contractName: name, compiler: solc.version(), abi: contract.abi,
      bytecode: `0x${contract.evm.bytecode.object}`,
      deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
      metadata: JSON.parse(contract.metadata)
    }, null, 2));
  }
  // Fully resolved standard JSON input for public source verification (contains no secrets).
  const resolvedSources = { ...sources };
  for (const sourceName of Object.keys(output.sources)) {
    if (!resolvedSources[sourceName]) resolvedSources[sourceName] = {
      content: fs.readFileSync(path.join(root, 'node_modules', sourceName), 'utf8')
    };
  }
  fs.writeFileSync(path.join(root, 'artifacts', 'standard-input.json'), JSON.stringify({ ...input, sources: resolvedSources }, null, 2));
  return Object.fromEntries(['DemoUSD', 'IndexPerpSandbox'].map(name => [name,
    JSON.parse(fs.readFileSync(path.join(root, 'artifacts', `${name}.json`), 'utf8'))]));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const contracts = compile();
  for (const [name, artifact] of Object.entries(contracts)) {
    console.log(`${name}: compiled with ${artifact.compiler}, ${(artifact.bytecode.length - 2) / 2} deployment bytes`);
  }
}
