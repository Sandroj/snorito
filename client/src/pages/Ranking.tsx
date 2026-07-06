import { useEffect, useState } from 'react';
import { api, euroShort } from '../api';
import { PointsBreakdown, BreakdownRow } from '../components/PointsBreakdown';

interface RankRow {
  position: number;
  userId: number;
  name: string;
  total: number;
  lastStage: number;
  finalPoints: number;
  isMe: boolean;
}

interface Pool { id: number; name: string; }

interface TeamRider { id: number; name: string; price: number; type: string; team_name: string; }
interface Participant {
  userId: number;
  name: string;
  team: TeamRider[];
  scores: { stageNr: number; points: number }[];
  total: number;
}

// Detailweergave van één deelnemer: scores per etappe (uitklapbaar met
// puntenuitsplitsing) en het team van 20. Opstellingen van nog niet gestarte
// etappes geeft de server bewust niet terug.
function ParticipantDetail({ userId, onBack }: { userId: number; onBack: () => void }) {
  const [data, setData] = useState<Participant | null>(null);
  const [openStage, setOpenStage] = useState<number | null>(null);
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([]);
  const [showTeam, setShowTeam] = useState(false);

  useEffect(() => {
    api(`/api/participants/${userId}`).then(setData);
  }, [userId]);

  useEffect(() => {
    if (openStage == null) return;
    setBreakdown([]);
    api(`/api/participants/${userId}/points/${openStage}`).then((r) => setBreakdown(r.breakdown));
  }, [userId, openStage]);

  if (!data) return <div className="center" style={{ margin: 40, color: '#667085' }}>Laden…</div>;

  const label = (nr: number) => (nr === 0 ? 'Eindklassement' : `Etappe ${nr}`);

  return (
    <div className="fade-in">
      <button className="btn btn-ghost btn-sm" onClick={onBack}>← Terug naar klassement</button>
      <div className="total-hero" style={{ marginTop: 12 }}>
        <div className="lab">{data.name}</div>
        <div className="big">{data.total}</div>
        <div className="lab" style={{ letterSpacing: 0, textTransform: 'none' }}>punten totaal</div>
      </div>

      <div className="section-label">Scores per etappe</div>
      {data.scores.length === 0 && (
        <div className="card empty"><div className="emoji">⏱️</div>Nog geen verwerkte etappes.</div>
      )}
      {data.scores.map((s) => (
        <div key={s.stageNr} className="card">
          <div className="acc-head" onClick={() => setOpenStage(openStage === s.stageNr ? null : s.stageNr)}>
            <b>{label(s.stageNr)}</b>
            <span className="pts">{s.points} pt</span>
          </div>
          {openStage === s.stageNr && <PointsBreakdown rows={breakdown} />}
        </div>
      ))}

      <div className="section-label">Team</div>
      <div className="card">
        <div className="acc-head" onClick={() => setShowTeam(!showTeam)}>
          <b>Team van {data.team.length} renners</b>
          <span className="muted">{showTeam ? 'verberg' : 'toon'}</span>
        </div>
        {showTeam && (
          <table style={{ marginTop: 10 }}>
            <tbody>
              {data.team.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name}
                    <div className="muted" style={{ fontSize: 11 }}>{r.team_name}</div>
                  </td>
                  <td className="num muted">{r.type}</td>
                  <td className="num">{euroShort(r.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {showTeam && data.team.length === 0 && <p className="muted">Nog geen team samengesteld.</p>}
      </div>
    </div>
  );
}

export default function Ranking() {
  const [pools, setPools] = useState<Pool[]>([]);
  const [poolId, setPoolId] = useState<number | 'all'>('all');
  const [rows, setRows] = useState<RankRow[]>([]);
  const [lastStage, setLastStage] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    api('/api/pools').then((p) => setPools(p.pools));
  }, []);

  useEffect(() => {
    const q = poolId === 'all' ? '' : `?poolId=${poolId}`;
    api(`/api/ranking${q}`).then((r) => {
      setRows(r.ranking);
      setLastStage(r.lastFinishedStage);
    });
  }, [poolId]);

  if (selected != null) {
    return <ParticipantDetail userId={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="fade-in">
      <h1>Klassement</h1>
      <p className="page-sub">
        {lastStage ? `Stand na etappe ${lastStage} · tik op een deelnemer voor team en scores.` : 'De Tour is nog niet begonnen — iedereen staat op nul.'}
      </p>

      <div className="pill-select">
        <button className={poolId === 'all' ? 'active' : ''} onClick={() => setPoolId('all')}>Algemeen</button>
        {pools.map((p) => (
          <button key={p.id} className={poolId === p.id ? 'active' : ''} onClick={() => setPoolId(p.id)}>{p.name}</button>
        ))}
      </div>

      <div className="card flush">
        <table>
          <thead>
            <tr>
              <th style={{ width: 40, paddingLeft: 16 }}>#</th>
              <th>Deelnemer</th>
              <th className="num">{lastStage ? `Et. ${lastStage}` : 'Laatste'}</th>
              <th className="num" style={{ paddingRight: 16 }}>Totaal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.userId}
                className={r.isMe ? 'me' : ''}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected(r.userId)}
              >
                <td style={{ paddingLeft: 16 }}>{r.position}</td>
                <td>{r.name}{r.isMe ? ' (jij)' : ''}</td>
                <td className="num">{lastStage ? r.lastStage : '—'}</td>
                <td className="num" style={{ paddingRight: 16 }}><b>{r.total}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty"><div className="emoji">🏆</div>Nog geen deelnemers.</div>}
      </div>
    </div>
  );
}
