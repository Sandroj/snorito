// Haalt PCS-etappepagina's op met een echte browser (Cloudflare-challenge) en
// levert de HTML af bij Snorito's /api/cron/pcs-html. Draait in GitHub Actions;
// env: APP_URL, CRON_SECRET, PENDING (JSON-uitvoer van /api/cron/pcs-pending).
import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL.replace(/\/$/, '');
const SECRET = process.env.CRON_SECRET;
const RACE_PATH = 'race/tour-de-france/2026';
const { stages } = JSON.parse(process.env.PENDING);

const deliver = (body) =>
  fetch(`${APP_URL}/api/cron/pcs-html`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(body),
  });

const browser = await chromium.launch();
const page = await browser.newPage({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 },
});

let failures = 0;
for (const s of stages) {
  const url = `https://www.procyclingstats.com/${RACE_PATH}/stage-${s.nr}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // Wacht een eventuele Cloudflare-challenge uit (max ±45s).
    for (let i = 0; i < 9; i++) {
      const title = await page.title();
      if (!/just a moment|een moment/i.test(title)) break;
      await page.waitForTimeout(5_000);
    }
    const html = await page.content();
    if (/just a moment/i.test(html.slice(0, 2000))) throw new Error('Cloudflare-challenge niet gepasseerd');
    const res = await deliver({ stageNr: s.nr, html });
    console.log(`etappe ${s.nr}: ${res.status} —`, await res.text());
    if (!res.ok) failures++;
  } catch (e) {
    failures++;
    console.error(`etappe ${s.nr}: FOUT — ${e.message}`);
    await deliver({ stageNr: s.nr, error: `PCS ophalen mislukt in Action: ${e.message}` }).catch(() => {});
  }
}

await browser.close();
process.exit(failures ? 1 : 0);
