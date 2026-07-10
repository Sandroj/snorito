import { useState } from 'react';

export interface AccordionStage {
  stageNr: number;
  points: number;
  label: string;
}

export function StageAccordion({
  stages,
  onStageOpen,
  isLoading,
  children
}: {
  stages: AccordionStage[];
  onStageOpen: (nr: number) => void;
  isLoading: boolean;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showPrevious, setShowPrevious] = useState(false);

  if (stages.length === 0) return null;

  const sorted = [...stages].sort((a, b) => b.stageNr - a.stageNr);
  const latest = sorted[0];
  const previous = sorted.slice(1);

  return (
    <div className="stage-accordion">
      <div key={latest.stageNr} className="card">
        <div
          className="acc-head"
          onClick={() => {
            const newVal = expanded === latest.stageNr ? null : latest.stageNr;
            setExpanded(newVal);
            if (newVal) onStageOpen(latest.stageNr);
          }}
        >
          <b>{latest.label}</b>
          <span className="pts">{latest.points} pt</span>
        </div>
        {expanded === latest.stageNr && (
          isLoading ? <div className="muted">Laden…</div> : children
        )}
      </div>

      {previous.length > 0 && (
        <div className="card previous-stages">
          <div
            className="acc-head"
            onClick={() => setShowPrevious(!showPrevious)}
          >
            <b>Vorige etappes ({previous.length})</b>
            <span>{showPrevious ? '▼' : '▶'}</span>
          </div>
          {showPrevious && (
            <div className="previous-list">
              {previous.map(s => (
                <div
                  key={s.stageNr}
                  className="acc-head prev-item"
                  onClick={() => {
                    setExpanded(s.stageNr);
                    onStageOpen(s.stageNr);
                  }}
                >
                  <span>{s.label}</span>
                  <span className="pts">{s.points} pt</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
