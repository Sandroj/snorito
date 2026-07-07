import { all, get, tx, riderStarted, CAPTAIN_FACTOR } from './db.js';

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

// Optimale score voor één deelnemer bij één etappe: wat had hij maximaal kunnen
// halen met zijn beste 9-uit-20 én de beste kopmankeuze? Twee losse, optelbare
// deltas boven op de echte score:
// - gemist: nettowinst van de beste bankruil, ranggewijs vergeleken op RUWE
//   (onverdubbelde) totalen. Belangrijk: de kopmanverdubbeling van de huidige
//   kopman mag deze vergelijking niet vervuilen — anders "beschermt" de
//   verdubbeling een middelmatige kopman tegen een ruil die op ruwe punten wél
//   zou lonen, en onderschat dit de werkelijk haalbare winst.
// - gemistKopman: extra winst als de renner met de meeste ruwe ritpunten in het
//   hele team (ook een bankzitter) kopman was geweest, los van de bankruil.
// lineup: [{rider_id, is_captain}]; teamIds: alle renner-ids van het team van 20;
// ptsByRider: Map<riderId, {stage,class,team}> (ruwe categoriepunten).
export function computeOptimalStage(lineup, teamIds, ptsByRider) {
  const lineupIds = new Set(lineup.map((l) => l.rider_id));
  let total = 0;
  const lineupRaw = [];
  let captainRawStage = 0;
  let hasCaptain = false;
  for (const l of lineup) {
    const p = ptsByRider.get(l.rider_id);
    if (!p) continue;
    total += p.stage * (l.is_captain ? CAPTAIN_FACTOR : 1) + p.class + p.team;
    lineupRaw.push(p.stage + p.class + p.team);
    if (l.is_captain) { captainRawStage = p.stage; hasCaptain = true; }
  }

  const benchIds = teamIds.filter((id) => !lineupIds.has(id));
  const benchRaw = benchIds
    .map((id) => { const p = ptsByRider.get(id); return p ? p.stage + p.class + p.team : 0; })
    .sort((a, b) => b - a);
  lineupRaw.sort((a, b) => a - b);
  let gemist = 0;
  for (let i = 0; i < Math.min(lineupRaw.length, benchRaw.length); i++) {
    const gain = benchRaw[i] - lineupRaw[i];
    if (gain <= 0) break;
    gemist += gain;
  }

  const bestRawStage = Math.max(0, ...teamIds.map((id) => ptsByRider.get(id)?.stage || 0));
  const gemistKopman = hasCaptain ? Math.max(0, bestRawStage - captainRawStage) : 0;

  return { total, gemist, gemistKopman, optimal: total + gemist + gemistKopman };
}

const ADD_POINTS_SQL =
  'INSERT INTO rider_points (stage_nr, rider_id, category, points) VALUES (?, ?, ?, ?) ' +
  'ON CONFLICT (stage_nr, rider_id, category) DO UPDATE SET points = rider_points.points + EXCLUDED.points';

// Verwerkt een etappe: berekent rider_points en user_scores.
// Idempotent: verwijdert eerst bestaande punten voor deze etappe.
export async function processStage(stageNr) {
  const stage = await get('SELECT * FROM stages WHERE nr = ?', [stageNr]);
  if (!stage) throw new Error(`Etappe ${stageNr} bestaat niet`);

  const riders = await all('SELECT * FROM riders');
  const riderById = new Map(riders.map((r) => [r.id, r]));

  await tx(async (h) => {
    await h.run('DELETE FROM rider_points WHERE stage_nr = ?', [stageNr]);
    await h.run('DELETE FROM user_scores WHERE stage_nr = ?', [stageNr]);

    const addPoints = (riderId, category, points) => h.run(ADD_POINTS_SQL, [stageNr, riderId, category, points]);

    // 1. Etappe-uitslag
    let stageWinnerTeamId = null;
    if (stage.type === 'TTT') {
      // Ploegentijdrit: per ploegklassering krijgen alle gestarte renners van die ploeg punten (top 8).
      const rows = await h.all('SELECT * FROM ttt_results WHERE stage_nr = ? ORDER BY position', [stageNr]);
      for (const row of rows) {
        const pts = TTT_POINTS[row.position - 1];
        if (!pts) continue;
        for (const r of riders) {
          if (r.team_id === row.team_id && riderStarted(r, stageNr)) {
            await addPoints(r.id, 'stage', pts);
          }
        }
      }
      // Bij een TTT geen aparte teampunten voor etappewinst (de hele ploeg scoort al via de rituitslag).
    } else {
      const rows = await h.all('SELECT * FROM stage_results WHERE stage_nr = ? ORDER BY position', [stageNr]);
      for (const row of rows) {
        const pts = STAGE_POINTS[row.position - 1];
        if (!pts) continue;
        await addPoints(row.rider_id, 'stage', pts);
        if (row.position === 1) stageWinnerTeamId = riderById.get(row.rider_id)?.team_id ?? null;
      }
    }

    // 2. Klassementen na de etappe (top 5)
    const standings = await h.all('SELECT * FROM classification_standings WHERE stage_nr = ?', [stageNr]);
    const leaders = {}; // classification -> rider
    for (const s of standings) {
      const pts = CLASS_POINTS_AFTER_STAGE[s.classification]?.[s.position - 1];
      if (pts) await addPoints(s.rider_id, 'class', pts);
      if (s.position === 1) leaders[s.classification] = riderById.get(s.rider_id);
    }

    // 3. Teampunten (etappewinnaar-ploeg + klassementsleiders); renner moet gestart zijn
    const stageWinnerRiderId = stage.type === 'TTT'
      ? null
      : (await h.get('SELECT rider_id FROM stage_results WHERE stage_nr = ? AND position = 1', [stageNr]))?.rider_id ?? null;

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
      if (teamPts > 0) await addPoints(r.id, 'team', teamPts);
    }

    // 4. Scores per deelnemer: alleen de 9 opgestelde renners tellen; kopman x2 op etappe-uitslag
    const pointRows = await h.all('SELECT * FROM rider_points WHERE stage_nr = ?', [stageNr]);
    const ptsByRider = new Map();
    for (const p of pointRows) {
      const cur = ptsByRider.get(p.rider_id) || { stage: 0, class: 0, team: 0 };
      cur[p.category] = p.points;
      ptsByRider.set(p.rider_id, cur);
    }

    const lineupRows = await h.all('SELECT * FROM lineups WHERE stage_nr = ?', [stageNr]);
    const byUser = new Map();
    for (const l of lineupRows) {
      if (!byUser.has(l.user_id)) byUser.set(l.user_id, []);
      byUser.get(l.user_id).push(l);
    }

    // Voor "Raak gekozen?": het team van 20 per gebruiker, om naast de echte
    // score ook de optimale score (beste opstelling + beste kopman) te bepalen.
    const teamRows = await h.all('SELECT * FROM user_teams');
    const teamByUser = new Map();
    for (const t of teamRows) {
      if (!teamByUser.has(t.user_id)) teamByUser.set(t.user_id, []);
      teamByUser.get(t.user_id).push(t.rider_id);
    }

    const allUsers = await h.all('SELECT id FROM users');
    for (const u of allUsers) {
      const lineup = byUser.get(u.id) || [];
      const teamIds = teamByUser.get(u.id) || [];
      const { total, optimal } = computeOptimalStage(lineup, teamIds, ptsByRider);
      await h.run('INSERT INTO user_scores (user_id, stage_nr, points, optimal_points) VALUES (?, ?, ?, ?)', [u.id, stageNr, total, optimal]);
    }

    await h.run("UPDATE stages SET status = 'finished' WHERE nr = ?", [stageNr]);
  });
}

// Verwerkt het eindklassement (stage_nr 0 in rider_points/user_scores).
export async function processFinal() {
  const riders = await all('SELECT * FROM riders');
  const riderById = new Map(riders.map((r) => [r.id, r]));
  const lastStageNr = (await get('SELECT MAX(nr) AS m FROM stages')).m;

  await tx(async (h) => {
    await h.run('DELETE FROM rider_points WHERE stage_nr = 0');
    await h.run('DELETE FROM user_scores WHERE stage_nr = 0');

    const addPoints = (riderId, category, points) => h.run(ADD_POINTS_SQL, [0, riderId, category, points]);

    const standings = await h.all('SELECT * FROM final_standings');
    const winners = {};
    for (const s of standings) {
      const pts = FINAL_POINTS[s.classification]?.[s.position - 1];
      if (pts) await addPoints(s.rider_id, 'class', pts);
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
      if (teamPts > 0) await addPoints(r.id, 'team', teamPts);
    }

    // Alle 20 teamrenners tellen mee voor het eindklassement (opstellen niet nodig)
    const pointRows = await h.all('SELECT * FROM rider_points WHERE stage_nr = 0');
    const ptsByRider = new Map();
    for (const p of pointRows) {
      ptsByRider.set(p.rider_id, (ptsByRider.get(p.rider_id) || 0) + p.points);
    }

    const allUsers = await h.all('SELECT id FROM users');
    const teamRows = await h.all('SELECT * FROM user_teams');
    const teamByUser = new Map();
    for (const t of teamRows) {
      if (!teamByUser.has(t.user_id)) teamByUser.set(t.user_id, []);
      teamByUser.get(t.user_id).push(t.rider_id);
    }
    for (const u of allUsers) {
      const riderIds = teamByUser.get(u.id) || [];
      let total = 0;
      for (const id of riderIds) total += ptsByRider.get(id) || 0;
      await h.run('INSERT INTO user_scores (user_id, stage_nr, points) VALUES (?, 0, ?)', [u.id, total]);
    }
  });
}
