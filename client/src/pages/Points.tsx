import { useLiveApi } from '../api';
import { useSession } from '../App';
import { StageAccordion } from '../components/StageAccordion';

interface StageScore { stageNr: number; points: number; }

// "Uitslagen" — je eigen scores per etappe. De laatste etappe staat altijd
// volledig uitgeklapt; eerdere etappes kies je via de dropdown erboven
// (dezelfde weergave als onder een deelnemer in het klassement).
export default function Points() {
  const { user } = useSession();
  const scores = useLiveApi<{ scores: StageScore[] }>('/api/my/points')?.scores ?? [];

  const total = scores.reduce((s, x) => s + x.points, 0);
  const stageCount = scores.filter((x) => x.stageNr > 0).length;
  const hasFinal = scores.some((x) => x.stageNr === 0);
  const subtitle = stageCount === 0
    ? 'nog geen etappes verwerkt'
    : `over ${stageCount} etappe${stageCount !== 1 ? 's' : ''}${hasFinal ? ' + eindklassement' : ''}`;

  return (
    <div className="fade-in">
      <h1>Mijn uitslagen</h1>
      <div className="total-hero">
        <div className="lab">Totaalscore</div>
        <div className="big">{total}</div>
        <div className="lab" style={{ letterSpacing: 0, textTransform: 'none' }}>
          {subtitle}
        </div>
      </div>

      {scores.length === 0 && (
        <div className="card empty">
          <div className="emoji">⏱️</div>
          Zodra de eerste etappe is verwerkt zie je hier je uitslag per etappe,<br />
          met je opstelling en de punten die je op de bank liet liggen.
        </div>
      )}

      {scores.length > 0 && user && (
        <StageAccordion
          userId={user.id}
          stages={scores.map((s) => ({
            stageNr: s.stageNr,
            points: s.points,
            label: s.stageNr === 0 ? 'Eindklassement' : `Etappe ${s.stageNr}`,
          }))}
        />
      )}
    </div>
  );
}
