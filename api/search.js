export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Alleen POST" }); return; }
  const q = String((req.body && req.body.query) || "").slice(0, 200);
  if (!q) { res.status(400).json({ error: "query ontbreekt" }); return; }
  try {
    const r = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q), {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "accept-language": "nl,en;q=0.8",
      },
    });
    const html = await r.text();
    const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")
      .replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
    const out = [];
    const re = /class="result__a"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && out.length < 6) {
      out.push({ title: strip(m[1]).slice(0, 120), snippet: strip(m[2]).slice(0, 300) });
    }
    res.status(200).json({ results: out });
  } catch (e) {
    res.status(200).json({ results: [] });
  }
}
