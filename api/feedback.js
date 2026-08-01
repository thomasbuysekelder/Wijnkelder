// /api/feedback — anonieme meldingen ("probleem of idee") uit de app naar mail.
//
// POST { message, version } → { ok: true }
//
// Het e-mailadres staat NOOIT in de code of in de client: het komt uit de
// omgevingsvariabele FEEDBACK_EMAIL op Vercel. De sleutel idem (RESEND_API_KEY).
// De melder krijgt enkel te horen of het gelukt is; nooit een foutdetail, zodat
// er langs deze weg niets over de configuratie lekt.

const RESEND_URL = "https://api.resend.com/emails";

// Elke melding wordt ook bovenaan FEEDBACK.md in de repo gezet, zodat je ze
// naast je mailbox ook gewoon in GitHub kan nalezen. Dit is een extra: lukt het
// niet (geen token, GitHub plat, gelijktijdige schrijfbeurt), dan slaan we het
// stil over — de mail is al vertrokken en de melder merkt er niets van.
const GH_REPO = "thomasbuysekelder/Wijnkelder";
const GH_BRANCH = "main";
const GH_FILE = "FEEDBACK.md";
const b64 = {
  enc: (s) => Buffer.from(s, "utf8").toString("base64"),
  dec: (s) => Buffer.from(String(s || "").replace(/\n/g, ""), "base64").toString("utf8"),
};

async function appendToRepo(message, version) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;
  const url = `https://api.github.com/repos/${GH_REPO}/contents/${GH_FILE}`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "user-agent": "kelder-app",
    "x-github-api-version": "2022-11-28",
  };
  const datum = new Date().toISOString().slice(0, 10);
  const blok = `## ${datum} · ${version}\n\n${message}\n`;

  // twee pogingen: bij gelijktijdige meldingen is de sha intussen verouderd
  for (let poging = 0; poging < 2; poging++) {
    const cur = await fetch(`${url}?ref=${GH_BRANCH}`, { headers });
    let oud = "", sha;
    if (cur.ok) {
      const j = await cur.json();
      oud = b64.dec(j.content);
      sha = j.sha;
    } else if (cur.status !== 404) return;

    const kop = "# Meldingen uit de app\n";
    const rest = oud.startsWith(kop) ? oud.slice(kop.length).replace(/^\n+/, "") : oud;
    const nieuw = `${kop}\n${blok}${rest ? "\n" + rest : ""}`;

    const put = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        message: `Melding uit de app (${datum})`,
        content: b64.enc(nieuw),
        branch: GH_BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });
    if (put.ok) return;
    if (put.status !== 409 && put.status !== 422) return;
  }
}

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
    // de mail is vertrokken; het wegschrijven in de repo mag hier niets meer breken
    try { await appendToRepo(message, version); } catch {}
    res.status(200).json({ ok: true });
  } catch {
    res.status(502).json({ ok: false });
  }
}
