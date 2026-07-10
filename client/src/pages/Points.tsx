import { useEffect, useState } from 'react';
import { api } from '../api';
import { useSession } from '../App';
import { Daguitslag, StageDetail } from '../components/Daguitslag';
import { StageAccordion } from '../components/StageAccordion';

interface StageScore { stageNr: number; points: number; }

// "Uitslagen" — je eigen scores per etappe, uitklapbaar met de volledige
// daguitslag, je opstelling en de misgelopen punten (dezelfde weergave als
// onder een deelnemer in het klassement, maar dan voor jezelf en zonder team).
export default function Points() {
  const { user } = useSession();
  const [scores, setScores] = useState<StageScore[]>([]);
  const [openStage, setOpenStage] = useState<number | null>(null);
  const [detail, setDetail] = useState<StageDetail | null>(null);

  useEffect(() => {
    api('/api/my/points').then((r) => {
      setScores(r.scores);
      // Laatste etappe (hoogste nr) meteen uitklappen bij het openen.
      const last = r.scores.filter((s: StageScore) => s.stageNr > 0).sort((a: StageScore, b: StageScore) => b.stageNr - a.stageNr)[0];
      if (last) setOpenStage(last.stageNr);
    });
  }, []);

  useEffect(() => {
    if (openStage == null || !user) return;
    setDetail(null);
    api(`/api/participants/${user.id}/points/${openStage}`).then(setDetail);
  }, [openStage, user]);

  const total = scores.reduce((s, x) => s + x.points, 0);

  return (
    <div className="fade-in">
      <h1>Mijn uitslagen</h1>
      <div className="total-hero">
        <div className="lab">Totaalscore</div>
        <div className="big">{total}</div>
        <div className="lab" style={{ letterSpacing: 0, textTransform: 'none' }}>
          {scores.length > 0 ? `over ${scores.length} verwerkte ronde${scores.length !== 1 ? 's' : ''}` : 'nog geen etappes verwerkt'}
        </div>
      </div>

      {scores.length === 0 && (
        <div className="card empty">
          <div className="emoji">⏱️</div>
          Zodra de eerste etappe is verwerkt zie je hier je uitslag per etappe,<br />
          met je opstelling en de punten die je op de bank liet liggen.
        </div>
      )}

      {scores.length > 0 && (
        <StageAccordion
          stages={scores.map(s => ({
            stageNr: s.stageNr,
            points: s.points,
            label: s.stageNr === 0 ? 'Eindklassement' : `Etappe ${s.stageNr}`
          }))}
          onStageOpen={(nr) => setOpenStage(nr)}
          isLoading={openStage != null && detail == null}
        >
          {detail && <Daguitslag d={detail} />}
        </StageAccordion>
      )}
    </div>
  );
}
