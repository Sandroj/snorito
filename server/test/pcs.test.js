import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStagePage, parseTttResults, normalizeName, matchByName } from '../src/pcs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const stageHtml = fs.readFileSync(path.join(here, 'fixtures', 'stage.html'), 'utf8');
const tttHtml = fs.readFileSync(path.join(here, 'fixtures', 'ttt.html'), 'utf8');

// Fixture: Tour de France 2025, etappe 1 (Rijsel, massasprint).
test('daguitslag: posities en namen uit de STAGE-tab', () => {
  const { stage } = parseStagePage(stageHtml);
  assert.deepEqual(stage[0], { position: 1, name: 'Philipsen Jasper' });
  assert.equal(stage[1].name, 'Girmay Biniam');
  assert.equal(stage[2].name, 'Wærenskjold Søren');
  assert.ok(stage.length >= 20, `verwacht ≥20 rijen, kreeg ${stage.length}`);
});

test('DNF/DNS-rijen (niet-numerieke positie) worden overgeslagen', () => {
  const { stage } = parseStagePage(stageHtml);
  for (const row of stage) {
    assert.ok(Number.isInteger(row.position) && row.position >= 1, `ongeldige positie: ${row.position}`);
    assert.ok(row.name.length > 1);
  }
});

test('klassementen: alg/punt/berg/jong uit de tabs', () => {
  const { classifications } = parseStagePage(stageHtml);
  assert.equal(classifications.alg[0].name, 'Philipsen Jasper');
  assert.equal(classifications.punt[0].name, 'Philipsen Jasper');
  assert.equal(classifications.berg[0].name, 'Thomas Benjamin');
  assert.equal(classifications.jong[0].name, 'Girmay Biniam');
  assert.ok(classifications.alg.length >= 20);
  // Na etappe 1 kan het bergklassement korter dan 5 zijn — parser geeft wat er staat.
  assert.ok(classifications.berg.length >= 1);
});

// Fixture: Parijs-Nice 2025, etappe 3 (ploegentijdrit).
test('TTT: ploegen in uitslagvolgorde', () => {
  const teams = parseTttResults(tttHtml);
  assert.deepEqual(teams[0], { position: 1, teamName: 'Team Visma | Lease a Bike' });
  assert.equal(teams[1].teamName, 'Team Jayco AlUla');
  assert.equal(teams[2].teamName, 'Red Bull - BORA - hansgrohe');
  assert.ok(teams.length >= 8, `verwacht ≥8 ploegen, kreeg ${teams.length}`);
});

test('normalizeName: accenten, hoofdletters en woordvolgorde maken niet uit', () => {
  assert.equal(normalizeName('POGAČAR Tadej'), normalizeName('Tadej Pogačar'));
  assert.equal(normalizeName('Wærenskjold Søren'), normalizeName('Søren Wærenskjold'));
  assert.equal(normalizeName("O'Connor Ben"), normalizeName('Ben O’Connor'));
  assert.equal(normalizeName('van der Poel Mathieu'), normalizeName('Mathieu van der Poel'));
});

test('matchByName: bekende namen matchen, onbekende komen terug als unmatched', () => {
  const entities = [
    { id: 1, name: 'Jasper Philipsen' },
    { id: 2, name: 'Tadej Pogačar' },
  ];
  const { matched, unmatched } = matchByName(['Philipsen Jasper', 'POGAČAR Tadej', 'Fietsen Piet'], entities);
  assert.equal(matched.get('Philipsen Jasper').id, 1);
  assert.equal(matched.get('POGAČAR Tadej').id, 2);
  assert.deepEqual(unmatched, ['Fietsen Piet']);
});

test('matching tegen de echte rennerslijst (2026): toppers worden gevonden', () => {
  const ridersJson = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'data', 'scorito_tdf2026_riders.json'), 'utf8'));
  const entities = ridersJson.map((r) => ({ id: r.riderId, name: r.naam }));
  const { stage } = parseStagePage(stageHtml);
  const { matched, unmatched } = matchByName(stage.map((r) => r.name), entities);
  for (const naam of ['Philipsen Jasper', 'Girmay Biniam', 'Pogačar Tadej', 'Vingegaard Jonas']) {
    assert.ok(matched.has(naam), `${naam} zou moeten matchen`);
  }
  // 2025-fixture tegen 2026-selectie: niet iedereen rijdt dit jaar — puur informatief.
  console.log(`  match-rate fixture→2026: ${matched.size}/${stage.length} (unmatched: ${unmatched.slice(0, 5).join(', ')}…)`);
});
