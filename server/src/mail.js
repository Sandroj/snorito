// Transactionele mail via Brevo (gratis tier, één geverifieerd afzenderadres).
// Zonder BREVO_API_KEY wordt de mail niet verstuurd maar de link gelogd — handig lokaal.

export async function sendPasswordResetMail(to, link) {
  if (!process.env.BREVO_API_KEY) {
    console.log(`[mail uitgeschakeld] Reset-link voor ${to}: ${link}`);
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
      subject: 'Wachtwoord opnieuw instellen — Snorito',
      htmlContent: `
        <p>Er is een wachtwoord-reset aangevraagd voor je Snorito-account.</p>
        <p><a href="${link}">Stel hier een nieuw wachtwoord in</a> (de link is 1 uur geldig).</p>
        <p>Heb je dit niet zelf aangevraagd? Dan kun je deze mail negeren.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
}
