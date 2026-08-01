// /api/search — gratis achtergrondinfo, zonder API-sleutel en zonder de dure
// ingebouwde web_search-tool van de AI.
//
// POST { query }  → { results: [{title, snippet}] }   (DuckDuckGo-snippets)
// POST { wine: {producer, name, vintage} } → { offers: [...] }  (Vivino, EUR, markt BE)
// Beide mogen samen in één verzoek; dan komen results én offers terug.
//
// Belangrijk: DuckDuckGo beantwoordt GET-verzoeken vanaf een server met een lege
// "anomaly"-pagina (HTTP 202). Met POST naar hetzelfde endpoint werkt het wel.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")
  .replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/\s+/g, " ").trim();

// DuckDuckGo verpakt elke link in een redirect (/l/?uddg=<geëncodeerde url>).
// Die pakken we uit, zodat de app naar de echte bron kan doorlinken.
function realUrl(attrs) {
  const m = /href="([^"]+)"/.exec(attrs || "");
  if (!m) return "";
  let href = m[1].replace(/&amp;/g, "&");
  const u = /[?&]uddg=([^&]+)/.exec(href);
  if (u) { try { href = decodeURIComponent(u[1]); } catch {} }
  if (href.startsWith("//")) href = "https:" + href;
  return /^https?:\/\//.test(href) ? href.slice(0, 400) : "";
}

function parseHtmlResults(html) {
  const out = [];
  const re = /<a([^>]*class="result__a"[^>]*)>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < 6) {
    out.push({ title: strip(m[2]).slice(0, 120), snippet: strip(m[3]).slice(0, 300), url: realUrl(m[1]) });
  }
  return out;
}

function parseLiteResults(html) {
  const out = [];
  const links = [...html.matchAll(/<a([^>]*class="result-link"[^>]*)>([\s\S]*?)<\/a>/g)];
  const snips = [...html.matchAll(/class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
  for (let i = 0; i < links.length && out.length < 6; i++) {
    const title = strip(links[i][2]);
    if (!title) continue;
    out.push({ title: title.slice(0, 120), snippet: (snips[i] || "").slice(0, 300), url: realUrl(links[i][1]) });
  }
  return out;
}

async function ddg(query) {
  const attempts = [
    ["https://html.duckduckgo.com/html/", parseHtmlResults],
    ["https://lite.duckduckgo.com/lite/", parseLiteResults],
  ];
  for (const [url, parse] of attempts) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "user-agent": UA,
          "content-type": "application/x-www-form-urlencoded",
          "accept": "text/html,application/xhtml+xml",
          "accept-language": "nl-BE,nl;q=0.9,en;q=0.6",
          "referer": url,
        },
        body: "q=" + encodeURIComponent(query) + "&kl=be-nl",
      });
      const html = await r.text();
      const res = parse(html);
      if (res.length) return res;
    } catch {}
  }
  return [];
}

// Link naar de Vivino-pagina van precies deze wijn en jaargang. Het patroon is
// /<domein-wijn>/w/<wijn-id>?year=<jaargang>; zonder seo-namen valt hij terug op
// de zoekpagina. (/wines/<id> NIET gebruiken: dat komt op een andere wijn uit.)
function vivinoUrl(w, year) {
  const slug = [w && w.winery && w.winery.seo_name, w && w.seo_name].filter(Boolean).join("-");
  const q = year ? `?year=${year}` : "";
  if (slug && w.id) return `https://www.vivino.com/${slug}/w/${w.id}${q}`;
  const term = [w && w.winery && w.winery.name, w && w.name].filter(Boolean).join(" ").trim();
  return term ? "https://www.vivino.com/search/wines?q=" + encodeURIComponent(term) : "";
}

// Vivino-marktprijzen: echte winkelprijzen per jaargang in EUR voor de Belgische markt.
// Dit vervangt het "gokken" van een prijs door de AI.
async function vivino(wine) {
  const term = [wine.producer, wine.name, wine.vintage].filter(Boolean).join(" ").trim();
  if (!term) return [];
  const p = new URLSearchParams({
    country_code: "BE", currency_code: "EUR",
    min_rating: "1", page: "1", per_page: "24",
    price_range_min: "0", price_range_max: "100000",
    search_term: term,
  });
  try {
    const r = await fetch("https://www.vivino.com/api/explore/explore?" + p, {
      headers: {
        "user-agent": UA,
        "accept": "application/json",
        "accept-language": "nl-BE,nl;q=0.9",
        "referer": "https://www.vivino.com/",
      },
    });
    if (!r.ok) return [];
    const j = await r.json();
    const matches = (j && j.explore_vintage && j.explore_vintage.matches) || [];
    return matches.map((m) => {
      const v = m.vintage || {};
      const w = v.wine || {};
      const pr = m.price || {};
      return {
        producer: (w.winery && w.winery.name) || "",
        name: w.name || "",
        vintage: v.year ?? "",
        url: vivinoUrl(w, v.year),
        price: typeof pr.amount === "number" ? Math.round(pr.amount * 100) / 100 : null,
        currency: (pr.currency && pr.currency.code) || "",
        volumeMl: (pr.bottle_type && pr.bottle_type.volume_ml) || null,
        rating: (v.statistics && v.statistics.ratings_average) || null,
        ratings: (v.statistics && v.statistics.ratings_count) || 0,
      };
    })
      // enkel prijzen in EUR tellen mee als prijs; een aanbod zonder EUR-prijs mag
      // wel blijven voor de Vivino-score (rating + aantal beoordelingen)
      .map((o) => (o.price && o.currency === "EUR" ? o : { ...o, price: null }))
      .filter((o) => o.price || (o.rating && o.ratings));
  } catch { return []; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Alleen POST" }); return; }
  const body = req.body || {};
  const q = String(body.query || "").slice(0, 200);
  const wine = body.wine && typeof body.wine === "object" ? body.wine : null;
  if (!q && !wine) { res.status(400).json({ error: "query of wine ontbreekt" }); return; }
  try {
    const [results, offers] = await Promise.all([
      q ? ddg(q) : Promise.resolve([]),
      wine ? vivino(wine) : Promise.resolve([]),
    ]);
    res.status(200).json({ results, offers });
  } catch {
    res.status(200).json({ results: [], offers: [] });
  }
}
