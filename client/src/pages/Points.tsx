import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

interface StageScore { stageNr: number; points: number; }

interface BreakdownRow {
  riderId: number;
  name: string;
  team: string;
  isCaptain: boolean;
  stagePoints: number;
  classPoints: number;
  teamPoints: number;
  total: number;
}

export default function Points() {
  const [scores, setScores] = useState<StageScore[]>([]);
  const [openStage, setOpenStage] = useState<number | null>(null);
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([]);

  useEffect(() => {
    api('/api/my/points').then((r) => setScores(r.scores));
  }, []);

  useEffect(() => {
    if (openStage == null) return;
    api(`/api/my/points/${openStage}`).then((r) => setBreakdown(r.breakdown));
  }, [openStage]);

  const total = scores.reduce((s, x) => s + x.points, 0);
  const label = (nr: number) => (nr === 0 ? 'Eindklassement' : `Etappe ${nr}`);

  return (
    <div className="fade-in">
      <h1>Mijn punten</h1>
      <div className="total-hero">
        <div className="lab">Totaalscore</div>
        <div className="big">{total}</div>
        <div className="lab" style={{ letterSpacing: 0, textTransform: 'none' }}>
          {scores.length > 0 ? `over ${scores.length} verwerkte ronde${scores.length !== 1 ? 's' : ''}` : 'nog geen etappes verwerkt'}
        </div>
      </div>

      {scores.length === 0 && (
        <div className="card empty">
          <div className="emoji">⏱️</div>
          Zodra de eerste etappe is verwerkt zie je hier je punten per etappe,<br />
          uitgesplitst per renner. <Link to="/regels"><b>Hoe verdien ik punten? →</b></Link>
        </div>
      )}

      {scores.map((s) => (
        <div key={s.stageNr} className="card">
          <div className="acc-head" onClick={() => setOpenStage(openStage === s.stageNr ? null : s.stageNr)}>
            <b>{label(s.stageNr)}</b>
            <span className="pts">{s.points} pt</span>
          </div>
          {openStage === s.stageNr && (
            <table style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Renner</th>
                  <th className="num">Rit</th>
                  <th className="num">Klass.</th>
                  <th className="num">Team</th>
                  <th className="num">Totaal</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((b) => (
                  <tr key={b.riderId}>
                    <td>
                      {b.name}{b.isCaptain ? ' ★' : ''}
                      <div className="muted" style={{ fontSize: 11 }}>{b.team}</div>
                    </td>
                    <td className="num">{b.stagePoints}</td>
                    <td className="num">{b.classPoints}</td>
                    <td className="num">{b.teamPoints}</td>
                    <td className="num"><b>{b.total}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}
