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
//
// Bewust géén cheerio.load() hier. Een klassementsfragment is ~610 KB voor
// ~166 rijen (bijna alles opmaak, renderfoto's en witruimte); een volledige
// DOM opbouwen kostte daarvan het leeuwendeel. Op de 0,1-vCPU van de Render
// free tier blokkeert dat de event loop merkbaar — juist tijdens een etappe,
// wanneer de sync elke 2 minuten draait en iedereen zit te verversen. We
// scannen daarom alleen de drie velden die we nodig hebben. De test
// vergelijkt de uitkomst 1-op-1 met de cheerio-implementatie.
const TAGS = /<[^>]*>/g;
const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const cellText = (html) => html
  .replace(TAGS, '')
  .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e)
  .trim();

// Class-attribuut van een openingstag bevat het losse woord `token`.
function hasClass(tag, token) {
  const m = /\sclass\s*=\s*"([^"]*)"/i.exec(tag);
  return !!m && m[1].split(/\s+/).includes(token);
}

export function parseRiderRanking(html) {
  if (!html) return [];
  const rows = [];
  const trRe = /<tr\b[^>]*>/gi;
  const matches = [...html.matchAll(trRe)];

  for (let i = 0; i < matches.length; i++) {
    const tag = matches[i][0];
    if (!hasClass(tag, 'rankingTables__row')) continue;
    // Rijinhoud loopt tot de volgende <tr> (of het einde van het fragment).
    const start = matches[i].index + tag.length;
    const body = html.slice(start, i + 1 < matches.length ? matches[i + 1].index : html.length);

    // Positie: eerste <span> binnen de cel met class rankingTables__row__position.
    let position = NaN;
    const posCell = /<t[dh]\b[^>]*>/gi;
    let cell;
    while ((cell = posCell.exec(body))) {
      if (!hasClass(cell[0], 'rankingTables__row__position')) continue;
      const rest = body.slice(cell.index + cell[0].length);
      const span = /<span\b[^>]*>([\s\S]*?)<\/span>/i.exec(rest);
      if (span) position = parseInt(cellText(span[1]), 10);
      break;
    }

    const bibM = /\sdata-bib\s*=\s*"([^"]*)"/i.exec(body);
    const bib = parseInt((bibM ? bibM[1] : '').replace('#', ''), 10);

    // Punten: laatste cel die exact "12 PTS" bevat (zoals de cheerio-versie,
    // die bij meerdere treffers de laatste liet winnen).
    let points = null;
    for (const td of body.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)) {
      const m = cellText(td[1]).match(/^(\d+)\s*PTS?$/i);
      if (m) points = parseInt(m[1], 10);
    }

    if (Number.isInteger(position) && position >= 1 && Number.isInteger(bib)) rows.push({ position, bib, points });
  }
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

// Het algemeen klassement (itg-fragment) bevat het volledige, nog actieve veld
// (166 van ~184 renners bijv. rond etappe 15) — geen top-N-afkapping. Een
// renner die er (nog) niet als uitgevallen bijstaat maar niet meer in dit
// klassement voorkomt, is dus gestopt (DNF/DNS/DSQ). We markeren voorzichtig:
// alleen als het aantal nieuwe afwezigen plausibel is voor één etappe — een
// kapotte/onvolledige fetch zou anders in één klap tientallen actieve renners
// als uitgevallen aanmerken.
export const MAX_PLAUSIBLE_ABANDONS_PER_SYNC = 10;

// riders: [{ id, bib, last_started_stage }]; presentRiderIds: id's die in het
// zojuist geïmporteerde algemeen klassement voorkomen.
export function detectNewAbandons(riders, presentRiderIds) {
  const present = new Set(presentRiderIds);
  return riders.filter((r) => r.bib != null && r.last_started_stage == null && !present.has(r.id));
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

// De AJAX-URL's per etappe (met een stabiel token) veranderen niet gedurende de
// koers, maar zaten in de 789 KB-etappepagina die we vóór deze cache élke sync
// opnieuw ophaalden en met een regex over twee stringkopieën ontleedden. Op de
// 0,1-vCPU van de free tier gaf die burst — bij meerdere etappes tegelijk —
// latentiepieken van seconden op álle requests. We cachen de URL's daarom per
// etappe en slaan de zware pagina-fetch daarna over.
const ajaxUrlCache = new Map();

export async function fetchLetourFragments(stageNr, stageType) {
  const wanted = [stageType === 'TTT' ? 'ete' : 'ite', 'itg', 'ipg', 'img', 'ijg'];

  const fetchWith = async (urls) => {
    const fragments = {};
    for (const type of wanted) {
      if (urls[type]) fragments[type] = await fetchText(`${LETOUR_BASE}${urls[type]}`);
    }
    return fragments;
  };

  const cached = ajaxUrlCache.get(stageNr);
  if (cached) {
    try {
      return await fetchWith(cached);
    } catch {
      ajaxUrlCache.delete(stageNr); // token verlopen → hieronder de verse pagina
    }
  }

  const page = await fetchText(`${LETOUR_BASE}/en/rankings/stage-${stageNr}`);
  const urls = extractAjaxUrls(page, stageNr);
  // Pas cachen als álle gewenste klassementen aanwezig zijn; is de uitslag nog
  // niet volledig gepubliceerd, dan volgende ronde opnieuw de pagina proberen.
  if (wanted.every((t) => urls[t])) ajaxUrlCache.set(stageNr, urls);
  return fetchWith(urls);
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
