// Laadt fictieve uitslagen voor etappe 1 (TTT) en 2 (sprint) en verwerkt ze,
// zodat het puntensysteem en de klassementen te zien zijn zonder echte Tour-data.
// Draai `npm run seed` om terug te keren naar de schone stand (alles open).
import { db } from './db.js';
import { processStage } from './points.js';

const rid = (name) => {
  const r = db.prepare('SELECT id FROM riders WHERE name LIKE ?').get(`%${name}%`);
  if (!r) throw new Error(`Renner niet gevonden: ${name}`);
  return r.id;
};
const tid = (name) => {
  const t = db.prepare('SELECT id FROM cycling_teams WHERE name LIKE ?').get(`%${name}%`);
  if (!t) throw new Error(`Ploeg niet gevonden: ${name}`);
  return t.id;
};

db.prepare('DELETE FROM ttt_results').run();
db.prepare('DELETE FROM stage_results').run();
db.prepare('DELETE FROM classification_standings').run();

// --- Etappe 1: ploegentijdrit Barcelona ---------------------------------------
const tttTop8 = ['UAE Team Emirates', 'Visma', 'Red Bull', 'Lidl - Trek', 'INEOS', 'Soudal', 'Decathlon', 'Alpecin'];
tttTop8.forEach((team, i) => {
  db.prepare('INSERT INTO ttt_results (stage_nr, position, team_id) VALUES (1, ?, ?)').run(i + 1, tid(team));
});
const insCls1 = db.prepare('INSERT INTO classification_standings (stage_nr, classification, position, rider_id) VALUES (1, ?, ?, ?)');
['Pogačar', 'Wellens', 'del Toro', 'Vingegaard', 'van Aert'].forEach((n, i) => insCls1.run('alg', i + 1, rid(n)));
insCls1.run('punt', 1, rid('van Aert'));
insCls1.run('berg', 1, rid('Pogačar'));
['del Toro', 'Seixas', 'Uijtdebroeks', 'Lenny Martinez', 'Riccitello'].forEach((n, i) => insCls1.run('jong', i + 1, rid(n)));

db.prepare("UPDATE stages SET status = 'started' WHERE nr = 1").run();
processStage(1);
console.log('Etappe 1 (TTT) verwerkt');

// --- Etappe 2: sprintersrit Barcelona ------------------------------------------
const top20 = ['Philipsen', 'Merlier', 'Pedersen', 'Meeus', 'Girmay', 'De Lie', 'Kooij', 'van Aert', 'van der Poel', 'Groves', 'Bauhaus', 'Gaviria', 'De Kleijn', 'Kanter', 'Ackermann', 'Fretin', 'Wærenskjold', 'Bittner', 'Turgis', 'Degenkolb'];
top20.forEach((n, i) => {
  db.prepare('INSERT INTO stage_results (stage_nr, position, rider_id) VALUES (2, ?, ?)').run(i + 1, rid(n));
});
const insCls2 = db.prepare('INSERT INTO classification_standings (stage_nr, classification, position, rider_id) VALUES (2, ?, ?, ?)');
['Pogačar', 'Wellens', 'del Toro', 'Vingegaard', 'van Aert'].forEach((n, i) => insCls2.run('alg', i + 1, rid(n)));
['Philipsen', 'Merlier', 'Pedersen', 'van Aert', 'Meeus'].forEach((n, i) => insCls2.run('punt', i + 1, rid(n)));
['Pogačar', 'Vingegaard', 'Seixas', 'Arensman', 'Lenny Martinez'].forEach((n, i) => insCls2.run('berg', i + 1, rid(n)));
['del Toro', 'Seixas', 'Uijtdebroeks', 'Lenny Martinez', 'Riccitello'].forEach((n, i) => insCls2.run('jong', i + 1, rid(n)));

db.prepare("UPDATE stages SET status = 'started' WHERE nr = 2").run();
processStage(2);
console.log('Etappe 2 (sprint) verwerkt');

const scores = db.prepare(`
  SELECT u.name, SUM(s.points) AS totaal FROM user_scores s JOIN users u ON u.id = s.user_id
  GROUP BY u.id ORDER BY totaal DESC
`).all();
console.table(scores);
console.log('\nLet op: het team is nu vergrendeld (etappe 1 niet meer open). Draai `npm run seed` voor de schone stand.');
