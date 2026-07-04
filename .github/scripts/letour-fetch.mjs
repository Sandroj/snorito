// Haalt per etappe de klassementsfragmenten op van letour.fr (geen Cloudflare,
// kale fetch volstaat) en levert ze af bij Snorito's /api/cron/letour-html.
// Draait in GitHub Actions; env: APP_URL, CRON_SECRET, PENDING (JSON-uitvoer
// van /api/cron/pcs-pending).
const APP_URL = process.env.APP_URL.replace(/\/$/, '');
const SECRET = process.env.CRON_SECRET;
const BASE = 'https://www.letour.fr';
const { stages } = JSON.parse(process.env.PENDING);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en',
};

const deliver = (body) =>
  fetch(`${APP_URL}/api/cron/letour-html`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(body),
  });

async function fetchText(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} op ${url}`);
  return res.text();
}

// De etappepagina bevat per klassement een AJAX-URL (in data-ajax-stack en
// data-tabs-ajax, deels HTML-escaped). We pakken per type de eerste.
function extractAjaxUrls(pageHtml, stageNr) {
  const unescaped = pageHtml.replaceAll('&quot;', '"').replaceAll('\\/', '/');
  const urls = {};
  const re = new RegExp(`/en/ajax/ranking/${stageNr}/([a-z]{3})/[a-f0-9]+/(?:none|subtab)`, 'g');
  for (const m of unescaped.matchAll(re)) {
    if (!(m[1] in urls)) urls[m[1]] = m[0];
  }
  return urls;
}

let failures = 0;
for (const s of stages) {
  try {
    const page = await fetchText(`${BASE}/en/rankings/stage-${s.nr}`);
    const urls = extractAjaxUrls(page, s.nr);
    const wanted = s.type === 'TTT' ? ['ete', 'itg', 'ipg', 'img', 'ijg'] : ['ite', 'itg', 'ipg', 'img', 'ijg'];
    const fragments = {};
    for (const type of wanted) {
      if (urls[type]) fragments[type] = await fetchText(`${BASE}${urls[type]}`);
    }
    console.log(`etappe ${s.nr}: fragmenten opgehaald: ${Object.keys(fragments).join(', ') || 'geen'}`);
    const res = await deliver({ stageNr: s.nr, fragments });
    console.log(`etappe ${s.nr}: ${res.status} —`, await res.text());
    if (!res.ok) failures++;
  } catch (e) {
    failures++;
    console.error(`etappe ${s.nr}: FOUT — ${e.message}`);
    await deliver({ stageNr: s.nr, error: `letour.fr ophalen mislukt in Action: ${e.message}` }).catch(() => {});
  }
}

process.exit(failures ? 1 : 0);
