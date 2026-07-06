import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRiderRanking, parseTeamRanking, filterJerseyPlaceholders } from '../src/letour.js';

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

test('parseTeamRanking: ploegen in uitslagvolgorde', () => {
  const rows = parseTeamRanking(tttHtml);
  assert.deepEqual(rows[0], { position: 1, teamName: 'TEAM VISMA | LEASE A BIKE' });
  assert.equal(rows[1].teamName, 'NETCOMPANY INEOS CYCLING TEAM');
  assert.ok(rows.length >= 8, `verwacht ≥8 ploegen, kreeg ${rows.length}`);
});
