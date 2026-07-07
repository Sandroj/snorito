import { RiderInfo } from './RiderInfo';
import { PointsBreakdown, BreakdownRow } from './PointsBreakdown';

export interface PointRow {
  riderId: number;
  name: string;
  nationality: string;
  type: string;
  team: string;
  teamShirt: string | null;
  position: number | null;
  isCaptain: boolean;
  stagePoints: number;
  classPoints: number;
  teamPoints: number;
  total: number;
  swapIn?: boolean;
}

export interface StageDetail {
  stageNr: number;
  type?: string;
  behaald?: number;
  gemist?: number;
  gemistCount?: number;
  gemistKopman?: number;
  lineup?: PointRow[];
  bench?: PointRow[];
  final?: boolean;
  breakdown?: BreakdownRow[];
}

const posLabel = (p: number | null) => (p == null ? '—' : String(p));
const captainChip = (isCaptain: boolean) =>
  isCaptain ? <span className="chip chip-geel" style={{ marginLeft: 6 }} title="Kopman">K</span> : null;

function PointTable({ rows, empty }: { rows: PointRow[]; empty: string }) {
  if (rows.length === 0) return <p className="muted" style={{ margin: '8px 2px' }}>{empty}</p>;
  return (
    <table className="daguitslag">
      <thead>
        <tr>
          <th className="pos-h">#</th>
          <th>Renner</th>
          <th className="num col-detail">Rit</th>
          <th className="num col-detail">Klass.</th>
          <th className="num col-detail">Team</th>
          <th className="num">Tot.</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.riderId} className={r.swapIn ? 'swap-in' : ''}>
            <td className="pos">{posLabel(r.position)}</td>
            <td>
              <RiderInfo shirt={r.teamShirt} nationality={r.nationality} name={r.name} team={r.team} extra={captainChip(r.isCaptain)} />
              {/* Op mobiel vervangt dit regeltje de aparte Rit/Klass/Team-kolommen. */}
              <div className="mobile-breakdown">Rit {r.stagePoints} · Klas {r.classPoints} · Team {r.teamPoints}</div>
            </td>
            <td className="num col-detail">{r.stagePoints}</td>
            <td className="num col-detail">{r.classPoints}</td>
            <td className="num col-detail">{r.teamPoints}</td>
            <td className="num"><b>{r.total}</b></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Puntenoverzicht van één etappe: je opstelling (behaalde punten) en je bank
// (de punten die de niet-opgestelde renners zouden hebben opgeleverd).
export function Daguitslag({ d }: { d: StageDetail }) {
  if (d.final && d.breakdown) return <PointsBreakdown rows={d.breakdown} />;

  return (
    <div>
      <div className="daguitslag-summary">
        <span>Behaald <b>{d.behaald ?? 0}</b> pt</span>
        {(d.gemistCount ?? 0) > 0 && (
          <span className="gemist">
            Misgelopen <b>{d.gemist}</b> pt · {d.gemistCount} bankzitter{(d.gemistCount ?? 0) > 1 ? 's' : ''}
          </span>
        )}
        {(d.gemistKopman ?? 0) > 0 && (
          <span className="gemist">
            Andere kopman <b>+{d.gemistKopman}</b> pt
          </span>
        )}
      </div>

      <div className="daguitslag-label">Jouw opstelling</div>
      <PointTable rows={d.lineup ?? []} empty="Geen opstelling voor deze etappe." />

      <div className="daguitslag-label">
        Niet opgesteld <span className="legend">groen = had je opstelling verbeterd</span>
      </div>
      <PointTable rows={d.bench ?? []} empty="Alle renners uit je team stonden opgesteld." />
    </div>
  );
}
