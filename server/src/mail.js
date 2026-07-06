// Transactionele mail via Brevo (gratis tier, één geverifieerd afzenderadres).
// Zonder BREVO_API_KEY wordt de mail niet verstuurd maar gelogd — handig lokaal.

async function sendMail(to, subject, htmlContent) {
  if (!process.env.BREVO_API_KEY) {
    console.log(`[mail uitgeschakeld] Aan ${to}: ${subject}`);
    return;
  }
  const from = process.env.MAIL_FROM;
  if (!from) throw new Error('MAIL_FROM ontbreekt (het in Brevo geverifieerde afzenderadres)');

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Snorito', email: from },
      to: [{ email: to }],
      subject,
      htmlContent,
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
}

export async function sendPasswordResetMail(to, link) {
  await sendMail(to, 'Wachtwoord opnieuw instellen — Snorito', `
    <p>Er is een wachtwoord-reset aangevraagd voor je Snorito-account.</p>
    <p><a href="${link}">Stel hier een nieuw wachtwoord in</a> (de link is 1 uur geldig).</p>
    <p>Heb je dit niet zelf aangevraagd? Dan kun je deze mail negeren.</p>`);
}

const appUrl = () =>
  (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'https://snorito-2j6w.onrender.com').replace(/\/$/, '');

export async function sendLineupReminderMail(user, stage) {
  const start = new Date(`${stage.start}+02:00`).toLocaleTimeString('nl-NL', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam',
  });
  await sendMail(user.email, `Nog geen opstelling voor etappe ${stage.nr} — Snorito`, `
    <p>Hoi ${user.name},</p>
    <p>Over minder dan 3 uur (om ${start}) start <b>etappe ${stage.nr}: ${stage.van} → ${stage.naar}</b>,
    maar je hebt nog geen opstelling ingevoerd. Zonder opstelling scoor je deze etappe geen punten.</p>
    <p><a href="${appUrl()}/opstelling">Stel nu je 9 renners + kopman op →</a></p>
    <p>Veel succes!</p>`);
}
