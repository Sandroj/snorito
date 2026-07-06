export interface BreakdownRow {
  riderId: number;
  name: string;
  team: string;
  isCaptain: boolean;
  stagePoints: number;
  classPoints: number;
  teamPoints: number;
  total: number;
}

// Puntenuitsplitsing per renner voor één etappe — gebruikt op "Mijn punten"
// en in de deelnemersweergave van het klassement.
export function PointsBreakdown({ rows }: { rows: BreakdownRow[] }) {
  if (rows.length === 0) {
    return <p className="muted" style={{ margin: '10px 0 4px' }}>Geen opstelling voor deze etappe.</p>;
  }
  return (
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
        {rows.map((b) => (
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
  );
}
