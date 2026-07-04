import { useEffect, useMemo, useState } from 'react';
import { api, Rider, Stage, stageLabel } from '../api';

interface AdminStage extends Stage {
  hasResult: boolean;
  result_source: 'auto' | 'manual' | null;
  sync_checked_at: string | null;
  sync_error: string | null;
}
interface CyclingTeam { id: number; name: string; }
interface AdminUser {
  id: number;
  name: string;
  email: string;
  is_admin: number;
  has_google: boolean;
  created_at: string;
  last_login_at: string | null;
  team_count: number;
}

const fmtDT = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

const CLS_LABELS: Record<string, string> = {
  alg: 'Algemeen klassement (top 5)',
  punt: 'Puntenklassement (top 5)',
  berg: 'Bergklassement (top 5)',
  jong: 'Jongerenklassement (top 5)',
};

function RiderInput({ riders, value, onChange, placeholder }: {
  riders: Rider[];
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
}) {
  const byName = useMemo(() => new Map(riders.map((r) => [r.name, r.id])), [riders]);
  const name = riders.find((r) => r.id === value)?.name ?? '';
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name]);

  return (
    <input
      list="rider-list"
      value={text}
      placeholder={placeholder || 'Renner…'}
      onChange={(e) => {
        setText(e.target.value);
        const id = byName.get(e.target.value);
        onChange(id ?? null);
      }}
    />
  );
}

export default function Admin() {
  const [stages, setStages] = useState<AdminStage[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [teams, setTeams] = useState<CyclingTeam[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [positions, setPositions] = useState<(number | null)[]>(Array(20).fill(null));
  const [tttPositions, setTttPositions] = useState<(number | null)[]>(Array(8).fill(null));
  const [cls, setCls] = useState<Record<string, (number | null)[]>>({
    alg: Array(5).fill(null), punt: Array(5).fill(null), berg: Array(5).fill(null), jong: Array(5).fill(null),
  });
  const [finalStandings, setFinalStandings] = useState<Record<string, (number | null)[]>>({
    alg: Array(20).fill(null), punt: Array(10).fill(null), berg: Array(10).fill(null), jong: Array(5).fill(null),
  });
  const [showFinal, setShowFinal] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [withdrawRider, setWithdrawRider] = useState<number | null>(null);
  const [withdrawStage, setWithdrawStage] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);

  const load = () => api('/api/admin/overview').then((r) => setStages(r.stages));

  useEffect(() => {
    load();
    api('/api/riders').then((r) => setRiders(r.riders));
    api('/api/admin/teams').then((r) => setTeams(r.teams));
    api('/api/admin/users').then((r) => setUsers(r.users));
  }, []);

  const setSource = async (nr: number, source: 'auto' | 'manual') => {
    await api(`/api/admin/stage/${nr}/source`, { method: 'PUT', json: { source } });
    load();
  };

  const stage = stages.find((s) => s.nr === sel) || null;

  const padTo = (arr: (number | undefined)[] = [], n: number) => {
    const out: (number | null)[] = Array(n).fill(null);
    arr.forEach((v, i) => { if (v != null && i < n) out[i] = v; });
    return out;
  };

  useEffect(() => {
    if (sel == null) return;
    setMsg(null);
    api(`/api/admin/stage/${sel}/result`).then((r) => {
      const pos = Array(20).fill(null);
      for (const p of r.positions) pos[p.position - 1] = p.rider_id;
      setPositions(pos);
      const ttt = Array(8).fill(null);
      for (const p of r.tttPositions) ttt[p.position - 1] = p.team_id;
      setTttPositions(ttt);
      setCls({
        alg: padTo(r.classifications.alg, 5),
        punt: padTo(r.classifications.punt, 5),
        berg: padTo(r.classifications.berg, 5),
        jong: padTo(r.classifications.jong, 5),
      });
    });
  }, [sel]);

  const setStatus = async (nr: number, status: string) => {
    await api(`/api/admin/stage/${nr}/status`, { method: 'PUT', json: { status } });
    load();
  };

  const saveResult = async () => {
    if (sel == null || !stage) return;
    setMsg(null);
    try {
      await api(`/api/admin/stage/${sel}/result`, {
        method: 'PUT',
        json: {
          positions: positions.map((riderId, i) => ({ position: i + 1, riderId })).filter((p) => p.riderId),
          tttPositions: tttPositions.map((teamId, i) => ({ position: i + 1, teamId })).filter((p) => p.teamId),
          classifications: cls,
        },
      });
      setMsg({ kind: 'success', text: 'Uitslag opgeslagen' });
      load();
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    }
  };

  const processStage = async () => {
    if (sel == null) return;
    try {
      await api(`/api/admin/stage/${sel}/process`, { method: 'POST' });
      setMsg({ kind: 'success', text: `Etappe ${sel} verwerkt — punten en klassementen zijn bijgewerkt` });
      load();
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    }
  };

  const saveFinal = async () => {
    setMsg(null);
    try {
      await api('/api/admin/final', { method: 'PUT', json: { standings: finalStandings } });
      await api('/api/admin/final/process', { method: 'POST' });
      setMsg({ kind: 'success', text: 'Eindklassement opgeslagen en verwerkt' });
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    }
  };

  const saveWithdrawn = async () => {
    if (!withdrawRider) return;
    await api(`/api/admin/rider/${withdrawRider}/withdrawn`, {
      method: 'PUT',
      json: { lastStartedStage: withdrawStage === '' ? null : Number(withdrawStage) },
    });
    setMsg({ kind: 'success', text: 'Rennerstatus bijgewerkt' });
    api('/api/riders').then((r) => setRiders(r.riders));
  };

  return (
    <div className="fade-in">
      <h1>Beheer</h1>
      <p className="page-sub">Etappes beheren, uitslagen invoeren en verwerken.</p>
      {msg && <div className={msg.kind}>{msg.text}</div>}

      <datalist id="rider-list">
        {riders.map((r) => <option key={r.id} value={r.name}>{r.team_name}</option>)}
      </datalist>

      {stages.some((s) => s.sync_error) && (
        <div className="error">
          <b>PCS-sync-fouten:</b>
          {stages.filter((s) => s.sync_error).map((s) => (
            <div key={s.nr}>Etappe {s.nr}: {s.sync_error}</div>
          ))}
          <div style={{ marginTop: 4, fontSize: 13 }}>Voer de uitslag handmatig in of corrigeer de data; de sync probeert het elke 10 minuten opnieuw.</div>
        </div>
      )}

      <div className="card flush">
        <table>
          <thead>
            <tr>
              <th style={{ paddingLeft: 16 }}>Etappe</th>
              <th>Status</th>
              <th>Uitslag</th>
              <th>Bron</th>
              <th style={{ paddingRight: 16 }}></th>
            </tr>
          </thead>
          <tbody>
            {stages.map((s) => (
              <tr key={s.nr}>
                <td style={{ paddingLeft: 16 }}>
                  <b>{s.nr}.</b> {s.van} → {s.naar} {s.type !== 'rit' && <span className="chip chip-navy">{s.type}</span>}
                </td>
                <td>
                  <select value={s.status} onChange={(e) => setStatus(s.nr, e.target.value)} style={{ width: 'auto', padding: '5px 8px', fontSize: 13 }}>
                    <option value="open">open</option>
                    <option value="started">gestart</option>
                    <option value="finished">verwerkt</option>
                  </select>
                </td>
                <td>{s.hasResult ? '✓' : '—'}</td>
                <td>
                  {s.result_source === 'manual' ? (
                    <>
                      <span className="chip chip-oranje" title={`Handmatig aangepast — de PCS-autosync blijft van deze etappe af.${s.sync_checked_at ? ` Laatste sync-check: ${fmtDT(s.sync_checked_at)}` : ''}`}>handmatig</span>
                      <button className="btn btn-ghost btn-sm" title="Autosync weer aanzetten voor deze etappe" onClick={() => setSource(s.nr, 'auto')}>auto aan</button>
                    </>
                  ) : s.result_source === 'auto' ? (
                    <span className="chip chip-groen" title={`Automatisch geïmporteerd van ProCyclingStats.${s.sync_checked_at ? ` Laatste sync-check: ${fmtDT(s.sync_checked_at)}` : ''}`}>auto</span>
                  ) : '—'}
                  {s.sync_error && <span title={`Sync-fout: ${s.sync_error}`} style={{ cursor: 'help' }}> ⚠️</span>}
                </td>
                <td style={{ paddingRight: 16 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSel(s.nr)}>Uitslag</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {stage && (
        <div className="card">
          <h2>Uitslag invoeren — {stageLabel(stage)}</h2>

          {stage.type === 'TTT' ? (
            <>
              <p className="muted">Ploegentijdrit: voer de top 8 ploegen in.</p>
              {tttPositions.map((teamId, i) => (
                <div className="pos-grid" key={i}>
                  <span className="nr">{i + 1}.</span>
                  <select value={teamId ?? ''} onChange={(e) => {
                    const next = [...tttPositions];
                    next[i] = e.target.value ? Number(e.target.value) : null;
                    setTttPositions(next);
                  }}>
                    <option value="">— ploeg —</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              ))}
            </>
          ) : (
            <>
              <p className="muted">Voer de top 20 van de daguitslag in (typ om te zoeken).</p>
              {positions.map((riderId, i) => (
                <div className="pos-grid" key={i}>
                  <span className="nr">{i + 1}.</span>
                  <RiderInput riders={riders} value={riderId} onChange={(id) => {
                    const next = [...positions];
                    next[i] = id;
                    setPositions(next);
                  }} />
                </div>
              ))}
            </>
          )}

          <h2 style={{ marginTop: 18 }}>Klassementstanden na deze etappe</h2>
          <p className="muted">Top 5 per klassement. Bij de ploegentijdrit: voor punten-/bergklassement alleen de leider (positie 1) invullen.</p>
          {Object.keys(CLS_LABELS).map((key) => (
            <div key={key}>
              <label>{CLS_LABELS[key]}</label>
              {cls[key].map((riderId, i) => (
                <div className="pos-grid" key={i}>
                  <span className="nr">{i + 1}.</span>
                  <RiderInput riders={riders} value={riderId} onChange={(id) => {
                    setCls((prev) => {
                      const next = { ...prev, [key]: [...prev[key]] };
                      next[key][i] = id;
                      return next;
                    });
                  }} />
                </div>
              ))}
            </div>
          ))}

          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={saveResult}>Alleen opslaan</button>
            <button className="btn btn-primary" onClick={async () => { await saveResult(); await processStage(); }}>
              Opslaan &amp; verwerken
            </button>
          </div>
        </div>
      )}

      <div className="section-label">Renners</div>
      <div className="card">
        <h2>Renner uitgevallen</h2>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <div style={{ flex: 1 }}>
            <RiderInput riders={riders} value={withdrawRider} onChange={setWithdrawRider} placeholder="Zoek renner…" />
          </div>
          <input
            style={{ width: 150, flexShrink: 0 }}
            type="number"
            placeholder="Laatste etappe"
            value={withdrawStage}
            onChange={(e) => setWithdrawStage(e.target.value)}
          />
          <button className="btn btn-ghost" style={{ flexShrink: 0 }} onClick={saveWithdrawn}>Opslaan</button>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>Leeg = actief. Waarde X = startte etappe X nog wel, daarna niet meer.</p>
      </div>

      <div className="section-label">Eindklassement</div>
      <div className="card">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>Eindklassementen invoeren</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowFinal(!showFinal)}>
            {showFinal ? 'Verbergen' : 'Invoeren'}
          </button>
        </div>
        {showFinal && (
          <>
            {Object.entries({ alg: 'Algemeen (top 20)', punt: 'Punten (top 10)', berg: 'Berg (top 10)', jong: 'Jongeren (top 5)' }).map(([key, label]) => (
              <div key={key}>
                <label>{label}</label>
                {finalStandings[key].map((riderId, i) => (
                  <div className="pos-grid" key={i}>
                    <span className="nr">{i + 1}.</span>
                    <RiderInput riders={riders} value={riderId} onChange={(id) => {
                      setFinalStandings((prev) => {
                        const next = { ...prev, [key]: [...prev[key]] };
                        next[key][i] = id;
                        return next;
                      });
                    }} />
                  </div>
                ))}
              </div>
            ))}
            <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={saveFinal}>
              Eindklassement opslaan &amp; verwerken
            </button>
          </>
        )}
      </div>

      <div className="section-label">Gebruikers</div>
      <div className="card flush">
        <p style={{ padding: '12px 16px 0', margin: 0 }}><b>{users.length}</b> geregistreerde gebruikers</p>
        <table>
          <thead>
            <tr>
              <th style={{ paddingLeft: 16 }}>Naam</th>
              <th>E-mail</th>
              <th>Geregistreerd</th>
              <th>Laatste login</th>
              <th style={{ paddingRight: 16 }}>Team</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={{ paddingLeft: 16 }}>
                  {u.name}
                  {!!u.is_admin && <span className="chip chip-navy" style={{ marginLeft: 6 }}>admin</span>}
                  {u.has_google && <span className="chip chip-grijs" style={{ marginLeft: 6 }}>Google</span>}
                </td>
                <td className="muted">{u.email}</td>
                <td>{fmtDT(u.created_at)}</td>
                <td>{fmtDT(u.last_login_at)}</td>
                <td style={{ paddingRight: 16 }}>{u.team_count > 0 ? `${u.team_count}/20` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
