import { flag } from '../api';
import { Shirt } from './Quality';
import { RiderInfo } from './RiderInfo';
import { PointsBreakdown, BreakdownRow } from './PointsBreakdown';

type Status = 'lineup' | 'bench' | 'none';

export interface LineupRow extends BreakdownRow {
  position: number | null;
}

export interface ResultRow {
  position: number;
  riderId: number;
  name: string;
  nationality: string;
  type: string;
  team: string;
  teamShirt: string | null;
  stagePoints: number;
  status: Status;
  isCaptain: boolean;
}

export interface TttTeam {
  position: number;
  teamName: string;
  teamShirt: string | null;
  points: number;
  status: Status;
  riders: { name: string; status: Status }[];
}

export interface StageDetail {
  stageNr: number;
  type?: string;
  behaald?: number;
  gemist?: number;
  gemistCount?: number;
  lineup?: LineupRow[];
  rows?: ResultRow[];
  teams?: TttTeam[];
  final?: boolean;
  breakdown?: BreakdownRow[];
}

const posLabel = (p: number | null) => (p == null ? '—' : String(p));
const captainChip = (isCaptain: boolean) =>
  isCaptain ? <span className="chip chip-geel" style={{ marginLeft: 6 }} title="Kopman">K</span> : null;

function Summary({ d }: { d: StageDetail }) {
  return (
    <div className="daguitslag-summary">
      <span>Behaald <b>{d.behaald ?? 0}</b> pt</span>
      {(d.gemistCount ?? 0) > 0 && (
        <span className="gemist">
          Misgelopen <b>{d.gemist}</b> pt · {d.gemistCount} bankzitter{(d.gemistCount ?? 0) > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

// Jouw opstelling: de 9 opgestelde renners met finishpositie en punten.
function LineupTable({ rows }: { rows: LineupRow[] }) {
  if (rows.length === 0) return <p className="muted" style={{ margin: '8px 2px' }}>Geen opstelling voor deze etappe.</p>;
  return (
    <table className="daguitslag">
      <thead>
        <tr>
          <th className="pos-h">#</th>
          <th>Renner</th>
          <th className="num">Rit</th>
          <th className="num">Klass.</th>
          <th className="num">Team</th>
          <th className="num">Tot.</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.riderId}>
            <td className="pos">{posLabel(r.position)}</td>
            <td>
              <RiderInfo shirt={r.teamShirt} nationality={r.nationality} name={r.name} team={r.team} extra={captainChip(r.isCaptain)} />
            </td>
            <td className="num">{r.stagePoints}</td>
            <td className="num">{r.classPoints}</td>
            <td className="num">{r.teamPoints}</td>
            <td className="num"><b>{r.total}</b></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StarCell({ status }: { status: Status }) {
  if (status === 'lineup') return <td className="star" title="Opgesteld">★</td>;
  if (status === 'bench') return <td className="star empty" title="In je team, niet opgesteld">☆</td>;
  return <td className="star" />;
}

// Daguitslag met opstelling-markering. Toont de dagopstelling en daaronder de
// scorende top 20 (of de ploegen bij een TTT), met ster-markering per renner.
export function Daguitslag({ d }: { d: StageDetail }) {
  if (d.final && d.breakdown) return <PointsBreakdown rows={d.breakdown} />;

  return (
    <div>
      <Summary d={d} />

      <div className="daguitslag-label">Jouw opstelling</div>
      <LineupTable rows={d.lineup ?? []} />

      <div className="daguitslag-label">
        Daguitslag <span className="legend">★ opgesteld · ☆ op de bank</span>
      </div>

      {d.type === 'TTT' && d.teams ? (
        <table className="daguitslag">
          <tbody>
            {d.teams.map((t) => (
              <tr key={t.position} className={`st-${t.status}`}>
                <td className="pos">{t.position}</td>
                <td>
                  <div className="rider-cell">
                    <Shirt url={t.teamShirt} size={28} />
                    <div className="rider-cell-info">
                      <div className="rider-cell-name"><span className="nm">{t.teamName}</span></div>
                      {t.riders.length > 0 && (
                        <div className="rider-cell-team">{t.riders.map((r) => r.name).join(', ')}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="num">{t.points}</td>
                <StarCell status={t.status} />
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="daguitslag">
          <tbody>
            {(d.rows ?? []).map((r) => (
              <tr key={r.riderId} className={`st-${r.status}`}>
                <td className="pos">{r.position}</td>
                <td>
                  <div className="rider-cell">
                    <Shirt url={r.teamShirt} size={28} />
                    <div className="rider-cell-info">
                      <div className="rider-cell-name">
                        <span className="flag">{flag(r.nationality)}</span>
                        <span className="nm">{r.name}</span>
                      </div>
                      <div className="rider-cell-team">{r.team}</div>
                    </div>
                  </div>
                </td>
                <td className="num">{r.stagePoints}{r.isCaptain ? ' ×2' : ''}</td>
                <StarCell status={r.status} />
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.type !== 'TTT' && (d.rows ?? []).length === 0 && (
        <p className="muted" style={{ margin: '8px 2px' }}>Nog geen daguitslag voor deze etappe.</p>
      )}
    </div>
  );
}
