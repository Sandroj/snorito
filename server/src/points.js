import { db, riderStarted, CAPTAIN_FACTOR } from './db.js';

// Puntentabellen — zie docs/scorito-spelregels.md
export const STAGE_POINTS = [50, 44, 40, 36, 32, 30, 28, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2];
export const TTT_POINTS = [40, 32, 28, 24, 20, 16, 12, 8];
export const CLASS_POINTS_AFTER_STAGE = {
  alg: [10, 8, 6, 4, 2],
  punt: [8, 6, 4, 2, 1],
  berg: [8, 6, 4, 2, 1],
  jong: [6, 4, 3, 2, 1],
};
export const TEAM_POINTS_AFTER_STAGE = { stageWin: 10, alg: 8, punt: 6, berg: 6, jong: 3 };
export const FINAL_POINTS = {
  alg: [100, 80, 60, 50, 40, 36, 32, 28, 24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2],
  punt: [80, 60, 40, 30, 20, 10, 8, 6, 4, 2],
  berg: [80, 60, 40, 30, 20, 10, 8, 6, 4, 2],
  jong: [60, 40, 30, 20, 10],
};
export const FINAL_TEAM_POINTS = { alg: 24, punt: 18, berg: 18, jong: 9 };
export const CLASSIFICATIONS = ['alg', 'punt', 'berg', 'jong'];

const allRiders = () => db.prepare('SELECT * FROM riders').all();

// Verwerkt een etappe: berekent rider_points en user_scores.
// Idempotent: verwijdert eerst bestaande punten voor deze etappe.
export function processStage(stageNr) {
  const stage = db.prepare('SELECT * FROM stages WHERE nr = ?').get(stageNr);
  if (!stage) throw new Error(`Etappe ${stageNr} bestaat niet`);

  const riders = allRiders();
  const riderById = new Map(riders.map((r) => [r.id, r]));

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM rider_points WHERE stage_nr = ?').run(stageNr);
    db.prepare('DELETE FROM user_scores WHERE stage_nr = ?').run(stageNr);

    const addPoints = db.prepare(
      'INSERT INTO rider_points (stage_nr, rider_id, category, points) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT (stage_nr, rider_id, category) DO UPDATE SET points = points + excluded.points'
    );

    // 1. Etappe-uitslag
    let stageWinnerTeamId = null;
    if (stage.type === 'TTT') {
      // Ploegentijdrit: per ploegklassering krijgen alle gestarte renners van die ploeg punten (top 8).
      const rows = db.prepare('SELECT * FROM ttt_results WHERE stage_nr = ? ORDER BY position').all(stageNr);
      for (const row of rows) {
        const pts = TTT_POINTS[row.position - 1];
        if (!pts) continue;
        for (const r of riders) {
          if (r.team_id === row.team_id && riderStarted(r, stageNr)) {
            addPoints.run(stageNr, r.id, 'stage', pts);
          }
        }
      }
      // Bij een TTT geen aparte teampunten voor etappewinst (de hele ploeg scoort al via de rituitslag).
    } else {
      const rows = db.prepare('SELECT * FROM stage_results WHERE stage_nr = ? ORDER BY position').all(stageNr);
      for (const row of rows) {
        const pts = STAGE_POINTS[row.position - 1];
        if (!pts) continue;
        addPoints.run(stageNr, row.rider_id, 'stage', pts);
        if (row.position === 1) stageWinnerTeamId = riderById.get(row.rider_id)?.team_id ?? null;
      }
    }

    // 2. Klassementen na de etappe (top 5)
    const standings = db.prepare('SELECT * FROM classification_standings WHERE stage_nr = ?').all(stageNr);
    const leaders = {}; // classification -> rider
    for (const s of standings) {
      const pts = CLASS_POINTS_AFTER_STAGE[s.classification]?.[s.position - 1];
      if (pts) addPoints.run(stageNr, s.rider_id, 'class', pts);
      if (s.position === 1) leaders[s.classification] = riderById.get(s.rider_id);
    }

    // 3. Teampunten (etappewinnaar-ploeg + klassementsleiders); renner moet gestart zijn
    const stageWinnerRiderId = stage.type === 'TTT'
      ? null
      : db.prepare('SELECT rider_id FROM stage_results WHERE stage_nr = ? AND position = 1').get(stageNr)?.rider_id ?? null;

    for (const r of riders) {
      if (!riderStarted(r, stageNr)) continue;
      let teamPts = 0;
      if (stageWinnerTeamId && r.team_id === stageWinnerTeamId && r.id !== stageWinnerRiderId) {
        teamPts += TEAM_POINTS_AFTER_STAGE.stageWin;
      }
      for (const cls of CLASSIFICATIONS) {
        const leader = leaders[cls];
        if (leader && leader.team_id === r.team_id && leader.id !== r.id) {
          teamPts += TEAM_POINTS_AFTER_STAGE[cls];
        }
      }
      if (teamPts > 0) addPoints.run(stageNr, r.id, 'team', teamPts);
    }

    // 4. Scores per deelnemer: alleen de 9 opgestelde renners tellen; kopman x2 op etappe-uitslag
    const pointRows = db.prepare('SELECT * FROM rider_points WHERE stage_nr = ?').all(stageNr);
    const ptsByRider = new Map();
    for (const p of pointRows) {
      const cur = ptsByRider.get(p.rider_id) || { stage: 0, class: 0, team: 0 };
      cur[p.category] = p.points;
      ptsByRider.set(p.rider_id, cur);
    }

    const lineupRows = db.prepare('SELECT * FROM lineups WHERE stage_nr = ?').all(stageNr);
    const byUser = new Map();
    for (const l of lineupRows) {
      if (!byUser.has(l.user_id)) byUser.set(l.user_id, []);
      byUser.get(l.user_id).push(l);
    }

    const insertScore = db.prepare('INSERT INTO user_scores (user_id, stage_nr, points) VALUES (?, ?, ?)');
    const allUsers = db.prepare('SELECT id FROM users').all();
    for (const u of allUsers) {
      const lineup = byUser.get(u.id) || [];
      let total = 0;
      for (const l of lineup) {
        const p = ptsByRider.get(l.rider_id);
        if (!p) continue;
        total += p.stage * (l.is_captain ? CAPTAIN_FACTOR : 1) + p.class + p.team;
      }
      insertScore.run(u.id, stageNr, total);
    }

    db.prepare("UPDATE stages SET status = 'finished' WHERE nr = ?").run(stageNr);
  });
  tx();
}

// Verwerkt het eindklassement (stage_nr 0 in rider_points/user_scores).
export function processFinal() {
  const riders = allRiders();
  const riderById = new Map(riders.map((r) => [r.id, r]));
  const lastStageNr = db.prepare('SELECT MAX(nr) AS m FROM stages').get().m;

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM rider_points WHERE stage_nr = 0').run();
    db.prepare('DELETE FROM user_scores WHERE stage_nr = 0').run();

    const addPoints = db.prepare(
      'INSERT INTO rider_points (stage_nr, rider_id, category, points) VALUES (0, ?, ?, ?) ' +
      'ON CONFLICT (stage_nr, rider_id, category) DO UPDATE SET points = points + excluded.points'
    );

    const standings = db.prepare('SELECT * FROM final_standings').all();
    const winners = {};
    for (const s of standings) {
      const pts = FINAL_POINTS[s.classification]?.[s.position - 1];
      if (pts) addPoints.run(s.rider_id, 'class', pts);
      if (s.position === 1) winners[s.classification] = riderById.get(s.rider_id);
    }

    // Teampunten eindklassement: ploeggenoten van klassementswinnaars, mits gestart in de laatste etappe
    for (const r of riders) {
      if (!riderStarted(r, lastStageNr)) continue;
      let teamPts = 0;
      for (const cls of CLASSIFICATIONS) {
        const w = winners[cls];
        if (w && w.team_id === r.team_id && w.id !== r.id) teamPts += FINAL_TEAM_POINTS[cls];
      }
      if (teamPts > 0) addPoints.run(r.id, 'team', teamPts);
    }

    // Alle 20 teamrenners tellen mee voor het eindklassement (opstellen niet nodig)
    const pointRows = db.prepare('SELECT * FROM rider_points WHERE stage_nr = 0').all();
    const ptsByRider = new Map();
    for (const p of pointRows) {
      ptsByRider.set(p.rider_id, (ptsByRider.get(p.rider_id) || 0) + p.points);
    }

    const insertScore = db.prepare('INSERT INTO user_scores (user_id, stage_nr, points) VALUES (?, 0, ?)');
    const allUsers = db.prepare('SELECT id FROM users').all();
    const teamRows = db.prepare('SELECT * FROM user_teams').all();
    const teamByUser = new Map();
    for (const t of teamRows) {
      if (!teamByUser.has(t.user_id)) teamByUser.set(t.user_id, []);
      teamByUser.get(t.user_id).push(t.rider_id);
    }
    for (const u of allUsers) {
      const riderIds = teamByUser.get(u.id) || [];
      let total = 0;
      for (const id of riderIds) total += ptsByRider.get(id) || 0;
      insertScore.run(u.id, total);
    }
  });
  tx();
}
