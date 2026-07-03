const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

type P = { size?: number };

export const ShirtIcon = ({ size = 22 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M8 3 L12 5 L16 3 L21 7 L18 10 L18 21 L6 21 L6 10 L3 7 Z" />
  </svg>
);

export const LineupIcon = ({ size = 22 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8 M8 12h8 M8 16h5" />
  </svg>
);

export const TrophyIcon = ({ size = 22 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M8 4h8v6a4 4 0 0 1-8 0Z" />
    <path d="M8 5H4c0 3 1.5 5 4 5 M16 5h4c0 3-1.5 5-4 5" />
    <path d="M12 14v3 M8 21h8 M10 21v-2h4v2" />
  </svg>
);

export const UsersIcon = ({ size = 22 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20c.6-3.4 2.9-5 5.5-5s4.9 1.6 5.5 5" />
    <circle cx="17" cy="9" r="2.4" />
    <path d="M16 15.2c2.2.2 4 1.6 4.5 4.3" />
  </svg>
);

export const StarIcon = ({ size = 22 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M12 3.5 14.6 9l5.9.6-4.4 4 1.3 5.9L12 16.4 6.6 19.5 7.9 13.6 3.5 9.6 9.4 9Z" />
  </svg>
);

export const BookIcon = ({ size = 22 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2Z" />
    <path d="M4 19V5 M20 15H6a2 2 0 0 0-2 2" />
  </svg>
);

export const GearIcon = ({ size = 22 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3 M12 18.5v3 M2.5 12h3 M18.5 12h3 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2" />
  </svg>
);

export const LogoutIcon = ({ size = 22 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8" />
    <path d="M17 8l4 4-4 4 M21 12H9" />
  </svg>
);

export const MountainIcon = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M3 19 9 8l4 6 3-4 5 9Z" />
  </svg>
);

export const ClockIcon = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const RouteIcon = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <circle cx="6" cy="19" r="2.2" />
    <circle cx="18" cy="5" r="2.2" />
    <path d="M8 19h7a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h7" transform="rotate(180 12 12)" />
  </svg>
);

export const CheckIcon = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M4.5 12.5 10 18 19.5 6.5" />
  </svg>
);

export const PlusIcon = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M12 5v14 M5 12h14" />
  </svg>
);

export const MinusIcon = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M5 12h14" />
  </svg>
);
