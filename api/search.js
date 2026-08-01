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

// ---------- wisselkoersen ----------
// Officiële dagkoersen van de Europese Centrale Bank: gratis, geen sleutel, en de
// bron waar iedereen zich op baseert. Eén bestand bevat alle munten. De koersen
// zijn euro-gebaseerd: 1 EUR = <rate> vreemde munt, dus delen om naar euro te gaan.
// De ECB publiceert één keer per werkdag, dus zes uur bewaren volstaat ruim.
const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
let koersCache = { tijd: 0, koersen: null };

async function ecbKoersen() {
  const nu = Date.now();
  if (koersCache.koersen && nu - koersCache.tijd < 6 * 60 * 60 * 1000) return koersCache.koersen;
  try {
    const r = await fetch(ECB_URL, { headers: { "user-agent": UA, accept: "application/xml" } });
    if (!r.ok) return koersCache.koersen;          // liever een oude koers dan geen
    const xml = await r.text();
    const koersen = {};
    for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
      const k = parseFloat(m[2]);
      if (k > 0) koersen[m[1]] = k;
    }
    if (!Object.keys(koersen).length) return koersCache.koersen;
    koersCache = { tijd: nu, koersen };
    return koersen;
  } catch { return koersCache.koersen; }
}

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
// Woorden die niets onderscheidends zeggen; die maken de zoekterm alleen breder.
const VIVINO_STOP = new Set(["chateau", "domaine", "weingut", "tenuta", "bodega", "bodegas", "cantina",
  "azienda", "agricola", "wijn", "wine", "vino", "vin", "les", "des", "del", "della", "the", "and", "van", "der"]);
const vTokens = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, " ").split(" ")
  .filter((w) => w.length > 2 && !VIVINO_STOP.has(w) && !/^(19|20)\d\d$/.test(w));

let vivinoPogingen = 0;
async function vivino(wine) {
  vivinoPogingen = 0;
  // 'term' is de opgekuiste zoekterm van de app (zonder dubbele producentnaam);
  // valt die weg, dan bouwen we hem hier alsnog uit de losse velden.
  const term = String(wine.term || "").trim() || [wine.producer, wine.name, wine.vintage].filter(Boolean).join(" ").trim();
  if (!term) return [];

  const zoek = async (zoekterm, land = "BE") => {
    const velden = {
      currency_code: "EUR",
      min_rating: "1", page: "1", per_page: "24",
      price_range_min: "0", price_range_max: "100000",
      search_term: zoekterm,
    };
    // zonder land laat je het marktfilter vallen; dat blijkt nodig wanneer het
    // verzoek van een server komt in plaats van van een gewone verbinding
    if (land) velden.country_code = land;
    const p = new URLSearchParams(velden);
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
    return (j && j.explore_vintage && j.explore_vintage.matches) || [];
  };

  try {
    let matches = await zoek(term);
    if (matches === null) return null;

    // Hoort er iets bij DEZE wijn? Zo niet, dan is een strakkere zoekterm met enkel
    // de onderscheidende woorden veel kansrijker: die geeft een korte, gerichte lijst
    // in plaats van een brede waarin de juiste wijn buiten beeld kan vallen.
    const wil = vTokens(term);
    const past = (m) => {
      const w = (m.vintage || {}).wine || {};
      const hay = vTokens(((w.winery && w.winery.name) || "") + " " + (w.name || ""));
      return wil.length ? wil.filter((t) => hay.includes(t)).length / wil.length >= 0.6 : false;
    };
    // Drie pogingen, elk alleen als de vorige niets opleverde dat bij deze wijn hoort:
    // 1) de volledige term, 2) enkel de onderscheidende woorden, 3) zonder marktfilter.
    let pogingen = 1;
    if (!matches.some(past)) {
      const kern = wil.join(" ");
      if (kern && kern !== term) {
        pogingen++;
        const tweede = await zoek(kern);
        if (tweede && tweede.length) matches = tweede.concat(matches);
      }
      if (!matches.some(past)) {
        pogingen++;
        const derde = await zoek(kern || term, "");
        if (derde && derde.length) matches = derde.concat(matches);
      }
    }
    vivinoPogingen = pogingen;

    const gezien = new Set();
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
        // etiketfoto van deze jaargang (Vivino levert meerdere uitsneden)
        image: (() => {
          const im = v.image || {};
          const kies = (im.variations && (im.variations.label_large || im.variations.label_medium || im.variations.bottle_large)) || im.location || "";
          return kies ? (String(kies).startsWith("//") ? "https:" + kies : String(kies)) : "";
        })(),
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
      .filter((o) => o.price || (o.rating && o.ratings))
      // de twee zoekopdrachten kunnen dezelfde wijn opleveren
      .filter((o) => { const k = `${o.producer}|${o.name}|${o.vintage}`; if (gezien.has(k)) return false; gezien.add(k); return true; });
  } catch { return null; }
}

// ---------- prijzen van de winkelpagina zelf ----------
// Webshops zetten hun prijs machineleesbaar in de pagina (schema.org/Product met
// offers.price). Dat is betrouwbaarder dan tekstherkenning: het is een veld, geen
// zin. We doen dit alleen wanneer de gewone bronnen niets opleverden.
const GEEN_WINKEL = /wikipedia\.org|vivino\.com|facebook\.|instagram\.|youtube\.|reddit\.|cellartracker|wine-searcher/i;

function prijsUitHtml(html) {
  const uit = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const loop = (o) => {
        if (!o || typeof o !== "object") return;
        if (o.offers) {
          for (const aanbod of [].concat(o.offers)) {
            if (!aanbod || typeof aanbod !== "object") continue;
            const p = parseFloat(aanbod.price ?? (aanbod.priceSpecification || {}).price);
            const spec = aanbod.priceSpecification || {};
            if (p > 0) uit.push({
              price: p,
              currency: String(aanbod.priceCurrency || spec.priceCurrency || "EUR").toUpperCase(),
              naam: String(o.name || ""),
              exclBtw: spec.valueAddedTaxIncluded === false,
            });
          }
        }
        Object.values(o).forEach(loop);
      };
      loop(JSON.parse(m[1].trim()));
    } catch { /* volgend blok */ }
  }
  if (uit.length) return uit;
  // terugval: meta-tags zoals product:price:amount
  const meta = /(?:product:price:amount|og:price:amount)["'][^>]*content=["']([^"']+)/i.exec(html)
    || /itemprop=["']price["'][^>]*content=["']([^"']+)/i.exec(html);
  if (meta) {
    const p = parseFloat(String(meta[1]).replace(",", "."));
    const mm = /(?:product:price:currency|og:price:currency)["'][^>]*content=["']([A-Z]{3})/i.exec(html);
    if (p > 0) uit.push({ price: p, currency: mm ? mm[1].toUpperCase() : "EUR", naam: "", exclBtw: false });
  }
  return uit;
}

async function paginaPrijzen(urls, term) {
  const wil = vTokens(term);
  const kandidaten = (urls || []).filter((u) => /^https?:\/\//.test(u) && !GEEN_WINKEL.test(u)).slice(0, 3);
  const resultaten = await Promise.all(kandidaten.map(async (u) => {
    try {
      const c = new AbortController();
      const to = setTimeout(() => c.abort(), 7000);
      const r = await fetch(u, { headers: { "user-agent": UA, accept: "text/html" }, signal: c.signal, redirect: "follow" });
      clearTimeout(to);
      if (!r.ok) return null;
      const html = (await r.text()).slice(0, 400000);
      const titel = strip((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || "");
      const gevonden = prijsUitHtml(html);
      if (!gevonden.length) return null;
      // gaat deze pagina wel over DEZE wijn?
      const hooi = vTokens(`${titel} ${gevonden[0].naam}`);
      if (wil.length && wil.filter((t) => hooi.includes(t)).length / wil.length < 0.6) return null;
      const beste = gevonden[0];
      return { price: beste.price, currency: beste.currency, exclBtw: beste.exclBtw, url: u, title: titel.slice(0, 120) };
    } catch { return null; }
  }));
  return resultaten.filter(Boolean);
}

// ---------- coördinaten ----------
// Het model liet zich hier niet op vertrouwen: het gaf per jaargang van dezelfde
// wijn een andere plek, en meestal de verkeerde. Nominatim (OpenStreetMap) is
// gratis, vereist geen sleutel en geeft voor dezelfde streek altijd hetzelfde punt.
// Hun beleid: hoogstens één bevraging per seconde en een herkenbare user-agent.
const geoCache = new Map();
let laatsteGeo = 0;

// Een appellatie is vaak geen plaats. "Pessac-Leognan" kent de kaart niet, maar
// "Leognan" wel; "Gevrey-Chambertin 1er Cru" niet, "Gevrey-Chambertin" wel. Daarom
// proberen we het stap voor stap eenvoudiger, tot er iets gevonden wordt.
function geoVarianten(q) {
  const delen = String(q || "").split(",").map((t) => t.trim()).filter(Boolean);
  const land = delen.length > 1 ? delen[delen.length - 1] : "";
  const streek = (delen.length > 1 ? delen.slice(0, -1).join(", ") : delen[0]) || "";
  const met = (t) => [t, land].filter(Boolean).join(", ");
  const uit = [String(q || "").trim()];
  const kaal = streek
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(grand|premier|1er|1e)\s*cru\b/gi, " ")
    .replace(/\b(aoc|aop|doc|docg|igt|igp|classico|riserva|superiore)\b/gi, " ")
    .replace(/\s+/g, " ").trim();
  if (kaal && kaal !== streek) uit.push(met(kaal));
  // samengestelde namen uit elkaar halen, de laatste eerst: die is meestal de plaats
  const stukken = kaal.split(/[-\u2013/]/).map((t) => t.trim()).filter((t) => t.length > 2);
  if (stukken.length > 1) for (const st of [...stukken].reverse()) uit.push(met(st));
  // staat er een hele omschrijving ("Passopisciaro, Etna, Sicilie"), probeer dan ook
  // het eerste deel apart: dat is meestal het dorp of het domein
  const losse = streek.split(",").map((t) => t.trim()).filter((t) => t.length > 2);
  if (losse.length > 1) { uit.push(met(losse[0])); uit.push(met(losse[losse.length - 1])); }
  return [...new Set(uit.filter(Boolean))];
}

async function geocodeEen(q) {
  const sleutel = String(q || "").trim().toLowerCase();
  if (!sleutel) return null;
  if (geoCache.has(sleutel)) return geoCache.get(sleutel);
  const wachten = 1100 - (Date.now() - laatsteGeo);
  if (wachten > 0) await slaap(wachten);
  laatsteGeo = Date.now();
  try {
    const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(sleutel), {
      headers: { "user-agent": "kelder-app/1.0 (persoonlijke wijnkelder)", accept: "application/json" },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const hit = Array.isArray(j) ? j[0] : null;
    const uit = hit && hit.lat && hit.lon
      ? { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), naam: strip(String(hit.display_name || "")).slice(0, 120) }
      : null;
    geoCache.set(sleutel, uit);
    return uit;
  } catch { return null; }
}

// Probeer de varianten op volgorde. Levert niets iets op, dan pas de tweede
// omschrijving (bv. het dorp dat bij de fles staat), en als allerlaatste het land:
// een ruwe plek is nog altijd beter dan geen plek, en de naam die we teruggeven
// zegt eerlijk waar de speld staat.
async function geocode(q, reserve) {
  for (const v of geoVarianten(q)) {
    const hit = await geocodeEen(v);
    if (hit) return hit;
  }
  if (reserve) {
    for (const v of geoVarianten(reserve)) {
      const hit = await geocodeEen(v);
      if (hit) return hit;
    }
  }
  const land = String(q || "").split(",").map((t) => t.trim()).filter(Boolean).pop();
  return land ? await geocodeEen(land) : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Alleen POST" }); return; }
  const body = req.body || {};
  const q = String(body.query || "").slice(0, 200);
  const wine = body.wine && typeof body.wine === "object" ? body.wine : null;
  const wiki = String(body.wiki || "").slice(0, 120);
  const pages = Array.isArray(body.pages) ? body.pages.slice(0, 6).map(String) : null;
  const geo = String(body.geo || "").slice(0, 160);
  if (geo) { res.status(200).json({ results: [], offers: [], wiki: null, geo: await geocode(geo, body.geoReserve), sources: {} }); return; }
  if (!q && !wine && !wiki && !pages) { res.status(400).json({ error: "query, wine, wiki of pages ontbreekt" }); return; }

  // aparte modus: enkel winkelpagina's openen en hun prijs uitlezen
  if (pages) {
    const prijzen = await paginaPrijzen(pages, String(body.term || ""));
    res.status(200).json({ results: [], offers: [], wiki: null, pagePrices: prijzen, rates: await ecbKoersen(), sources: { pages: prijzen.length ? "ok" : "leeg" } });
    return;
  }
  try {
    // Brave eerst; ontbreekt de sleutel of faalt hij, dan DuckDuckGo als terugval.
    const web = async () => {
      if (!q) return { items: [], bron: "", brave: "niet gevraagd" };
      const b = await brave(q);
      if (b.items !== null) return { items: b.items, bron: "Brave", brave: b.status };
      const d = await ddg(q);
      return { items: d, bron: d === null ? "" : "DuckDuckGo", brave: b.status };
    };
    const [wr, offers, wikiInfo, koersen] = await Promise.all([
      web(),
      wine ? vivino(wine) : Promise.resolve([]),
      wiki ? wikipedia(wiki) : Promise.resolve(null),
      q ? ecbKoersen() : Promise.resolve(null),
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
      rates: koersen || null,          // euro-gebaseerde ECB-dagkoersen
      sources: {
        web: staat(results, !!q),
        webBron: wr.bron,                                   // welke bron het geworden is
        brave: wr.brave,                                    // en waarom Brave het eventueel niet werd
        vivino: staat(offers, !!wine),
        vivinoPogingen,
        wikipedia: !wiki ? "niet gevraagd" : wikiInfo ? "ok" : "leeg",
      },
    });
  } catch {
    res.status(200).json({ results: [], offers: [], wiki: null, sources: { web: "fout", webBron: "", vivino: "fout", wikipedia: "fout" } });
  }
}
