// Automatische verwerking van etappe-uitslagen vanaf ProCyclingStats.
// Aangeroepen via POST /api/cron/pcs-sync (GitHub Actions, elke 10 min).
// Etappes met result_source='manual' worden nooit aangeraakt.
import { get, all, run, tx } from './db.js';
import { processStage } from './points.js';
import { bustCache } from './cache.js';
import { parseStagePage, parseTttResults, matchByName, matchTeamsByName } from './pcs.js';
import {
  parseRiderRanking, parseTeamRanking, filterJerseyPlaceholders, fetchLetourFragments, TEAM_ALIASES,
} from './letour.js';

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

    if (stage.type === 'TTT') {
      for (const p of tttPositions) {
        if (p.teamId) await h.run('INSERT INTO ttt_results (stage_nr, position, team_id) VALUES (?, ?, ?)', [nr, p.position, p.teamId]);
      }
    } else {
      for (const p of positions) {
        if (p.riderId) await h.run('INSERT INTO stage_results (stage_nr, position, rider_id) VALUES (?, ?, ?)', [nr, p.position, p.riderId]);
      }
    }

    // Per klassement vervangen i.p.v. alles in één keer wissen: een lege lijst van
    // de auto-sync betekent meestal "dit fragment was nog niet compleet toen we
    // ophaalden" (bijv. jong/wit-klassement dat net na de daguitslag publiceert),
    // niet "dit klassement is leeg". Zonder deze uitzondering wiste een auto-sync
    // met een tijdelijk lege fetch een al goed opgeslagen klassement blijvend leeg
    // (gebeurd bij etappe 5: jongerenklassement raakte zo leeg en werd, eenmaal
    // buiten het 48u-hercheckvenster, niet meer automatisch hersteld). De
    // handmatige adminroute (source='manual') mag een klassement wél expliciet
    // leegmaken — dat is een bewuste keuze van de beheerder.
    for (const cls of CLASSIFICATIONS) {
      const arr = classifications[cls] || [];
      if (arr.length === 0 && source !== 'manual') continue;
      await h.run('DELETE FROM classification_standings WHERE stage_nr = ? AND classification = ?', [nr, cls]);
      for (let i = 0; i < arr.length; i++) {
        if (arr[i]) await h.run('INSERT INTO classification_standings (stage_nr, classification, position, rider_id) VALUES (?, ?, ?, ?)', [nr, cls, i + 1, arr[i]]);
      }
    }

    await h.run('UPDATE stages SET result_source = ? WHERE nr = ?', [source, nr]);
  });
  bustCache(); // uitslag of etappestatus gewijzigd → gecachte basisdata verversen
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
      'SELECT position, rider_id FROM classification_standings WHERE stage_nr = ? AND classification = ? ORDER BY position', [stage.nr, cls]
    );
    const arr = payload.classifications[cls] || [];
    const fresh = arr.map((id, i) => (id ? `${i + 1}:${id}` : null)).filter(Boolean).join(',');
    if (stored.map((r) => `${r.position}:${r.rider_id}`).join(',') !== fresh) return true;
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
    if (wantsImport) pending.push({ nr: s.nr, type: s.type, status: s.status });
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

  if (stage.type === 'TTT') {
    const rows = parseTeamRanking(fragments.ete).slice(0, TOP_TTT);
    if (rows.length < TOP_TTT) return null; // uitslag nog niet (volledig) beschikbaar
    const names = rows.map((r) => TEAM_ALIASES[r.teamName.toLowerCase()] || r.teamName);
    const { matched, unmatched } = matchTeamsByName(names, teams);
    if (unmatched.length) throw new Error(`Onbekende ploegnamen van letour.fr: ${unmatched.join(', ')}`);
    payload.tttPositions = rows.map((r, i) => ({ position: r.position, teamId: matched.get(names[i]).id }));
  } else {
    const rows = parseRiderRanking(fragments.ite);
    if (rows.length < TOP_STAGE) return null; // wacht tot de uitslag (top 20) compleet is
    // Volledige finishvolgorde bewaren, zodat ook de positie van renners buiten
    // de top 20 zichtbaar is. De top 20 telt voor de punten en moet exact
    // matchen; daaronder slaan we onbekende rugnummers (renners buiten onze
    // poule) over i.p.v. de hele import te laten falen.
    payload.positions = rows.map((r) => {
      const rider = byBib.get(r.bib);
      if (!rider) {
        if (r.position <= TOP_STAGE) throw new Error(`Onbekend rugnummer van letour.fr (daguitslag): #${r.bib}`);
        return null;
      }
      return { position: r.position, riderId: rider.id };
    }).filter(Boolean);
  }

  // Algemeen klassement moet er zijn; punt/berg/jong kunnen vroeg in de Tour nog (bijna) leeg zijn.
  const CLS_FRAGMENTS = { alg: 'itg', punt: 'ipg', berg: 'img', jong: 'ijg' };
  const classLists = {};
  for (const [cls, key] of Object.entries(CLS_FRAGMENTS)) {
    let rows = parseRiderRanking(fragments[key]);
    // Punten/berg: 0-punten-rijen zijn opvulling, maar bij een TTT is de
    // nummer 1 de officiële truidrager en telt wél (zie letour.js).
    if (cls === 'punt' || cls === 'berg') rows = filterJerseyPlaceholders(rows, stage.type === 'TTT');
    classLists[cls] = rows;
  }
  if (classLists.alg.length < TOP_CLASS) return null;
  // Volledige klassementen bewaren (voor positie-inzage van álle renners), op de
  // échte positie (goed bij gelijke stand, PK is uniek). Top 5 telt voor de
  // punten en moet exact matchen; daaronder slaan we onbekende rugnummers over.
  for (const cls of Object.keys(CLS_FRAGMENTS)) {
    const arr = [];
    for (const r of classLists[cls]) {
      const rider = byBib.get(r.bib);
      if (!rider) {
        if (r.position <= TOP_CLASS) throw new Error(`Onbekend rugnummer van letour.fr (${cls}): #${r.bib}`);
        continue;
      }
      arr[r.position - 1] = rider.id;
    }
    payload.classifications[cls] = arr;
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

// Directe server-side sync: haalt de letour.fr-fragmenten zelf op (zelfde bron
// en dezelfde import als de GitHub Action). Draait elke 2 minuten via het
// interval in index.js; de Action blijft wekker en vangnet.
//
// fastOnly (in-process loop): alleen etappes die nú lopen ('started') krijgen de
// snelle 2-minuten-behandeling. Het herchecken van al afgeronde etappes (tot 48u
// na de start) is veel minder tijdkritisch en zou anders elke 2 minuten een
// zware fetch+parse per afgelopen etappe opstapelen; dat laten we over aan de
// 10-minuten GitHub Action. Zonder fastOnly (cron-route) blijft alles meelopen.
export async function runSync({ fastOnly = false } = {}) {
  const tick = await syncTick();
  const report = [...tick.report];
  const stages = fastOnly ? tick.stages.filter((s) => s.status === 'started') : tick.stages;

  for (const p of stages) {
    try {
      const fragments = await fetchLetourFragments(p.nr, p.type);
      report.push(await importLetourRankings(p.nr, fragments));
    } catch (e) {
      await note(p.nr, e.message);
      report.push(`etappe ${p.nr}: FOUT — ${e.message}`);
    }
  }

  return { at: tick.at, report };
}
