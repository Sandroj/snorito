import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOptimalStage } from '../src/points.js';

// Reproductie van de bug: een bankzitter met méér ruwe punten dan de kopman
// werd niet geruild, omdat de vergelijking de kopman-verdubbeling meetelde
// (10) in plaats van zijn ruwe bijdrage (5). Bench-rijder Y (raw 8) verslaat
// kopman X op ruwe punten (5) maar niet op verdubbelde punten (10) — de ruil
// moet dus wél doorgaan, en de kopmanbonus verschuift mee naar Y.
test('computeOptimalStage: bankruil kijkt naar ruwe punten, niet naar de verdubbelde kopmanscore', () => {
  const lineup = [{ rider_id: 'X', is_captain: true }];
  const teamIds = ['X', 'Y'];
  const ptsByRider = new Map([
    ['X', { stage: 5, class: 0, team: 0 }],
    ['Y', { stage: 8, class: 0, team: 0 }],
  ]);

  const result = computeOptimalStage(lineup, teamIds, ptsByRider);

  assert.equal(result.total, 10); // X als kopman: 5 * 2
  assert.equal(result.gemist, 3); // ruil X (raw 5) voor Y (raw 8)
  assert.equal(result.gemistKopman, 3); // Y (raw 8) i.p.v. X (raw 5) als kopman
  assert.equal(result.optimal, 16); // = beste opstelling {Y} met Y als kopman: 8 * 2
});

test('computeOptimalStage: zonder winstgevende ruil of betere kopman blijft optimaal gelijk aan behaald', () => {
  const lineup = [{ rider_id: 'X', is_captain: true }, { rider_id: 'Z', is_captain: false }];
  const teamIds = ['X', 'Z', 'Y'];
  const ptsByRider = new Map([
    ['X', { stage: 20, class: 0, team: 0 }],
    ['Z', { stage: 10, class: 0, team: 0 }],
    ['Y', { stage: 1, class: 0, team: 0 }],
  ]);

  const result = computeOptimalStage(lineup, teamIds, ptsByRider);

  assert.equal(result.total, 50); // 20*2 + 10
  assert.equal(result.gemist, 0);
  assert.equal(result.gemistKopman, 0);
  assert.equal(result.optimal, 50);
});
