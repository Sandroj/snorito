// Herinneringsmail voor deelnemers die 3 uur voor de etappestart nog geen
// opstelling hebben ingevoerd. Wordt periodiek aangeroepen (server-interval en
// cron-endpoint); lineup_reminders voorkomt dubbele mails (één per etappe).
import { all, run, TEAM_SIZE } from './db.js';
import { sendLineupReminderMail } from './mail.js';

const REMIND_BEFORE_MS = 3 * 3600_000;

// Etappestarttijden zijn lokale tijd zonder zone (CEST, hele Tour 2026).
const CEST = '+02:00';
const startMs = (stage) => new Date(`${stage.start}${CEST}`).getTime();

export async function checkLineupReminders() {
  // Zonder mailconfiguratie niets claimen — anders "verstuurt" een lokale
  // dev-server (zelfde database!) de herinnering zogenaamd en krijgt de
  // deelnemer hem nooit echt.
  if (!process.env.BREVO_API_KEY) return [];
  const now = Date.now();
  const stages = await all("SELECT * FROM stages WHERE status = 'open' ORDER BY nr");
  const due = stages.filter((s) => {
    const start = startMs(s);
    return start > now && start - now <= REMIND_BEFORE_MS;
  });

  const sent = [];
  for (const stage of due) {
    // Alleen deelnemers met een compleet team en een echt e-mailadres;
    // wie al een opstelling heeft of al gemaild is, valt af.
    const users = await all(`
      SELECT u.id, u.name, u.email FROM users u
      WHERE u.email LIKE '%@%'
        AND (SELECT COUNT(*) FROM user_teams t WHERE t.user_id = u.id) = ?
        AND NOT EXISTS (SELECT 1 FROM lineups l WHERE l.user_id = u.id AND l.stage_nr = ?)
        AND NOT EXISTS (SELECT 1 FROM lineup_reminders r WHERE r.user_id = u.id AND r.stage_nr = ?)
    `, [TEAM_SIZE, stage.nr, stage.nr]);

    for (const u of users) {
      // Eerst claimen, dan mailen — bij een race tussen interval en cron wint er precies één.
      const claim = await run(
        'INSERT INTO lineup_reminders (user_id, stage_nr) VALUES (?, ?) ON CONFLICT DO NOTHING',
        [u.id, stage.nr]
      );
      if (claim.rowCount === 0) continue;
      try {
        await sendLineupReminderMail(u, stage);
        sent.push(`${u.email} (etappe ${stage.nr})`);
      } catch (e) {
        // Mislukte mail: claim weer vrijgeven zodat een volgende ronde het opnieuw probeert.
        await run('DELETE FROM lineup_reminders WHERE user_id = ? AND stage_nr = ?', [u.id, stage.nr]);
        console.error(`herinnering aan ${u.email} mislukt: ${e.message}`);
      }
    }
  }
  if (sent.length) console.log('Opstelling-herinneringen verstuurd:', sent.join(', '));
  return sent;
}
