// Laadt fictieve uitslagen voor etappe 1 (TTT) en 2 (sprint) en verwerkt ze,
// zodat het puntensysteem en de klassementen te zien zijn zonder echte Tour-data.
// Draai `npm run seed` om terug te keren naar de schone stand (alles open).
import { get, all, run, pool } from './db.js';
import { processStage } from './points.js';

const rid = async (name) => {
  const r = await get('SELECT id FROM riders WHERE name LIKE ?', [`%${name}%`]);
  if (!r) throw new Error(`Renner niet gevonden: ${name}`);
  return r.id;
};
const tid = async (name) => {
  const t = await get('SELECT id FROM cycling_teams WHERE name LIKE ?', [`%${name}%`]);
  if (!t) throw new Error(`Ploeg niet gevonden: ${name}`);
  return t.id;
};

await run('DELETE FROM ttt_results');
await run('DELETE FROM stage_results');
await run('DELETE FROM classification_standings');

// --- Etappe 1: ploegentijdrit Barcelona ---------------------------------------
const tttTop8 = ['UAE Team Emirates', 'Visma', 'Red Bull', 'Lidl - Trek', 'INEOS', 'Soudal', 'Decathlon', 'Alpecin'];
for (const [i, team] of tttTop8.entries()) {
  await run('INSERT INTO ttt_results (stage_nr, position, team_id) VALUES (1, ?, ?)', [i + 1, await tid(team)]);
}
const insCls1 = (cls, pos, riderId) =>
  run('INSERT INTO classification_standings (stage_nr, classification, position, rider_id) VALUES (1, ?, ?, ?)', [cls, pos, riderId]);
for (const [i, n] of ['Pogačar', 'Wellens', 'del Toro', 'Vingegaard', 'van Aert'].entries()) await insCls1('alg', i + 1, await rid(n));
await insCls1('punt', 1, await rid('van Aert'));
await insCls1('berg', 1, await rid('Pogačar'));
for (const [i, n] of ['del Toro', 'Seixas', 'Uijtdebroeks', 'Lenny Martinez', 'Riccitello'].entries()) await insCls1('jong', i + 1, await rid(n));

await run("UPDATE stages SET status = 'started' WHERE nr = 1");
await processStage(1);
console.log('Etappe 1 (TTT) verwerkt');

// --- Etappe 2: sprintersrit Barcelona ------------------------------------------
const top20 = ['Philipsen', 'Merlier', 'Pedersen', 'Meeus', 'Girmay', 'De Lie', 'Kooij', 'van Aert', 'van der Poel', 'Groves', 'Bauhaus', 'Gaviria', 'De Kleijn', 'Kanter', 'Ackermann', 'Fretin', 'Wærenskjold', 'Bittner', 'Turgis', 'Degenkolb'];
for (const [i, n] of top20.entries()) {
  await run('INSERT INTO stage_results (stage_nr, position, rider_id) VALUES (2, ?, ?)', [i + 1, await rid(n)]);
}
const insCls2 = (cls, pos, riderId) =>
  run('INSERT INTO classification_standings (stage_nr, classification, position, rider_id) VALUES (2, ?, ?, ?)', [cls, pos, riderId]);
for (const [i, n] of ['Pogačar', 'Wellens', 'del Toro', 'Vingegaard', 'van Aert'].entries()) await insCls2('alg', i + 1, await rid(n));
for (const [i, n] of ['Philipsen', 'Merlier', 'Pedersen', 'van Aert', 'Meeus'].entries()) await insCls2('punt', i + 1, await rid(n));
for (const [i, n] of ['Pogačar', 'Vingegaard', 'Seixas', 'Arensman', 'Lenny Martinez'].entries()) await insCls2('berg', i + 1, await rid(n));
for (const [i, n] of ['del Toro', 'Seixas', 'Uijtdebroeks', 'Lenny Martinez', 'Riccitello'].entries()) await insCls2('jong', i + 1, await rid(n));

await run("UPDATE stages SET status = 'started' WHERE nr = 2");
await processStage(2);
console.log('Etappe 2 (sprint) verwerkt');

const scores = await all(`
  SELECT u.name, SUM(s.points) AS totaal FROM user_scores s JOIN users u ON u.id = s.user_id
  GROUP BY u.id, u.name ORDER BY totaal DESC
`);
console.table(scores);
console.log('\nLet op: het team is nu vergrendeld (etappe 1 niet meer open). Draai `npm run seed` voor de schone stand.');
await pool.end();
