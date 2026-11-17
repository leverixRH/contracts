import fs from 'node:fs';
import path from 'node:path';
import { root } from './compile.mjs';
import { marketDefinitions } from './markets.mjs';

const source = 'https://www.perpdex.lat/';
const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`Reference returned HTTP ${response.status}`);
const html = await response.text();
let indices;
for (const match of html.matchAll(/self\.__next_f\.push\((.*?)\)<\/script>/gs)) {
  let chunk;
  try { chunk = JSON.parse(match[1]); } catch { continue; }
  if (typeof chunk[1] !== 'string') continue;
  const found = chunk[1].match(/"indices":(\[[^\]]+\])/);
  if (found) { indices = JSON.parse(found[1]); break; }
}
if (!indices) throw new Error('Reference market payload not found; layout may have changed.');
const referenceSymbols = indices.map(m => m.symbol).sort();
const configuredSymbols = marketDefinitions.map(m => m.symbol).sort();
const matches = JSON.stringify(referenceSymbols) === JSON.stringify(configuredSymbols);
const report = { checkedAt: new Date().toISOString(), source, referenceCount: indices.length,
  configuredCount: marketDefinitions.length, exactSymbolMatch: matches,
  markets: indices.map(m => ({ symbol: m.symbol, label: m.name, country: m.country })) };
fs.writeFileSync(path.join(root, 'config', 'reference-check.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ referenceCount: indices.length, configuredCount: marketDefinitions.length, exactSymbolMatch: matches }));
if (!matches) process.exitCode = 1;
