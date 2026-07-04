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
export function parseRiderRanking(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const rows = [];
  $('tr.rankingTables__row').each((_, tr) => {
    const $tr = $(tr);
    const position = parseInt($tr.find('.rankingTables__row__position span').first().text().trim(), 10);
    const bib = parseInt(($tr.find('[data-bib]').first().attr('data-bib') || '').replace('#', ''), 10);
    if (Number.isInteger(position) && position >= 1 && Number.isInteger(bib)) rows.push({ position, bib });
  });
  return rows;
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
