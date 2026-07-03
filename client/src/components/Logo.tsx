export function Moustache({ size = 28, color = '#FFD100' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size / 2} viewBox="0 0 64 32" fill={color} aria-hidden>
      <path d="M32 14 C27 6 16 4 9 9 C3 13 3 21 9 24 C6 25 4 24 2 22 C3 28 11 32 18 28 C25 24 29 19 32 14 Z" />
      <path d="M32 14 C37 6 48 4 55 9 C61 13 61 21 55 24 C58 25 60 24 62 22 C61 28 53 32 46 28 C39 24 35 19 32 14 Z" />
    </svg>
  );
}

export function Logo({ light = true }: { light?: boolean }) {
  return (
    <span className="logo" aria-label="Snorito">
      <Moustache size={30} />
      <span className="logo-word" style={{ color: light ? '#fff' : '#0E1420' }}>
        SN<span className="logo-o">O</span>RITO
      </span>
    </span>
  );
}
