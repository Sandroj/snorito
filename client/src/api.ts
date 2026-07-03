export interface Rider {
  id: number;
  name: string;
  team_id: number;
  team_name: string;
  nationality: string;
  age: number;
  price: number;
  type: string;
  qualities: Record<string, number>;
  last_started_stage: number | null;
}

export interface Stage {
  nr: number;
  start: string;
  van: string;
  naar: string;
  km: number;
  terrain: string;
  type: 'rit' | 'ITT' | 'TTT';
  status: 'open' | 'started' | 'finished';
  image_url: string | null;
  description: string | null;
}

export interface User {
  id: number;
  name: string;
  email: string;
  isAdmin: boolean;
}

export interface Rules {
  budget: number;
  teamSize: number;
  maxPerTeam: number;
  lineupSize: number;
  minRiderPrice: number;
  captainFactor: number;
  stagePoints: number[];
  tttPoints: number[];
  classPointsAfterStage: Record<string, number[]>;
  teamPointsAfterStage: Record<string, number>;
  finalPoints: Record<string, number[]>;
  finalTeamPoints: Record<string, number>;
}

export async function api<T = any>(path: string, options?: RequestInit & { json?: any }): Promise<T> {
  const { json, ...rest } = options || {};
  const res = await fetch(path, {
    ...rest,
    headers: json ? { 'Content-Type': 'application/json', ...rest.headers } : rest.headers,
    body: json ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fout (${res.status})`);
  return data as T;
}

export const euro = (n: number) => '€ ' + n.toLocaleString('nl-NL');

export const euroShort = (n: number) =>
  n >= 1_000_000 ? `€ ${(n / 1_000_000).toLocaleString('nl-NL', { maximumFractionDigits: 2 })}M` : `€ ${(n / 1000).toFixed(0)}K`;

export const stageLabel = (s: Stage) =>
  `Etappe ${s.nr}${s.type !== 'rit' ? ` (${s.type})` : ''} · ${s.van} → ${s.naar}`;

// Scorito gebruikt deels eigen landcodes (NOO, POR); mapping naar ISO-2 voor vlag-emoji
const ISO2: Record<string, string> = {
  BEL: 'BE', AUS: 'AU', NLD: 'NL', ITA: 'IT', FRA: 'FR', SLO: 'SI', ESP: 'ES', CHE: 'CH',
  DNK: 'DK', IRL: 'IE', ECU: 'EC', POL: 'PL', USA: 'US', CZE: 'CZ', GBR: 'GB', ERI: 'ER',
  DEU: 'DE', COL: 'CO', MEX: 'MX', LUX: 'LU', AUT: 'AT', NOO: 'NO', NOR: 'NO', KAZ: 'KZ',
  LVA: 'LV', NZL: 'NZ', POR: 'PT', PRT: 'PT', CAN: 'CA',
};

export function flag(code3: string): string {
  const c2 = ISO2[code3];
  if (!c2) return '🏳️';
  return String.fromCodePoint(...[...c2].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

export const terrainLabel: Record<string, string> = { vlak: 'Vlak', heuvel: 'Heuvel', berg: 'Berg' };

export const typeChipClass = (type: string) => {
  switch (type) {
    case 'Klassement': return 'chip chip-geel';
    case 'Klimmer': return 'chip chip-rood';
    case 'Sprinter': return 'chip chip-groen';
    case 'Tijdrijder': return 'chip chip-blauw';
    case 'Aanvaller': return 'chip chip-oranje';
    default: return 'chip chip-grijs';
  }
};

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
