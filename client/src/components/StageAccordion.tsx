import { useEffect, useState } from 'react';
import { api } from '../api';
import { Daguitslag, StageDetail } from './Daguitslag';

export interface AccordionStage {
  stageNr: number;
  points: number;
  label: string;
}

// Uitslagenlijst per etappe: bovenaan een dropdown met eerdere etappes,
// daaronder de laatste etappe — altijd volledig uitgeklapt. Kies je in de
// dropdown een eerdere etappe, dan klapt die volledig uit tussen dropdown en
// laatste etappe. Haalt de daguitslag-details zelf op (en cachet ze), zodat
// laatste én gekozen etappe tegelijk open kunnen staan.
export function StageAccordion({ stages, userId }: { stages: AccordionStage[]; userId: number }) {
  const [details, setDetails] = useState<Record<number, StageDetail>>({});
  const [prevOpen, setPrevOpen] = useState<number | null>(null);

  const sorted = [...stages].sort((a, b) => b.stageNr - a.stageNr);
  const latest = sorted[0];
  const previous = sorted.slice(1);

  useEffect(() => {
    // Nieuwe deelnemer of nieuwe laatste etappe: cache leegmaken en laatste laden.
    setDetails({});
    setPrevOpen(null);
    if (!latest) return;
    api(`/api/participants/${userId}/points/${latest.stageNr}`).then((d) =>
      setDetails({ [latest.stageNr]: d })
    );
  }, [userId, latest?.stageNr]);

  useEffect(() => {
    if (prevOpen == null || details[prevOpen]) return;
    api(`/api/participants/${userId}/points/${prevOpen}`).then((d) =>
      setDetails((cur) => ({ ...cur, [prevOpen]: d }))
    );
  }, [prevOpen]);

  if (!latest) return null;

  const stageCard = (s: AccordionStage) => (
    <div className="card">
      <div className="acc-head">
        <b>{s.label}</b>
        <span className="pts">{s.points} pt</span>
      </div>
      {details[s.stageNr]
        ? <Daguitslag d={details[s.stageNr]} />
        : <div className="muted" style={{ margin: '10px 2px' }}>Laden…</div>}
    </div>
  );

  const prevStage = prevOpen != null ? previous.find((s) => s.stageNr === prevOpen) : undefined;

  return (
    <div className="stage-accordion">
      {previous.length > 0 && (
        <select
          value={prevOpen ?? ''}
          onChange={(e) => setPrevOpen(e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">Eerdere etappes bekijken…</option>
          {previous.map((s) => (
            <option key={s.stageNr} value={s.stageNr}>
              {s.label} · {s.points} pt
            </option>
          ))}
        </select>
      )}

      {prevStage && stageCard(prevStage)}
      {stageCard(latest)}
    </div>
  );
}
