// letour.fr-parser: leest de AJAX-klassementsfragmenten van de officiële
// Tour-site (rankingTables-markup). Renners staan er met rugnummer (bib) in,
// waardoor matching exact is; alleen ploegnamen worden op naam gematcht.
// Geen database-afhankelijkheden — puur parsen.
import * as cheerio from 'cheerio';

export const LETOUR_BASE = 'https://www.letour.fr';

// Officiële ploegnamen die te veel afwijken van onze databasenamen om via
// matchTeamsByName (woord-deelverzameling) te matchen.
export const TEAM_ALIASES = {
  'netcompany ineos cycling team': 'INEOS Grenadiers',
};

// Individueel klassementsfragment (ite/itg/ipg/img/ijg): positie + rugnummer.
// Bij puntenklassementen (ipg/img) staat het puntentotaal in een cel als
// "12 PTS"; bij tijdklassementen ontbreekt zo'n cel en blijft points null.
export function parseRiderRanking(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const rows = [];
  $('tr.rankingTables__row').each((_, tr) => {
    const $tr = $(tr);
    const position = parseInt($tr.find('.rankingTables__row__position span').first().text().trim(), 10);
    const bib = parseInt(($tr.find('[data-bib]').first().attr('data-bib') || '').replace('#', ''), 10);
    let points = null;
    $tr.find('td').each((_, td) => {
      const m = $(td).text().trim().match(/^(\d+)\s*PTS?$/i);
      if (m) points = parseInt(m[1], 10);
    });
    if (Number.isInteger(position) && position >= 1 && Number.isInteger(bib)) rows.push({ position, bib, points });
  });
  return rows;
}

// Punten- en bergklassement met alleen maar 0-punten-rijen (na een
// ploegentijdrit) zijn grotendeels opvulling van letour.fr — behalve de
// nummer 1: dat is de officiële truidrager (groen via snelste tussentijd,
// bol via snelste tijd op de laatste klim) en die krijgt volgens de
// Scorito-regels wél leiders- en teampunten. Posities 2-5 tellen dan niet.
// Zie docs/scorito-spelregels.md, sectie "Ploegentijdrit".
export function filterJerseyPlaceholders(rows, isTTT) {
  return rows.filter((r) => r.points !== 0 || (isTTT && r.position === 1));
}

// --- zelf ophalen (server-side sync) -----------------------------------------
// Zelfde flow als .github/scripts/letour-fetch.mjs (dat script blijft bewust
// dependency-vrij): etappepagina → AJAX-URL's per klassement → fragmenten.

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en',
};

async function fetchText(url) {
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`letour.fr gaf ${res.status} op ${url}`);
  return res.text();
}

// De etappepagina bevat per klassement een AJAX-URL (in data-ajax-stack en
// data-tabs-ajax, deels HTML-escaped). We pakken per type de eerste.
export function extractAjaxUrls(pageHtml, stageNr) {
  const unescaped = pageHtml.replaceAll('&quot;', '"').replaceAll('\\/', '/');
  const urls = {};
  const re = new RegExp(`/en/ajax/ranking/${stageNr}/([a-z]{3})/[a-f0-9]+/(?:none|subtab)`, 'g');
  for (const m of unescaped.matchAll(re)) {
    if (!(m[1] in urls)) urls[m[1]] = m[0];
  }
  return urls;
}

export async function fetchLetourFragments(stageNr, stageType) {
  const page = await fetchText(`${LETOUR_BASE}/en/rankings/stage-${stageNr}`);
  const urls = extractAjaxUrls(page, stageNr);
  const wanted = [stageType === 'TTT' ? 'ete' : 'ite', 'itg', 'ipg', 'img', 'ijg'];
  const fragments = {};
  for (const type of wanted) {
    if (urls[type]) fragments[type] = await fetchText(`${LETOUR_BASE}${urls[type]}`);
  }
  return fragments;
}

// Ploegenklassementsfragment (ete/etg): positie + ploegnaam.
export function parseTeamRanking(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const rows = [];
  $('tr.rankingTables__row').each((_, tr) => {
    const $tr = $(tr);
    const position = parseInt($tr.find('.rankingTables__row__position span').first().text().trim(), 10);
    const teamName = $tr.find('a[href*="/team/"]').first().text().trim();
    if (Number.isInteger(position) && position >= 1 && teamName) rows.push({ position, teamName });
  });
  return rows;
}
