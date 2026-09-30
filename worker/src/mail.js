// Correo transaccional con Resend (opcional). Sin RESEND_API_KEY no se envía nada.
export async function sendMail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM || 'K-POS <onboarding@resend.dev>', to: [to], subject, html }),
  });
  return res.ok;
}
