// ProCyclingStats-parser: haalt etappe-uitslag, klassementen en TTT-ploegenuitslag
// van één PCS-etappepagina (alle tabs zitten in dezelfde HTML).
// Geen database-afhankelijkheden — puur fetchen, parsen en namen matchen.
import * as cheerio from 'cheerio';

export const PCS_BASE = 'https://www.procyclingstats.com';
export const RACE_PATH = 'race/tour-de-france/2026';

// 'POGAČAR Tadej' ≡ 'Tadej Pogačar': accenten strippen, alles behalve letters
// als scheiding zien, en woorden gesorteerd vergelijken.
export const normalizeName = (s) => s
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z]+/g, ' ')
  .trim().split(/\s+/).filter(Boolean).sort().join(' ');

// PCS-tabs: <a class="selectResultTab" data-id=…>STAGE|GC|POINTS|KOM|YOUTH</a>
// wijzen naar <div class="resTab" data-id=…>; daarbinnen is div.general de uitslag
// (div.today is een verborgen "vandaag"-subtabel die we overslaan).
function tabContainer($, tabName) {
  let dataId = null;
  $('a.selectResultTab').each((_, el) => {
    if ($(el).text().trim().toUpperCase() === tabName) dataId = $(el).attr('data-id');
  });
  if (!dataId) return null;
  const cont = $(`.resTab[data-id="${dataId}"] .general`).first();
  return cont.length ? cont : null;
}

function parseRiderTable($, container) {
  const rows = [];
  container.find('table').first().find('tbody tr').each((_, tr) => {
    const $tr = $(tr);
    const position = parseInt($tr.children().first().text().trim(), 10);
    const name = $tr.find('a[href^="rider/"]').first().text().trim();
    if (Number.isInteger(position) && position >= 1 && name) rows.push({ position, name });
  });
  return rows;
}

const CLASSIFICATION_TABS = { alg: 'GC', punt: 'POINTS', berg: 'KOM', jong: 'YOUTH' };

// Reguliere etappe: daguitslag + vier klassementen.
export function parseStagePage(html) {
  const $ = cheerio.load(html);
  const stageCont = tabContainer($, 'STAGE');
  const out = { stage: stageCont ? parseRiderTable($, stageCont) : [], classifications: {} };
  for (const [cls, tab] of Object.entries(CLASSIFICATION_TABS)) {
    const cont = tabContainer($, tab);
    out.classifications[cls] = cont ? parseRiderTable($, cont) : [];
  }
  return out;
}

// Ploegentijdrit: de STAGE-tab bevat een <ul class="ttt-results"> met per ploeg een li.
export function parseTttResults(html) {
  const $ = cheerio.load(html);
  const cont = tabContainer($, 'STAGE');
  const rows = [];
  if (!cont) return rows;
  cont.find('ul.ttt-results > li').each((_, li) => {
    const teamName = $(li).find('a[href^="team/"]').first().text().trim();
    if (teamName) rows.push({ position: rows.length + 1, teamName });
  });
  return rows;
}

// Matcht PCS-namen op onze entiteiten ({ name, … }); geeft ook de mislukte namen terug.
export function matchByName(names, entities) {
  const byNorm = new Map(entities.map((e) => [normalizeName(e.name), e]));
  const matched = new Map();
  const unmatched = [];
  for (const n of names) {
    const hit = byNorm.get(normalizeName(n));
    if (hit) matched.set(n, hit); else unmatched.push(n);
  }
  return { matched, unmatched };
}

export async function fetchStagePage(stageNr) {
  const url = `${PCS_BASE}/${RACE_PATH}/stage-${stageNr}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Snorito wielerpoule; +https://snorito.app)' },
  });
  if (!res.ok) throw new Error(`PCS gaf ${res.status} op ${url}`);
  return res.text();
}
