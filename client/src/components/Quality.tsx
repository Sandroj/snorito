// Toont een kwaliteitswaarde (schaal 0-10) als 5 bolletjes, elk 2 punten waard.
// Halve stappen worden ondersteund: waarde 7 => 3,5 bolletje.
export function QualityDots({ value }: { value: number }) {
  return (
    <span className="qdots" aria-label={`${value} van 10`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const frac = Math.max(0, Math.min(1, (value - i * 2) / 2));
        return (
          <span key={i} className="qdot">
            <span style={{ width: `${frac * 100}%` }} />
          </span>
        );
      })}
    </span>
  );
}

export function QualityTag({ name, value }: { name: string; value: number }) {
  return (
    <span className="qtag">
      <span className="qtag-name">{name}</span>
      <QualityDots value={value} />
    </span>
  );
}

// Shirt-thumbnail met nette fallback als de afbeelding niet laadt.
export function Shirt({ url, size = 30 }: { url: string | null; size?: number }) {
  if (!url) return <span className="shirt shirt-fallback" style={{ width: size, height: size }} />;
  return (
    <img
      className="shirt"
      src={url}
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
      alt=""
    />
  );
}
