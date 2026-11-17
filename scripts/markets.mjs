import fs from 'node:fs';
import path from 'node:path';
import { encodeBytes32String, parseUnits } from 'ethers';
import { root } from './compile.mjs';

export const marketDefinitions = JSON.parse(fs.readFileSync(path.join(root, 'config', 'markets.json'), 'utf8'))
  .map(m => ({ ...m, id: encodeBytes32String(m.symbol), priceDecimals: 8,
    price: parseUnits(m.demoPrice, 8).toString(), priceSource: 'fixed-synthetic-demo' }));

if (marketDefinitions.length !== 32 || new Set(marketDefinitions.map(m => m.id)).size !== 32) {
  throw new Error('Market configuration must contain 32 distinct reference benchmark IDs.');
}
