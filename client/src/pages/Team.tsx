import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, euro, euroShort, flag, Rider, CyclingTeam, QUALITIES, typeChipClass } from '../api';
import { PlusIcon, MinusIcon } from '../components/Icons';
import { QualityDots, QualityTag, Shirt } from '../components/Quality';
import { useSession } from '../App';

const TEAM_SIZE = 20;
const MIN_PRICE = 500_000;
const MAX_PER_TEAM = 4;

type Cat = 'all' | 'mine' | (typeof QUALITIES)[number];

export default function Team() {
  const [riders, setRiders] = useState<Rider[]>([]);
  const [teams, setTeams] = useState<CyclingTeam[]>([]);
  const [budget, setBudget] = useState(45_000_000);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [locked, setLocked] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'renners' | 'teams'>('renners');
  const [cat, setCat] = useState<Cat>('all');
  const [teamId, setTeamId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const { refresh } = useSession();

  useEffect(() => {
    Promise.all([api('/api/riders'), api('/api/team'), api('/api/teams')]).then(([r, t, tm]) => {
      setRiders(r.riders);
      setBudget(r.budget);
      setSelected(new Set(t.riderIds));
      setLocked(t.locked);
      setTeams(tm.teams);
    });
  }, []);

  const selectedRiders = riders.filter((r) => selected.has(r.id));
  const spent = selectedRiders.reduce((s, r) => s + r.price, 0);
  const remaining = budget - spent;
  const slotsLeft = TEAM_SIZE - selected.size;
  const reserveNeeded = Math.max(0, slotsLeft - 1) * MIN_PRICE;

  const perTeamCount = useMemo(() => {
    const m: Record<number, number> = {};
    for (const r of selectedRiders) m[r.team_id] = (m[r.team_id] || 0) + 1;
    return m;
  }, [selectedRiders]);

  const canAdd = (r: Rider) => {
    if (selected.size >= TEAM_SIZE) return false;
    if ((perTeamCount[r.team_id] || 0) >= MAX_PER_TEAM) return false;
    if (r.price > remaining - reserveNeeded) return false;
    return true;
  };

  const toggle = (r: Rider) => {
    if (locked) return;
    setMsg(null);
    const next = new Set(selected);
    if (next.has(r.id)) next.delete(r.id);
    else { if (!canAdd(r)) return; next.add(r.id); }
    setSelected(next);
  };

  const save = async () => {
    setMsg(null);
    try {
      const res = await api('/api/team', { method: 'PUT', json: { riderIds: [...selected] } });
      setMsg({ kind: 'success', text: res.complete ? 'Team opgeslagen — compleet. Veel succes!' : `Team opgeslagen (${res.count}/${TEAM_SIZE})` });
      refresh();
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    }
  };

  const activeTeam = teamId != null ? teams.find((t) => t.id === teamId) : null;

  const visible = useMemo(() => {
    let list = riders;
    if (teamId != null) list = list.filter((r) => r.team_id === teamId);
    else if (cat === 'mine') list = list.filter((r) => selected.has(r.id));
    else if (cat !== 'all') list = list.filter((r) => (r.qualities[cat] ?? 0) > 0);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((r) => (r.name + ' ' + r.team_name).toLowerCase().includes(q));
    }
    const byQuality = cat !== 'all' && cat !== 'mine' && teamId == null;
    return [...list].sort((a, b) =>
      byQuality ? (b.qualities[cat as string] ?? 0) - (a.qualities[cat as string] ?? 0) || b.price - a.price : b.price - a.price
    );
  }, [riders, teamId, cat, selected, search]);

  const topQualities = (r: Rider, highlight?: string) => {
    const entries = Object.entries(r.qualities).filter(([, v]) => v > 0);
    entries.sort((a, b) => (b[0] === highlight ? 1 : 0) - (a[0] === highlight ? 1 : 0) || b[1] - a[1]);
    return entries.slice(0, 2);
  };

  const RiderRow = ({ r }: { r: Rider }) => {
    const isSel = selected.has(r.id);
    const disabled = !isSel && !canAdd(r);
    const highlight = cat !== 'all' && cat !== 'mine' ? (cat as string) : undefined;
    return (
      <div
        className={`rider-row ${isSel ? 'selected' : ''} ${disabled && !locked ? 'disabled' : ''}`}
        onClick={() => (isSel || !disabled) && toggle(r)}
      >
        <Shirt url={r.team_shirt} size={30} />
        <div className="info">
          <div className="name-line">
            <span className="flag">{flag(r.nationality)}</span>
            <span className="name">{r.name}</span>
            <span className={typeChipClass(r.type)}>{r.type}</span>
          </div>
          <div className="quals">
            {topQualities(r, highlight).map(([k, v]) => <QualityTag key={k} name={k} value={v} />)}
            {topQualities(r).length === 0 && <span className="muted" style={{ fontSize: 12 }}>{r.team_name}</span>}
          </div>
        </div>
        <div className="rider-right">
          <span className="price">{euroShort(r.price)}</span>
          {!locked && (
            <button className={`addbtn ${isSel ? 'added' : ''}`} aria-label={isSel ? 'Verwijderen' : 'Toevoegen'}>
              {isSel ? <MinusIcon size={16} /> : <PlusIcon size={16} />}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fade-in">
      <h1>Teamselectie</h1>
      <p className="page-sub">
        Kies {TEAM_SIZE} renners binnen je budget, max {MAX_PER_TEAM} per ploeg. <Link to="/regels">Spelregels →</Link>
      </p>
      {locked && <div className="error">De teamselectie is vergrendeld — etappe 1 is gestart.</div>}

      <div className="summary glass">
        <div className="stats">
          <div className="stat">
            <div className="lab">Budget over</div>
            <div className="val geel">{euro(remaining)}</div>
          </div>
          <div className="stat" style={{ textAlign: 'center' }}>
            <div className="lab">Renners</div>
            <div className="val">{selected.size}<small style={{ color: '#98A2B3' }}> / {TEAM_SIZE}</small></div>
          </div>
          <button className="btn btn-primary" onClick={save} disabled={locked}>Opslaan</button>
        </div>
        <div className="progress"><div style={{ width: `${(spent / budget) * 100}%` }} /></div>
      </div>
      {msg && <div className={msg.kind}>{msg.text}</div>}

      <div className="segmented">
        <button className={view === 'renners' ? 'on' : ''} onClick={() => setView('renners')}>Renners</button>
        <button className={view === 'teams' ? 'on' : ''} onClick={() => { setView('teams'); setTeamId(null); }}>Ploegen</button>
      </div>

      {view === 'teams' ? (
        <div className="teams-grid">
          {teams.map((t) => (
            <button key={t.id} className="team-card glass" onClick={() => { setTeamId(t.id); setCat('all'); setView('renners'); }}>
              <Shirt url={t.shirt} size={52} />
              <div className="team-card-name">{t.name}</div>
              <div className="team-card-meta">
                <span className={`chip ${(perTeamCount[t.id] || 0) >= MAX_PER_TEAM ? 'chip-geel' : 'chip-grijs'}`}>
                  {perTeamCount[t.id] || 0}/{MAX_PER_TEAM} gekozen
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <>
          <input placeholder="Zoek renner of ploeg…" value={search} onChange={(e) => setSearch(e.target.value)} />

          {activeTeam ? (
            <div className="team-filter-head glass">
              <Shirt url={activeTeam.shirt} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{activeTeam.name}</b>
                <div className="muted">{perTeamCount[activeTeam.id] || 0}/{MAX_PER_TEAM} gekozen</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setTeamId(null)}>Alle renners</button>
            </div>
          ) : (
            <div className="chip-filter">
              <button className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>Alle</button>
              <button className={cat === 'mine' ? 'on' : ''} onClick={() => setCat('mine')}>Mijn team ({selected.size})</button>
              {QUALITIES.map((q) => (
                <button key={q} className={cat === q ? 'on' : ''} onClick={() => setCat(q)}>{q}</button>
              ))}
            </div>
          )}

          <div className="card flush">
            {visible.map((r) => <RiderRow key={r.id} r={r} />)}
            {visible.length === 0 && (
              <div className="empty"><div className="emoji">🔍</div>Geen renners gevonden.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
