// Devpost gallery (3:2, 1500x1000 or larger) and a 1280x720 YouTube thumbnail, made only from the real UI:
// a fresh Playwright capture of the seeded Money Desk, plus crops of frames of a rendered demo video.
// Usage: node scripts/devpost-media.js --video out/money-desk-final-mock.mp4 --url http://127.0.0.1:4189 --out ../docs/devpost
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { parseArgs } from './common.js';

const args = parseArgs();
const video = path.resolve(args.video || 'out/money-desk-final-mock.mp4');
const outDir = path.resolve(args.out || '../docs/devpost');
const baseUrl = String(args.url || 'http://127.0.0.1:4189');
const CONTENT_HEIGHT = 940; // composed frames are 1920x1080 with a 140 px caption band at the bottom; crops stay above it
fs.mkdirSync(outDir, { recursive: true });

const ffmpeg = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: 'inherit' });
const frame = (seconds, filter, file) => ffmpeg('-ss', String(seconds), '-i', video, '-frames:v', '1', '-vf', filter, path.join(outDir, file));

// Crop a 3:2 window (1410x940) from the UI area of a frame, scaled to 1500x1000.
const crop32 = (x) => `crop=1410:${CONTENT_HEIGHT}:${x}:0,scale=1500:1000:flags=lanczos`;
// Whole UI area (1920x940) fitted to 1500 wide at the top; the remaining strip is a blurred, stretched copy of the
// same frame (the voice simulator's dark gradient), so no flat bar or seam is visible.
const fit32 = () => `crop=1920:${CONTENT_HEIGHT}:0:0,split[a][b];[a]scale=1500:1000,boxblur=40:2[bg];[b]scale=1500:-2:flags=lanczos[fg];[bg][fg]overlay=0:0`;

async function captureMoneyDesk(file) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1280 }, deviceScaleFactor: 1 });
    await page.goto(new URL('/money-desk.html', baseUrl).href, { waitUntil: 'load' });
    await page.locator('#myStudio .tw-refund-rate').waitFor({ timeout: 30000 });
    await page.locator('#myStudio .ag-studio-layout-canvas .ag-studio-layout-widget >> nth=6').waitFor({ timeout: 30000 });
    await page.waitForTimeout(2500); // chart entry animations
    await page.screenshot({ path: path.join(outDir, file) });
  } finally {
    await browser.close();
  }
}

const times = { confirm: Number(args.confirmAt || 66), hood: Number(args.hoodAt || 86), drill: Number(args.drillAt || 132) };

await captureMoneyDesk('01-money-desk.png');
frame(times.confirm, fit32(), '02-voice-refund-confirmation.png');
frame(times.hood, fit32(), '03-under-the-hood.png');
frame(times.drill, crop32(0), '04-why-are-refunds-spiking.png');
frame(times.drill, crop32(450), '05-refunds-per-day-by-reason.png');
// Thumbnail: the top 16:9 of the fresh Money Desk capture (title, refund-spike tile, every seeded widget).
ffmpeg('-i', path.join(outDir, '01-money-desk.png'), '-vf', 'crop=1920:1080:0:0,scale=1280:720:flags=lanczos', path.join(outDir, 'youtube-thumbnail.png'));
console.log(`Wrote Devpost media to ${outDir}`);
