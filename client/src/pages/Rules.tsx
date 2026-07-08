import { useEffect, useState } from 'react';
import { cachedApi, euro, Rules as RulesData } from '../api';

const CLS_META: Record<string, { label: string; trui: string }> = {
  alg: { label: 'Algemeen', trui: 'trui-geel' },
  punt: { label: 'Punten', trui: 'trui-groen' },
  berg: { label: 'Berg', trui: 'trui-bol' },
  jong: { label: 'Jongeren', trui: 'trui-wit' },
};

function PosTable({ points, split = true }: { points: number[]; split?: boolean }) {
  const half = Math.ceil(points.length / 2);
  const cols = split && points.length > 10 ? [points.slice(0, half), points.slice(half)] : [points];
  return (
    <div className="points-grid" style={!split || points.length <= 10 ? { gridTemplateColumns: '1fr' } : {}}>
      {cols.map((col, ci) => (
        <table key={ci}>
          <thead><tr><th>Positie</th><th className="num">Punten</th></tr></thead>
          <tbody>
            {col.map((p, i) => (
              <tr key={i}>
                <td>{ci * half + i + 1}</td>
                <td className="num"><b>{p}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

export default function Rules() {
  const [rules, setRules] = useState<RulesData | null>(null);

  useEffect(() => {
    cachedApi<RulesData>('/api/rules').then(setRules);
  }, []);

  if (!rules) return <div className="center" style={{ marginTop: 60, color: '#667085' }}>Laden…</div>;

  return (
    <div className="fade-in">
      <h1>Spelregels</h1>
      <p className="page-sub">Alle regels en puntentabellen — precies zoals de app ze berekent.</p>

      <div className="rules-hero">
        <h2>Zo werkt Snorito</h2>
        <p>
          Stel vóór de start van de Tour een team samen van {rules.teamSize} renners binnen een budget van {euro(rules.budget)}.
          Per etappe stel je {rules.lineupSize} renners op, met één kopman die dubbel scoort op de daguitslag.
          Meet je met vrienden in je eigen poules.
        </p>
      </div>

      <div className="steps">
        <div className="step-card">
          <div className="n">1</div>
          <b>Kies je team</b>
          <span>{rules.teamSize} renners, max {rules.maxPerTeam} per ploeg. Goedkoopste renner kost {euro(rules.minRiderPrice)} — houd genoeg over voor al je plekken.</span>
        </div>
        <div className="step-card">
          <div className="n">2</div>
          <b>Stel op per etappe</b>
          <span>Kies {rules.lineupSize} renners uit je team, tot de starttijd van de etappe. Alleen zij pakken punten.</span>
        </div>
        <div className="step-card">
          <div className="n">3</div>
          <b>Kies je kopman</b>
          <span>Eén van je {rules.lineupSize} opgestelde renners. Zijn punten voor de daguitslag tellen ×{rules.captainFactor}.</span>
        </div>
        <div className="step-card">
          <div className="n">4</div>
          <b>Verzamel punten</b>
          <span>Daguitslag, klassementen, teampunten en het eindklassement. De hoogste totaalscore wint.</span>
        </div>
      </div>

      <div className="section-label">Team &amp; deadlines</div>
      <div className="card">
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8, fontSize: 14 }}>
          <li>Je team van {rules.teamSize} renners moet compleet zijn vóór de start van etappe 1. Tot dat moment kun je onbeperkt wijzigen.</li>
          <li>Je opstelling ({rules.lineupSize} renners + kopman) kun je per etappe wijzigen tot de officiële starttijd.</li>
          <li>Valt een renner uit? Dan kun je hem niet vervangen — hij behoudt zijn punten, maar scoort niet meer.</li>
          <li>Bij een gelijke stand eindigt degene die zich het eerst aanmeldde hoger.</li>
        </ul>
      </div>

      <div className="section-label">Punten per etappe</div>
      <div className="card">
        <h2>Daguitslag (top 20)</h2>
        <p className="muted">Kopman verdient het dubbele van deze punten.</p>
        <PosTable points={rules.stagePoints} />
      </div>

      <div className="card">
        <h2>Klassementen na de etappe (top 5)</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Positie</th>
                {Object.entries(CLS_META).map(([k, m]) => (
                  <th key={k} className="num cls-th"><span className={`trui ${m.trui}`} />{m.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4].map((i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  {Object.keys(CLS_META).map((k) => (
                    <td key={k} className="num">{rules.classPointsAfterStage[k][i] ?? '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Teampunten na de etappe</h2>
        <p className="muted">Voor ploeggenoten van de ritwinnaar en van de klassementsleiders (mits de renner gestart is).</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Ritwinst</th>
                {Object.entries(CLS_META).map(([k, m]) => (
                  <th key={k} className="num cls-th"><span className={`trui ${m.trui}`} />{m.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><b>{rules.teamPointsAfterStage.stageWin}</b></td>
                {Object.keys(CLS_META).map((k) => (
                  <td key={k} className="num"><b>{rules.teamPointsAfterStage[k]}</b></td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Ploegentijdrit (top 8 ploegen)</h2>
        <p className="muted">
          De tijd van de snelste renner telt als ploegtijd. Alle gestarte renners van de ploeg krijgen de punten van hun ploegklassering.
          Bij de TTT worden er geen aparte teampunten voor ritwinst uitgedeeld.
        </p>
        <PosTable points={rules.tttPoints} split={false} />
      </div>

      <div className="section-label">Eindklassement</div>
      <div className="card">
        <h2>Punten eindklassement</h2>
        <p className="muted">Voor al je {rules.teamSize} renners die de Tour uitrijden — opstellen hoeft niet.</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Positie</th>
                {Object.entries(CLS_META).map(([k, m]) => (
                  <th key={k} className="num cls-th"><span className={`trui ${m.trui}`} />{m.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.finalPoints.alg.map((_, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  {Object.keys(CLS_META).map((k) => (
                    <td key={k} className="num">{rules.finalPoints[k][i] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          Teampunten eindklassement (ploeggenoten van de winnaar, gestart in de slotrit): algemeen {rules.finalTeamPoints.alg},
          punten {rules.finalTeamPoints.punt}, berg {rules.finalTeamPoints.berg}, jongeren {rules.finalTeamPoints.jong}.
        </p>
      </div>
    </div>
  );
}
