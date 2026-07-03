import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, flag, fmtDate, fmtTime, Rider, Stage, terrainLabel, typeChipClass } from '../api';
import { ClockIcon, MountainIcon } from '../components/Icons';

const LINEUP_SIZE = 9;

export function StageCard({ stage }: { stage: Stage }) {
  return (
    <div className="card flush stage-card fade-in">
      <div className="stage-head">
        <div className="stage-nr"><b>{stage.nr}</b><span>etappe</span></div>
        <div style={{ minWidth: 0 }}>
          <div className="stage-route">{stage.van} → {stage.naar}</div>
          <div className="stage-meta">
            <span className="chip chip-grijs">{fmtDate(stage.start)}</span>
            <span className="chip chip-grijs">{stage.km} km</span>
            <span className={`chip ${stage.terrain === 'berg' ? 'chip-rood' : stage.terrain === 'heuvel' ? 'chip-oranje' : 'chip-groen'}`}>
              <MountainIcon size={12} /> {terrainLabel[stage.terrain] || stage.terrain}
            </span>
            {stage.type !== 'rit' && <span className="chip chip-navy">{stage.type === 'TTT' ? 'Ploegentijdrit' : 'Tijdrit'}</span>}
          </div>
        </div>
      </div>
      {stage.image_url && (
        <div className="stage-profile">
          <img src={stage.image_url} alt={`Profiel etappe ${stage.nr}`} loading="lazy" referrerPolicy="no-referrer" />
        </div>
      )}
      {stage.description && <div className="stage-desc">{stage.description}</div>}
      <div className={`stage-deadline ${stage.status !== 'open' ? 'closed' : ''}`}>
        <ClockIcon size={14} />
        {stage.status === 'open'
          ? <>Deadline opstelling: {fmtDate(stage.start)} om {fmtTime(stage.start)}</>
          : stage.status === 'started' ? 'Deze etappe is gestart — opstelling vergrendeld' : 'Deze etappe is verwerkt'}
      </div>
    </div>
  );
}

export default function Lineup() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [stageNr, setStageNr] = useState<number | null>(null);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [teamIds, setTeamIds] = useState<number[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [captainId, setCaptainId] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    Promise.all([api('/api/stages'), api('/api/riders'), api('/api/team')]).then(([s, r, t]) => {
      setStages(s.stages);
      setRiders(r.riders);
      setTeamIds(t.riderIds);
      const firstOpen = s.stages.find((st: Stage) => st.status === 'open');
      setStageNr(firstOpen ? firstOpen.nr : s.stages[0]?.nr ?? null);
    });
  }, []);

  useEffect(() => {
    if (stageNr == null) return;
    api(`/api/lineup/${stageNr}`).then((l) => {
      setSelected(new Set(l.riderIds));
      setCaptainId(l.captainId);
      setLocked(l.locked);
      setMsg(null);
    });
  }, [stageNr]);

  const teamRiders = useMemo(
    () => riders.filter((r) => teamIds.includes(r.id)).sort((a, b) => b.price - a.price),
    [riders, teamIds]
  );

  const stage = stages.find((s) => s.nr === stageNr);

  const toggle = (id: number) => {
    if (locked) return;
    setMsg(null);
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
      if (captainId === id) setCaptainId(null);
    } else {
      if (next.size >= LINEUP_SIZE) return;
      next.add(id);
    }
    setSelected(next);
  };

  const save = async () => {
    if (stageNr == null) return;
    setMsg(null);
    try {
      await api(`/api/lineup/${stageNr}`, { method: 'PUT', json: { riderIds: [...selected], captainId } });
      setMsg({ kind: 'success', text: 'Opstelling opgeslagen' });
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    }
  };

  if (teamIds.length < 20) {
    return (
      <div className="fade-in">
        <h1>Opstelling</h1>
        <div className="card empty">
          <div className="emoji">🚴</div>
          Maak eerst je team van 20 renners compleet.<br />
          <Link to="/team"><b>Naar teamselectie →</b></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <h1>Opstelling</h1>
      <p className="page-sub">Stel per etappe 9 renners op en kies een kopman (★ = dubbele punten op de daguitslag).</p>

      <select value={stageNr ?? ''} onChange={(e) => setStageNr(Number(e.target.value))}>
        {stages.map((s) => (
          <option key={s.nr} value={s.nr}>
            Etappe {s.nr}{s.type !== 'rit' ? ` (${s.type})` : ''} · {s.van} → {s.naar}
            {s.status !== 'open' ? (s.status === 'finished' ? ' ✓' : ' 🔒') : ''}
          </option>
        ))}
      </select>

      {stage && <StageCard stage={stage} />}

      <div className="summary">
        <div className="stats">
          <div className="stat">
            <div className="lab">Opgesteld</div>
            <div className="val">{selected.size}<small style={{ color: '#98A2B3' }}> / {LINEUP_SIZE}</small></div>
          </div>
          <div className="stat" style={{ textAlign: 'center', minWidth: 0 }}>
            <div className="lab">Kopman</div>
            <div className="val geel" style={{ fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {captainId ? riders.find((r) => r.id === captainId)?.name ?? '—' : '—'}
            </div>
          </div>
          <button className="btn btn-primary" onClick={save} disabled={locked || selected.size !== LINEUP_SIZE || !captainId}>
            Opslaan
          </button>
        </div>
        <div className="progress"><div style={{ width: `${(selected.size / LINEUP_SIZE) * 100}%` }} /></div>
      </div>
      {msg && <div className={msg.kind}>{msg.text}</div>}

      <div className="card flush">
        {teamRiders.map((r) => {
          const isSel = selected.has(r.id);
          const isCaptain = captainId === r.id;
          const out = r.last_started_stage != null && stage && r.last_started_stage < stage.nr;
          return (
            <div key={r.id} className={`rider-row ${isSel ? 'selected' : ''} ${out ? 'disabled' : ''}`}>
              <span className="flag" onClick={() => !out && toggle(r.id)}>{flag(r.nationality)}</span>
              <div className="info" onClick={() => !out && toggle(r.id)}>
                <div className="name">
                  {r.name}
                  {isCaptain && <span className="badge-captain">KOPMAN</span>}
                  {out && <span className="chip chip-grijs">uitgevallen</span>}
                </div>
                <div className="sub">{r.team_name}</div>
              </div>
              <span className={typeChipClass(r.type)} onClick={() => !out && toggle(r.id)}>{r.type}</span>
              {isSel && !locked && (
                <button className={`capbtn ${isCaptain ? 'captain' : ''}`} onClick={() => setCaptainId(r.id)} title="Maak kopman" aria-label="Maak kopman">
                  ★
                </button>
              )}
              {!locked && (
                <input type="checkbox" checked={isSel} readOnly onClick={() => !out && toggle(r.id)} style={{ width: 19, height: 19, accentColor: '#FFD100' }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
