import { useEffect, useState } from 'react';
import { api } from '../api';

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

export default function Ranking() {
  const [pools, setPools] = useState<Pool[]>([]);
  const [poolId, setPoolId] = useState<number | 'all'>('all');
  const [rows, setRows] = useState<RankRow[]>([]);
  const [lastStage, setLastStage] = useState<number | null>(null);

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

  const hasScores = lastStage != null;
  const podium = hasScores ? rows.slice(0, 3) : [];
  const rest = hasScores ? rows.slice(3) : rows;
  const order = [1, 0, 2]; // zilver, goud, brons — goud in het midden

  return (
    <div className="fade-in">
      <h1>Klassement</h1>
      <p className="page-sub">{lastStage ? `Stand na etappe ${lastStage}.` : 'De Tour is nog niet begonnen — iedereen staat op nul.'}</p>

      <div className="pill-select">
        <button className={poolId === 'all' ? 'active' : ''} onClick={() => setPoolId('all')}>Algemeen</button>
        {pools.map((p) => (
          <button key={p.id} className={poolId === p.id ? 'active' : ''} onClick={() => setPoolId(p.id)}>{p.name}</button>
        ))}
      </div>

      {podium.length === 3 && (
        <div className="podium">
          {order.map((idx) => {
            const r = podium[idx];
            return (
              <div key={r.userId} className={`step ${r.position === 1 ? 'first' : ''}`}>
                <div className={`pos-circle p${r.position}`}>{r.position}</div>
                <div className="nm">{r.name}{r.isMe ? ' (jij)' : ''}</div>
                <div className="pts">{r.total}<small> pt</small></div>
              </div>
            );
          })}
        </div>
      )}

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
            {rest.map((r) => (
              <tr key={r.userId} className={r.isMe ? 'me' : ''}>
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
