import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, euro, euroShort, flag, Rider, typeChipClass } from '../api';
import { PlusIcon, MinusIcon } from '../components/Icons';
import { useSession } from '../App';

const TEAM_SIZE = 20;
const MIN_PRICE = 500_000;
const MAX_PER_TEAM = 4;

function Qual({ q }: { q: Record<string, number> }) {
  const best = Object.entries(q).sort((a, b) => b[1] - a[1]).slice(0, 2);
  if (best.length === 0) return null;
  return (
    <>
      {best.map(([k, v]) => (
        <span key={k} style={{ whiteSpace: 'nowrap' }}>
          {' · '}{k}
          <span className="qual">
            {[2, 4, 6, 8, 10].map((t) => <i key={t} className={v >= t ? 'on' : ''} />)}
          </span>
        </span>
      ))}
    </>
  );
}

export default function Team() {
  const [riders, setRiders] = useState<Rider[]>([]);
  const [budget, setBudget] = useState(45_000_000);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [locked, setLocked] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showTeam, setShowTeam] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const { refresh } = useSession();

  useEffect(() => {
    Promise.all([api('/api/riders'), api('/api/team')]).then(([r, t]) => {
      setRiders(r.riders);
      setBudget(r.budget);
      setSelected(new Set(t.riderIds));
      setLocked(t.locked);
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

  const types = useMemo(() => [...new Set(riders.map((r) => r.type))], [riders]);

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
      setMsg({
        kind: 'success',
        text: res.complete ? 'Team opgeslagen — compleet. Veel succes!' : `Team opgeslagen (${res.count}/${TEAM_SIZE})`,
      });
      refresh();
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    }
  };

  const visible = riders.filter((r) => {
    if (showTeam && !selected.has(r.id)) return false;
    if (search && !(r.name + ' ' + r.team_name).toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter && r.type !== typeFilter) return false;
    return true;
  });

  const RiderRow = ({ r }: { r: Rider }) => {
    const isSel = selected.has(r.id);
    const disabled = !isSel && !canAdd(r);
    return (
      <div
        className={`rider-row ${isSel ? 'selected' : ''} ${disabled && !locked ? 'disabled' : ''}`}
        onClick={() => (isSel || !disabled) && toggle(r)}
      >
        <span className="flag">{flag(r.nationality)}</span>
        <div className="info">
          <div className="name">{r.name}</div>
          <div className="sub">{r.team_name}<Qual q={r.qualities} /></div>
        </div>
        <span className={typeChipClass(r.type)}>{r.type}</span>
        <span className="price">{euroShort(r.price)}</span>
        {!locked && (
          <button className={`addbtn ${isSel ? 'added' : ''}`} aria-label={isSel ? 'Verwijderen' : 'Toevoegen'}>
            {isSel ? <MinusIcon size={16} /> : <PlusIcon size={16} />}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="fade-in">
      <h1>Teamselectie</h1>
      <p className="page-sub">
        Kies {TEAM_SIZE} renners binnen je budget, maximaal {MAX_PER_TEAM} per ploeg. <Link to="/regels">Spelregels →</Link>
      </p>
      {locked && <div className="error">De teamselectie is vergrendeld — etappe 1 is gestart. Je kunt je team niet meer wijzigen.</div>}

      <div className="summary">
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

      <input placeholder="Zoek renner of ploeg…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="pill-select" style={{ marginTop: 8 }}>
        <button className={showTeam ? 'active' : ''} onClick={() => setShowTeam(!showTeam)}>Mijn team ({selected.size})</button>
        <button className={typeFilter === '' && !showTeam ? 'active' : ''} onClick={() => { setTypeFilter(''); setShowTeam(false); }}>Alle</button>
        {types.map((t) => (
          <button key={t} className={typeFilter === t && !showTeam ? 'active' : ''} onClick={() => { setTypeFilter(typeFilter === t ? '' : t); setShowTeam(false); }}>{t}</button>
        ))}
      </div>

      <div className="card flush">
        {visible.map((r) => <RiderRow key={r.id} r={r} />)}
        {visible.length === 0 && (
          <div className="empty">
            <div className="emoji">🔍</div>
            Geen renners gevonden{showTeam ? ' in je team' : ''}.
          </div>
        )}
      </div>
    </div>
  );
}
