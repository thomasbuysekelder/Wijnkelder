// /api/feedback — anonieme meldingen ("probleem of idee") uit de app naar mail.
//
// POST { message, version } → { ok: true }
//
// Het e-mailadres staat NOOIT in de code of in de client: het komt uit de
// omgevingsvariabele FEEDBACK_EMAIL op Vercel. De sleutel idem (RESEND_API_KEY).
// De melder krijgt enkel te horen of het gelukt is; nooit een foutdetail, zodat
// er langs deze weg niets over de configuratie lekt.

const RESEND_URL = "https://api.resend.com/emails";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false }); return; }

  const body = req.body || {};
  const message = String(body.message || "").trim().slice(0, 4000);
  const version = String(body.version || "onbekend").replace(/[^\w.\- ]/g, "").slice(0, 40);
  if (!message) { res.status(400).json({ ok: false }); return; }

  const key = process.env.RESEND_API_KEY;
  const to = process.env.FEEDBACK_EMAIL;
  if (!key || !to) { res.status(500).json({ ok: false }); return; }

  try {
    const r = await fetch(RESEND_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from: "onboarding@resend.dev",
        to,
        subject: "Kelder-app: melding",
        text: `${message}\n\n—\nAppversie: ${version}`,
      }),
    });
    if (!r.ok) { res.status(502).json({ ok: false }); return; }
    res.status(200).json({ ok: true });
  } catch {
    res.status(502).json({ ok: false });
  }
}
