import { useEffect, useState, useRef, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { api, euroShort } from '../api';
import { RiderInfo } from '../components/RiderInfo';
import { Daguitslag, StageDetail } from '../components/Daguitslag';
import { StageAccordion } from '../components/StageAccordion';
import { CheckIcon } from '../components/Icons';

// Klein (i)-icoontje met uitleg: werkt zowel op hover (desktop) als tik (mobiel),
// sluit bij een klik elders.
function InfoHint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  return (
    <span ref={ref} className="info-hint-wrap">
      <button
        type="button"
        className="info-hint"
        title={text}
        aria-label="Uitleg"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        ⓘ
      </button>
      {open && <span className="info-hint-bubble" onClick={(e) => e.stopPropagation()}>{text}</span>}
    </span>
  );
}

interface RankRow {
  position: number;
  userId: number;
  name: string;
  total: number;
  lastStage: number;
  finalPoints: number;
  isMe: boolean;
  lineupReady: boolean;
  efficiency: number | null;
}

interface Pool { id: number; name: string; }

interface TeamRider { id: number; name: string; price: number; type: string; team_name: string; nationality: string; team_shirt: string | null; retired?: boolean; }
interface Participant {
  userId: number;
  name: string;
  team: TeamRider[];
  scores: { stageNr: number; points: number }[];
  total: number;
}

// Detailweergave van één deelnemer: scores per etappe (uitklapbaar met
// puntenuitsplitsing) en het team van 20. Opstellingen van nog niet gestarte
// etappes geeft de server bewust niet terug.
function ParticipantDetail({ userId, onBack }: { userId: number; onBack: () => void }) {
  const [data, setData] = useState<Participant | null>(null);
  const [openStage, setOpenStage] = useState<number | null>(null);
  const [detail, setDetail] = useState<StageDetail | null>(null);

  useEffect(() => {
    api(`/api/participants/${userId}`).then(setData);
  }, [userId]);

  useEffect(() => {
    if (openStage == null) return;
    setDetail(null);
    api(`/api/participants/${userId}/points/${openStage}`).then(setDetail);
  }, [userId, openStage]);

  if (!data) return <div className="center" style={{ margin: 40, color: '#667085' }}>Laden…</div>;

  const stagesData = useMemo(() =>
    data.scores.map(s => ({
      stageNr: s.stageNr,
      points: s.points,
      label: s.stageNr === 0 ? 'Eindklassement' : `Etappe ${s.stageNr}`
    })),
    [data.scores]
  );

  return (
    <div className="fade-in">
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 20 }} onClick={onBack}>← Terug naar klassement</button>
      <div className="total-hero" style={{ marginTop: 12 }}>
        <div className="lab">{data.name}</div>
        <div className="big">{data.total}</div>
        <div className="lab" style={{ letterSpacing: 0, textTransform: 'none' }}>punten totaal</div>
      </div>

      <div className="section-label">Scores per etappe</div>
      {data.scores.length === 0 && (
        <div className="card empty"><div className="emoji">⏱️</div>Nog geen verwerkte etappes.</div>
      )}
      {data.scores.length > 0 && (
        <StageAccordion
          stages={stagesData}
          onStageOpen={(nr) => setOpenStage(nr)}
          isLoading={openStage != null && detail == null}
        >
          {detail && <Daguitslag d={detail} />}
        </StageAccordion>
      )}

      <div className="section-label">Team van {data.team.length} renners</div>
      <div className="card">
        {data.team.length === 0 ? (
          <p className="muted" style={{ margin: '4px 2px' }}>Nog geen team samengesteld.</p>
        ) : (
          <table>
            <tbody>
              {data.team.map((r) => (
                <tr key={r.id}>
                  <td>
                    <RiderInfo
                      shirt={r.team_shirt}
                      nationality={r.nationality}
                      name={r.name}
                      type={r.type}
                      team={r.team_name}
                      retired={r.retired}
                    />
                  </td>
                  <td className="num">{euroShort(r.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function Ranking() {
  const [pools, setPools] = useState<Pool[]>([]);
  const [poolId, setPoolId] = useState<number | 'all'>('all');
  const [rows, setRows] = useState<RankRow[]>([]);
  const [lastStage, setLastStage] = useState<number | null>(null);
  const [nextStage, setNextStage] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const location = useLocation();

  // Terug naar het overzicht bij elke (her)navigatie naar deze pagina — ook als
  // je al op /klassement stond en via een deelnemer in de detailweergave zat.
  useEffect(() => {
    setSelected(null);
  }, [location.key]);

  useEffect(() => {
    api('/api/pools').then((p) => setPools(p.pools));
  }, []);

  useEffect(() => {
    const q = poolId === 'all' ? '' : `?poolId=${poolId}`;
    api(`/api/ranking${q}`).then((r) => {
      setRows(r.ranking);
      setLastStage(r.lastFinishedStage);
      setNextStage(r.nextStageNr ?? null);
    });
  }, [poolId]);

  if (selected != null) {
    return <ParticipantDetail userId={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="fade-in">
      <h1>Klassement</h1>
      <p className="page-sub">
        {lastStage ? `Stand na etappe ${lastStage} · tik op een deelnemer voor team en scores.` : 'De Tour is nog niet begonnen — iedereen staat op nul.'}
      </p>
      {nextStage && (
        <p className="page-sub" style={{ marginTop: -6 }}>
          <span className="lineup-ok"><CheckIcon size={13} /></span> = opstelling voor etappe {nextStage} al ingevuld
        </p>
      )}

      <div className="pill-select">
        <button className={poolId === 'all' ? 'active' : ''} onClick={() => setPoolId('all')}>Algemeen</button>
        {pools.map((p) => (
          <button key={p.id} className={poolId === p.id ? 'active' : ''} onClick={() => setPoolId(p.id)}>{p.name}</button>
        ))}
      </div>

      <div className="card flush">
        <table>
          <thead>
            <tr>
              <th style={{ width: 40, paddingLeft: 16 }}>#</th>
              <th>Deelnemer</th>
              <th className="num">{lastStage ? `Et. ${lastStage}` : 'Laatste'}</th>
              <th className="num">Totaal</th>
              <th className="num" style={{ paddingRight: 16 }}>
                Raak gekozen?{' '}
                <InfoHint text="Percentage behaalde punten t.o.v. potentiële punten: wat je hebt gescoord ten opzichte van wat maximaal mogelijk was met je beste opstelling en kopmankeuze." />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.userId}
                className={r.isMe ? 'me' : ''}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected(r.userId)}
              >
                <td style={{ paddingLeft: 16 }}>{r.position}</td>
                <td>
                  {r.name}{r.isMe ? ' (jij)' : ''}
                  {nextStage && (r.lineupReady
                    ? <span className="lineup-ok" title={`Opstelling etappe ${nextStage} ingevuld`}><CheckIcon size={13} /></span>
                    : <span className="lineup-missing" title={`Nog geen opstelling voor etappe ${nextStage}`}>○</span>)}
                </td>
                <td className="num">{lastStage ? r.lastStage : '—'}</td>
                <td className="num"><b>{r.total}</b></td>
                <td className="num" style={{ paddingRight: 16 }}>{r.efficiency != null ? `${r.efficiency.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty"><div className="emoji">🏆</div>Nog geen deelnemers.</div>}
      </div>
    </div>
  );
}
