import type { ReactNode } from 'react';
import { flag, typeChipClass } from '../api';
import { Shirt } from './Quality';

// Compacte rennerweergave zoals bij de teamselectie (shirt + vlag + naam +
// type-chip + ploegnaam), maar zonder de kwaliteiten. Gebruikt in het
// klassement: de teamlijst en de puntenuitsplitsing per etappe.
export function RiderInfo({
  shirt, nationality, name, type, team, extra, retired,
}: {
  shirt: string | null;
  nationality: string;
  name: string;
  type?: string;
  team: string;
  extra?: ReactNode;
  retired?: boolean;
}) {
  return (
    <div className="rider-cell">
      <Shirt url={shirt} size={28} />
      <div className="rider-cell-info">
        <div className="rider-cell-name">
          <span className="flag">{flag(nationality)}</span>
          <span className="nm">{name}{extra}</span>
          {retired && <span className="chip chip-grijs" title="Uitgevallen">UIT</span>}
          {type && <span className={typeChipClass(type)}>{type}</span>}
        </div>
        <div className="rider-cell-team">{team}</div>
      </div>
    </div>
  );
}
