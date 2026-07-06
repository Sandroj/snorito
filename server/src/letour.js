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
