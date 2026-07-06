// Automatische verwerking van etappe-uitslagen vanaf ProCyclingStats.
// Aangeroepen via POST /api/cron/pcs-sync (GitHub Actions, elke 10 min).
// Etappes met result_source='manual' worden nooit aangeraakt.
import { get, all, run, tx } from './db.js';
import { processStage } from './points.js';
import { fetchStagePage, parseStagePage, parseTttResults, matchByName, matchTeamsByName } from './pcs.js';
import { parseRiderRanking, parseTeamRanking, filterJerseyPlaceholders, TEAM_ALIASES } from './letour.js';

// Etappestarttijden in data/stages_tdf2026.json zijn lokale tijd zonder zone;
// de hele Tour 2026 valt in de Midden-Europese zomertijd.
const CEST = '+02:00';
const startMs = (stage) => new Date(`${stage.start}${CEST}`).getTime();
const RECHECK_MS = 48 * 3600_000;

const TOP_STAGE = 20;
const TOP_TTT = 8;
const TOP_CLASS = 5;

// Slaat een uitslag op (zelfde payload-vorm als het admin-formulier) en zet de bron.
// Gedeeld door de admin-route ('manual') en de sync ('auto').
export async function saveStageResult(nr, { positions = [], tttPositions = [], classifications = {} }, source) {
  const stage = await get('SELECT * FROM stages WHERE nr = ?', [nr]);
  if (!stage) throw new Error(`Etappe ${nr} bestaat niet`);
  const CLASSIFICATIONS = ['alg', 'punt', 'berg', 'jong'];

  await tx(async (h) => {
    await h.run('DELETE FROM stage_results WHERE stage_nr = ?', [nr]);
    await h.run('DELETE FROM ttt_results WHERE stage_nr = ?', [nr]);
    await h.run('DELETE FROM classification_standings WHERE stage_nr = ?', [nr]);

    if (stage.type === 'TTT') {
      for (const p of tttPositions) {
        if (p.teamId) await h.run('INSERT INTO ttt_results (stage_nr, position, team_id) VALUES (?, ?, ?)', [nr, p.position, p.teamId]);
      }
    } else {
      for (const p of positions) {
        if (p.riderId) await h.run('INSERT INTO stage_results (stage_nr, position, rider_id) VALUES (?, ?, ?)', [nr, p.position, p.riderId]);
      }
    }

    for (const cls of CLASSIFICATIONS) {
      const arr = classifications[cls] || [];
      for (let i = 0; i < arr.length; i++) {
        if (arr[i]) await h.run('INSERT INTO classification_standings (stage_nr, classification, position, rider_id) VALUES (?, ?, ?, ?)', [nr, cls, i + 1, arr[i]]);
      }
    }

    await h.run('UPDATE stages SET result_source = ? WHERE nr = ?', [source, nr]);
  });
}

async function note(stageNr, error) {
  await run(`
    INSERT INTO stage_sync (stage_nr, checked_at, error) VALUES (?, now(), ?)
    ON CONFLICT (stage_nr) DO UPDATE SET checked_at = now(), error = EXCLUDED.error
  `, [stageNr, error]);
}

// Vertaalt PCS-HTML naar een payload voor saveStageResult.
// Geeft null terug zolang de uitslag nog niet compleet op PCS staat;
// gooit een fout bij niet te matchen namen (dan is handmatig ingrijpen nodig).
function payloadFromHtml(stage, html, riders, teams) {
  const payload = { positions: [], tttPositions: [], classifications: {} };

  const parsed = parseStagePage(html);
  const classLists = {};
  for (const cls of ['alg', 'punt', 'berg', 'jong']) {
    classLists[cls] = (parsed.classifications[cls] || []).slice(0, TOP_CLASS);
  }

  if (stage.type === 'TTT') {
    const tttTeams = parseTttResults(html).slice(0, TOP_TTT);
    if (tttTeams.length < TOP_TTT) return null; // uitslag nog niet (volledig) beschikbaar
    const { matched, unmatched } = matchTeamsByName(tttTeams.map((t) => t.teamName), teams);
    if (unmatched.length) throw new Error(`Onbekende ploegnamen van PCS: ${unmatched.join(', ')}`);
    payload.tttPositions = tttTeams.map((t) => ({ position: t.position, teamId: matched.get(t.teamName).id }));
  } else {
    const stageRows = parsed.stage.slice(0, TOP_STAGE);
    if (stageRows.length < TOP_STAGE) return null;
    const { matched, unmatched } = matchByName(stageRows.map((r) => r.name), riders);
    if (unmatched.length) throw new Error(`Onbekende rennersnamen van PCS (daguitslag): ${unmatched.join(', ')}`);
    payload.positions = stageRows.map((r) => ({ position: r.position, riderId: matched.get(r.name).id }));
  }

  // Algemeen klassement moet er zijn; punt/berg/jong kunnen vroeg in de Tour nog (bijna) leeg zijn.
  if (classLists.alg.length < TOP_CLASS) return null;
  for (const cls of ['alg', 'punt', 'berg', 'jong']) {
    const names = classLists[cls].map((r) => r.name);
    const { matched, unmatched } = matchByName(names, riders);
    if (unmatched.length) throw new Error(`Onbekende rennersnamen van PCS (${cls}): ${unmatched.join(', ')}`);
    payload.classifications[cls] = names.map((n) => matched.get(n).id);
  }

  return payload;
}

// Vergelijkt de PCS-payload met wat er al in de database staat.
async function differsFromStored(stage, payload) {
  if (stage.type === 'TTT') {
    const stored = await all('SELECT position, team_id FROM ttt_results WHERE stage_nr = ? ORDER BY position', [stage.nr]);
    const fresh = payload.tttPositions.map((p) => `${p.position}:${p.teamId}`).join(',');
    if (stored.map((r) => `${r.position}:${r.team_id}`).join(',') !== fresh) return true;
  } else {
    const stored = await all('SELECT position, rider_id FROM stage_results WHERE stage_nr = ? ORDER BY position', [stage.nr]);
    const fresh = payload.positions.map((p) => `${p.position}:${p.riderId}`).join(',');
    if (stored.map((r) => `${r.position}:${r.rider_id}`).join(',') !== fresh) return true;
  }
  for (const cls of ['alg', 'punt', 'berg', 'jong']) {
    const stored = await all(
      'SELECT rider_id FROM classification_standings WHERE stage_nr = ? AND classification = ? ORDER BY position', [stage.nr, cls]
    );
    if (stored.map((r) => r.rider_id).join(',') !== (payload.classifications[cls] || []).join(',')) return true;
  }
  return false;
}

// Zet verstreken etappes op 'gestart' en geeft terug welke etappes een
// PCS-import willen. De GitHub Action haalt daarvoor de HTML op (met een echte
// browser, wegens Cloudflare) en levert die af bij importStageHtml.
export async function syncTick() {
  const report = [];
  const pending = [];
  const stages = await all('SELECT * FROM stages ORDER BY nr');
  const now = Date.now();

  for (const s of stages) {
    if (s.status === 'open' && now >= startMs(s)) {
      await run("UPDATE stages SET status = 'started' WHERE nr = ?", [s.nr]);
      s.status = 'started';
      report.push(`etappe ${s.nr}: automatisch op 'gestart' gezet`);
    }

    const wantsImport = s.result_source !== 'manual' && (
      s.status === 'started' ||
      (s.status === 'finished' && s.result_source === 'auto' && now - startMs(s) < RECHECK_MS)
    );
    if (wantsImport) pending.push({ nr: s.nr, type: s.type });
  }

  return { at: new Date().toISOString(), report, stages: pending };
}

// Verwerkt de (door de Action aangeleverde) HTML van één PCS-etappepagina.
export async function importStageHtml(stageNr, html) {
  const stage = await get('SELECT * FROM stages WHERE nr = ?', [stageNr]);
  if (!stage) throw new Error(`Etappe ${stageNr} bestaat niet`);
  if (stage.result_source === 'manual') return `etappe ${stageNr}: handmatig — overgeslagen`;

  const riders = await all('SELECT id, name FROM riders');
  const teams = await all('SELECT id, name FROM cycling_teams');

  try {
    const payload = payloadFromHtml(stage, html, riders, teams);
    if (!payload) {
      await note(stage.nr, null);
      return `etappe ${stage.nr}: uitslag nog niet compleet op PCS`;
    }
    if (stage.status === 'finished' && !(await differsFromStored(stage, payload))) {
      await note(stage.nr, null);
      return `etappe ${stage.nr}: ongewijzigd`;
    }
    await saveStageResult(stage.nr, payload, 'auto');
    await processStage(stage.nr); // idempotent; zet de etappe op 'finished'
    await note(stage.nr, null);
    return `etappe ${stage.nr}: uitslag geïmporteerd en verwerkt`;
  } catch (e) {
    await note(stage.nr, e.message);
    return `etappe ${stage.nr}: FOUT — ${e.message}`;
  }
}

// Vertaalt letour.fr-fragmenten (per klassement één HTML-fragment) naar een
// payload voor saveStageResult. Renners worden op rugnummer gematcht.
// Geeft null terug zolang de uitslag nog niet compleet op letour.fr staat.
function payloadFromLetour(stage, fragments, riders, teams) {
  const payload = { positions: [], tttPositions: [], classifications: {} };
  const byBib = new Map(riders.filter((r) => r.bib != null).map((r) => [r.bib, r]));
  const riderId = (row, context) => {
    const rider = byBib.get(row.bib);
    if (!rider) throw new Error(`Onbekend rugnummer van letour.fr (${context}): #${row.bib}`);
    return rider.id;
  };

  if (stage.type === 'TTT') {
    const rows = parseTeamRanking(fragments.ete).slice(0, TOP_TTT);
    if (rows.length < TOP_TTT) return null; // uitslag nog niet (volledig) beschikbaar
    const names = rows.map((r) => TEAM_ALIASES[r.teamName.toLowerCase()] || r.teamName);
    const { matched, unmatched } = matchTeamsByName(names, teams);
    if (unmatched.length) throw new Error(`Onbekende ploegnamen van letour.fr: ${unmatched.join(', ')}`);
    payload.tttPositions = rows.map((r, i) => ({ position: r.position, teamId: matched.get(names[i]).id }));
  } else {
    const rows = parseRiderRanking(fragments.ite).slice(0, TOP_STAGE);
    if (rows.length < TOP_STAGE) return null;
    payload.positions = rows.map((r) => ({ position: r.position, riderId: riderId(r, 'daguitslag') }));
  }

  // Algemeen klassement moet er zijn; punt/berg/jong kunnen vroeg in de Tour nog (bijna) leeg zijn.
  const CLS_FRAGMENTS = { alg: 'itg', punt: 'ipg', berg: 'img', jong: 'ijg' };
  const classLists = {};
  for (const [cls, key] of Object.entries(CLS_FRAGMENTS)) {
    let rows = parseRiderRanking(fragments[key]);
    // Punten/berg: 0-punten-rijen zijn opvulling, maar bij een TTT is de
    // nummer 1 de officiële truidrager en telt wél (zie letour.js).
    if (cls === 'punt' || cls === 'berg') rows = filterJerseyPlaceholders(rows, stage.type === 'TTT');
    classLists[cls] = rows.slice(0, TOP_CLASS);
  }
  if (classLists.alg.length < TOP_CLASS) return null;
  for (const cls of Object.keys(CLS_FRAGMENTS)) {
    payload.classifications[cls] = classLists[cls].map((r) => riderId(r, cls));
  }

  return payload;
}

// Verwerkt de (door de Action aangeleverde) klassementsfragmenten van letour.fr.
export async function importLetourRankings(stageNr, fragments) {
  const stage = await get('SELECT * FROM stages WHERE nr = ?', [stageNr]);
  if (!stage) throw new Error(`Etappe ${stageNr} bestaat niet`);
  if (stage.result_source === 'manual') return `etappe ${stageNr}: handmatig — overgeslagen`;

  const riders = await all('SELECT id, name, bib FROM riders');
  const teams = await all('SELECT id, name FROM cycling_teams');

  try {
    const payload = payloadFromLetour(stage, fragments || {}, riders, teams);
    if (!payload) {
      await note(stage.nr, null);
      return `etappe ${stage.nr}: uitslag nog niet compleet op letour.fr`;
    }
    if (stage.status === 'finished' && !(await differsFromStored(stage, payload))) {
      await note(stage.nr, null);
      return `etappe ${stage.nr}: ongewijzigd`;
    }
    await saveStageResult(stage.nr, payload, 'auto');
    await processStage(stage.nr); // idempotent; zet de etappe op 'finished'
    await note(stage.nr, null);
    return `etappe ${stage.nr}: uitslag geïmporteerd en verwerkt`;
  } catch (e) {
    await note(stage.nr, e.message);
    return `etappe ${stage.nr}: FOUT — ${e.message}`;
  }
}

// Noteert een fetch-fout van de Action in het adminpaneel.
export async function noteSyncError(stageNr, message) {
  await note(stageNr, message);
}

// Directe server-side sync (fetch vanaf de server zelf). Werkt alleen als PCS
// de server niet blokkeert; de Action-route hierboven is de primaire weg.
export async function runSync() {
  const tick = await syncTick();
  const report = [...tick.report];

  for (const p of tick.stages) {
    try {
      const html = await fetchStagePage(p.nr);
      report.push(await importStageHtml(p.nr, html));
    } catch (e) {
      await note(p.nr, e.message);
      report.push(`etappe ${p.nr}: FOUT — ${e.message}`);
    }
  }

  return { at: tick.at, report };
}
