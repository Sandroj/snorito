import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRiderRanking, parseTeamRanking, filterJerseyPlaceholders, detectNewAbandons } from '../src/letour.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, 'fixtures', f), 'utf8');

// Fixtures: Tour de France 2026, etappe 1 (ploegentijdrit Barcelona), letour.fr.
// letour-punt.html is het ipg-fragment (puntenklassement) van ná die etappe:
// er zijn nog geen sprintpunten uitgedeeld, dus letour.fr toont opvulling met
// 0 punten — precies het geval dat de sync moet negeren.
const puntHtml = read('letour-punt.html');
const tttHtml = read('letour-ttt.html');

test('parseRiderRanking: positie, rugnummer en puntentotaal', () => {
  const rows = parseRiderRanking(puntHtml);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], { position: 1, bib: 81, points: 0 });
  for (const r of rows) {
    assert.ok(Number.isInteger(r.bib) && r.bib >= 1, `ongeldig rugnummer: ${r.bib}`);
    assert.equal(r.points, 0, 'na de TTT hoort iedereen in dit fragment op 0 punten te staan');
  }
});

test('parseRiderRanking: lege input geeft lege lijst', () => {
  assert.deepEqual(parseRiderRanking(undefined), []);
  assert.deepEqual(parseRiderRanking(''), []);
});

test('filterJerseyPlaceholders: bij een TTT blijft alleen de truidrager over', () => {
  const rows = parseRiderRanking(puntHtml); // 5 rijen, allemaal 0 punten (etappe 1, TTT)
  // De nummer 1 (Bernal, groene trui via snelste tussentijd) telt wél mee…
  assert.deepEqual(filterJerseyPlaceholders(rows, true).map((r) => [r.position, r.bib]), [[1, 81]]);
  // …maar buiten een TTT is een volledig 0-punten-klassement pure opvulling.
  assert.deepEqual(filterJerseyPlaceholders(rows, false), []);
});

test('filterJerseyPlaceholders: echte punten blijven altijd staan', () => {
  const rows = [
    { position: 1, bib: 5, points: 50 },
    { position: 2, bib: 7, points: 12 },
    { position: 3, bib: 9, points: null },
  ];
  assert.deepEqual(filterJerseyPlaceholders(rows, false), rows);
  assert.deepEqual(filterJerseyPlaceholders(rows, true), rows);
});

// De parser scant de HTML gericht i.p.v. een volledige DOM te bouwen (19x
// sneller op een echt 610 KB-fragment). Deze test dekt de randgevallen waar
// zo'n scanner op stuk kan gaan; letour.fr levert ze allemaal echt zo aan.
test('parseRiderRanking: randgevallen van de gerichte scan', () => {
  const html = `
    <table><thead>
      <tr class="has-shadowsep">
        <th class="rankingTables__row__position position">Rank</th><th>Rider</th>
      </tr>
    </thead><tbody>
      <tr class="rankingTables__row
                 rankingTables__row--emphase
                 has-shadowsep">
        <td class="rankingTables__row__position is-alignCenter"><span>1</span></td>
        <td class="rankingTables__row__profile runner">
          <span class="wrap"><span data-bib="#42" class="flag"></span>&nbsp;
          <a href="/en/rider/1/x">T. POGACAR</a></span>
        </td>
        <td class="is-alignCenter">50 PTS</td>
      </tr>
      <tr class="rankingTables__row">
        <td class="rankingTables__row__position is-alignCenter"><span>2</span></td>
        <td><span data-bib="#7"></span></td>
        <td class="is-alignCenter">12 pts</td>
      </tr>
      <tr class="rankingTables__row">
        <td class="rankingTables__row__position"><span>3</span></td>
        <td><span data-bib="#9"></span></td>
        <td class="is-alignCenter">+ 00' 14''</td>
      </tr>
    </tbody></table>`;
  assert.deepEqual(parseRiderRanking(html), [
    // kop-rij genegeerd, class over meerdere regels werkt, "50 PTS" gelezen
    { position: 1, bib: 42, points: 50 },
    { position: 2, bib: 7, points: 12 },   // kleine letters "pts" telt ook
    { position: 3, bib: 9, points: null }, // tijdcel is geen puntencel
  ]);
});

test('detectNewAbandons: mist het algemeen klassement een actieve renner, dan is die uitgevallen', () => {
  const riders = [
    { id: 1, bib: 10, last_started_stage: null }, // nog in het klassement
    { id: 2, bib: 20, last_started_stage: null }, // niet meer in het klassement → nieuw uitgevallen
    { id: 3, bib: 30, last_started_stage: 5 },    // al eerder gemarkeerd → niet opnieuw aanraken
    { id: 4, bib: null, last_started_stage: null }, // geen rugnummer bekend → nooit meenemen
  ];
  const present = [1]; // alleen renner 1 komt voor in het geïmporteerde klassement
  assert.deepEqual(detectNewAbandons(riders, present).map((r) => r.id), [2]);
});

test('detectNewAbandons: iedereen nog in het klassement geeft niets terug', () => {
  const riders = [{ id: 1, bib: 10, last_started_stage: null }];
  assert.deepEqual(detectNewAbandons(riders, [1]), []);
});

test('parseTeamRanking: ploegen in uitslagvolgorde', () => {
  const rows = parseTeamRanking(tttHtml);
  assert.deepEqual(rows[0], { position: 1, teamName: 'TEAM VISMA | LEASE A BIKE' });
  assert.equal(rows[1].teamName, 'NETCOMPANY INEOS CYCLING TEAM');
  assert.ok(rows.length >= 8, `verwacht ≥8 ploegen, kreeg ${rows.length}`);
});
