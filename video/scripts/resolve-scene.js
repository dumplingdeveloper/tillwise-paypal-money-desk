import fs from 'node:fs';
import path from 'node:path';
import { OUT_DIR, ensureDirs, parseArgs, readScene, rel } from './common.js';

// demo-reset.sh recreates the demo orders with new ids, so a scene that names an order uses {{ORDER_ID}}
// and is resolved against the store right before recording: --order <id> → out/<scene>.resolved.json.
const args = parseArgs();
const order = String(args.order || '');
if (!/^\d+$/.test(order)) throw new Error('resolve-scene requires --order <numeric Woo order id>');
const scene = readScene(args.scene);
const source = scene.__path;
delete scene.__path;
const text = JSON.stringify(scene, null, 2);
if (!text.includes('{{ORDER_ID}}')) throw new Error(`${rel(source)} has no {{ORDER_ID}} token`);
ensureDirs();
const out = path.join(OUT_DIR, `${path.basename(source, '.json')}.resolved.json`);
fs.writeFileSync(out, text.replaceAll('{{ORDER_ID}}', order) + '\n');
console.log(rel(out));
