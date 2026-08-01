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

// Brave Search: primaire webbron. Sleutel staat in de omgeving, nooit in de code.
// Geeft null bij een fout (dan valt de handler terug op DuckDuckGo) en [] als de
// zoekopdracht wel lukte maar niets opleverde.
const slaap = (ms) => new Promise((r) => setTimeout(r, ms));

// Geeft { items, status } terug. De status zegt WAAROM Brave eventueel niets gaf,
// want "geen sleutel" en "sleutel geweigerd" vragen om een heel ander antwoord.
async function brave(query, poging = 0) {
  // Bij het plakken komt er vaak witruimte mee, soms zelfs een regelafbreking
  // middenin wanneer de sleutel in een venster over twee regels stond. Een
  // Brave-sleutel bevat nooit spaties, dus we knippen ze er allemaal uit in
  // plaats van de sleutel te weigeren.
  const ruw = String(process.env.BRAVE_API_KEY || "");
  const key = ruw.replace(/\s+/g, "");
  if (!key) return { items: null, status: "geen sleutel" };
  const p = new URLSearchParams({ q: query, count: "6", country: "BE", search_lang: "nl", safesearch: "off" });
  try {
    const r = await fetch("https://api.search.brave.com/res/v1/web/search?" + p, {
      headers: { accept: "application/json", "accept-encoding": "gzip", "x-subscription-token": key },
    });
    // gratis laag staat één bevraging per seconde toe; de app zoekt er twee tegelijk
    if (r.status === 429 && poging === 0) { await slaap(1200); return brave(query, 1); }
    if (!r.ok) {
      // Brave zet in het antwoord waaróm hij weigert; zonder die uitleg blijf je
      // gissen tussen een foute sleutel en een fout opgebouwd verzoek.
      let reden = "";
      try {
        const tekst = await r.text();
        try {
          const j = JSON.parse(tekst);
          const e = (j && j.error) || {};
          reden = [e.code, e.detail || e.message].filter(Boolean).join(": ");
          // sommige fouten zitten een niveau dieper, in meta
          if (!reden && e.meta) reden = JSON.stringify(e.meta).slice(0, 120);
        } catch { reden = tekst.slice(0, 120); }
      } catch { /* geen leesbaar antwoord */ }
      return { items: null, status: `geweigerd (${r.status}${reden ? ": " + strip(reden).slice(0, 120) : ""})` };
    }
    const j = await r.json();
    const res = ((j && j.web && j.web.results) || []).slice(0, 6).map((x) => ({
      title: strip(x.title || "").slice(0, 120),
      snippet: strip(x.description || "").slice(0, 300),
      url: String(x.url || "").slice(0, 400),
    })).filter((x) => x.title);
    return { items: res, status: res.length ? "ok" : "leeg" };
  } catch (e) { return { items: null, status: "niet bereikbaar" }; }
}

// Wikipedia: gratis en zonder sleutel, voor achtergrond bij een domein of wijn.
// Bewust NIET als recensiebron — een encyclopedie beoordeelt geen jaargangen.
// Woorden die verraden dat het artikel echt over wijn gaat. Zonder deze controle
// gaf "Soldera" op de Nederlandse Wikipedia "Lijst van trainers van AC Milan".
const WIJNWOORD = /wijn|wine|winer|vineyard|wijngaard|vino|vigne|appellation|domaine|domein|ch[aâ]teau|druif|grape|bodega|cantina|wijnbouw|viticult/i;
const wikiTokens = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 3);

async function wikipedia(term) {
  const t = String(term || "").trim();
  if (!t) return null;
  const wil = wikiTokens(t);
  const kop = { "user-agent": "kelder-app/1.0 (persoonlijke wijnkelder)", accept: "application/json" };
  for (const taal of ["nl", "en"]) {
    try {
      const zoek = new URLSearchParams({ action: "query", list: "search", srsearch: t, srlimit: "3", format: "json", origin: "*" });
      const r1 = await fetch(`https://${taal}.wikipedia.org/w/api.php?` + zoek, { headers: kop });
      if (!r1.ok) continue;
      const j1 = await r1.json();
      const treffers = (j1 && j1.query && j1.query.search) || [];
      // enkel artikelen waarvan de titel bij de zoekterm hoort
      const kandidaten = treffers.filter((h) => {
        const titel = wikiTokens(h.title);
        return wil.some((w) => titel.includes(w));
      });
      if (!kandidaten.length) continue;
      const uit = new URLSearchParams({
        action: "query", prop: "extracts", exintro: "1", explaintext: "1",
        titles: kandidaten.map((k) => k.title).join("|"), format: "json", origin: "*",
      });
      const r2 = await fetch(`https://${taal}.wikipedia.org/w/api.php?` + uit, { headers: kop });
      if (!r2.ok) continue;
      const j2 = await r2.json();
      const pages = Object.values((j2 && j2.query && j2.query.pages) || {});
      for (const k of kandidaten) {
        const pagina = pages.find((p) => p.title === k.title);
        const extract = strip((pagina && pagina.extract) || "");
        // moet echt over wijn gaan, anders is het toeval en misleidt het het model
        if (extract.length > 80 && WIJNWOORD.test(extract)) {
          return { title: k.title, extract: extract.slice(0, 600), taal, url: `https://${taal}.wikipedia.org/wiki/${encodeURIComponent(k.title)}` };
        }
      }
    } catch { /* volgende taal */ }
  }
  return null;
}

async function ddg(query) {
  const attempts = [
    ["https://html.duckduckgo.com/html/", parseHtmlResults],
    ["https://lite.duckduckgo.com/lite/", parseLiteResults],
  ];
  let mislukt = true; // blijft true zolang geen enkele poging een pagina opleverde
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
      mislukt = false; // pagina kwam binnen, maar zonder resultaten
    } catch { mislukt = true; }
  }
  // null = bron was onbereikbaar, [] = bron antwoordde maar gaf niets
  return mislukt ? null : [];
}

// Bron-link naar Vivino: ALTIJD de zoekpagina op naam + jaargang.
// Nooit id's of slugs gebruiken — die leiden naar de verkeerde wijn.
function vivinoUrl(w, year) {
  const term = [w && w.winery && w.winery.name, w && w.name, year].filter(Boolean).join(" ").trim();
  return term ? "https://www.vivino.com/search/wines?q=" + encodeURIComponent(term) : "";
}

// Vivino-marktprijzen: echte winkelprijzen per jaargang in EUR voor de Belgische markt.
// Dit vervangt het "gokken" van een prijs door de AI.
async function vivino(wine) {
  // 'term' is de opgekuiste zoekterm van de app (zonder dubbele producentnaam);
  // valt die weg, dan bouwen we hem hier alsnog uit de losse velden.
  const term = String(wine.term || "").trim() || [wine.producer, wine.name, wine.vintage].filter(Boolean).join(" ").trim();
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
    if (!r.ok) return null;   // geblokkeerd of stuk — niet hetzelfde als 'niets gevonden'
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
        // herkomst uit Vivino zelf: betrouwbaarder dan een gok op basis van de naam
        region: (w.region && w.region.name) || "",
        country: (w.region && w.region.country && (w.region.country.name || w.region.country.code)) || "",
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
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Alleen POST" }); return; }
  const body = req.body || {};
  const q = String(body.query || "").slice(0, 200);
  const wine = body.wine && typeof body.wine === "object" ? body.wine : null;
  const wiki = String(body.wiki || "").slice(0, 120);
  if (!q && !wine && !wiki) { res.status(400).json({ error: "query, wine of wiki ontbreekt" }); return; }
  try {
    // Brave eerst; ontbreekt de sleutel of faalt hij, dan DuckDuckGo als terugval.
    const web = async () => {
      if (!q) return { items: [], bron: "", brave: "niet gevraagd" };
      const b = await brave(q);
      if (b.items !== null) return { items: b.items, bron: "Brave", brave: b.status };
      const d = await ddg(q);
      return { items: d, bron: d === null ? "" : "DuckDuckGo", brave: b.status };
    };
    const [wr, offers, wikiInfo] = await Promise.all([
      web(),
      wine ? vivino(wine) : Promise.resolve([]),
      wiki ? wikipedia(wiki) : Promise.resolve(null),
    ]);
    const results = wr.items;
    // sources maakt het verschil zichtbaar tussen "bron gaf niets terug" en
    // "bron was onbereikbaar"; anders lijkt een geblokkeerde bron op een wijn
    // waarover niets te vinden is.
    const staat = (v, gevraagd) => (!gevraagd ? "niet gevraagd" : v === null ? "onbereikbaar" : v.length ? "ok" : "leeg");
    res.status(200).json({
      results: results || [],
      offers: offers || [],
      wiki: wikiInfo,
      sources: {
        web: staat(results, !!q),
        webBron: wr.bron,                                   // welke bron het geworden is
        brave: wr.brave,                                    // en waarom Brave het eventueel niet werd
        vivino: staat(offers, !!wine),
        wikipedia: !wiki ? "niet gevraagd" : wikiInfo ? "ok" : "leeg",
      },
    });
  } catch {
    res.status(200).json({ results: [], offers: [], wiki: null, sources: { web: "fout", webBron: "", vivino: "fout", wikipedia: "fout" } });
  }
}
