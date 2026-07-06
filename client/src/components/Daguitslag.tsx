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
}

export interface StageDetail {
  stageNr: number;
  type?: string;
  behaald?: number;
  gemist?: number;
  gemistCount?: number;
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
      </div>

      <div className="daguitslag-label">Jouw opstelling</div>
      <PointTable rows={d.lineup ?? []} empty="Geen opstelling voor deze etappe." />

      <div className="daguitslag-label">
        Niet opgesteld <span className="legend">punten die je misliep</span>
      </div>
      <PointTable rows={d.bench ?? []} empty="Alle renners uit je team stonden opgesteld." />
    </div>
  );
}
