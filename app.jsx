import React, { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import {
  Search, Plus, Upload, Download, Camera, X, Wine, Trash2,
  Pencil, Check, Loader2, FileSpreadsheet, AlertCircle, ArrowUpDown,
  MapPin, ExternalLink, MoreHorizontal, Layers, Save, Clipboard,
  MessageCircle, Send, MessageSquare
} from "lucide-react";

const STORAGE_KEY = "wijnkelder-flessen-v1";
const NOW = new Date().getFullYear();
// Hou dit gelijk met het cachenummer in sw.js; het gaat mee met een melding.
const APP_VERSION = "kelder-v14";

const COLORS = ["rood", "wit", "rosé", "mousserend", "versterkt", "oranje"];

const EMPTY = {
  producer: "", name: "", vintage: "", region: "", country: "",
  color: "rood", quantity: 1, location: "",
  purchasePrice: "", retailValue: "", ownValue: "",
  supplier: "", score: "", drinkFrom: "", drinkTo: "", notes: "", tasteNotes: "",
  grape: "", description: "", reviews: "", lat: "", lng: "", placeName: "", imageUrl: "", enriched: false,
  priceNote: "", priceManual: false, priceUrl: "",
};

// Een zelf ingetikte retailwaarde blijft altijd staan: een latere opzoeking mag
// ze niet overschrijven. Daarom wordt handmatige invoer apart gemarkeerd.
function fieldPatch(k, v) {
  if (k === "retailValue") return { retailValue: v, priceManual: true, priceNote: v === "" ? "" : "zelf ingevuld", priceUrl: "" };
  return { [k]: v };
}

// which value counts for portfolio math: own estimate if set, else retail
function effVal(b) {
  const hasOwn = b.ownValue !== "" && b.ownValue != null && !isNaN(parseFloat(String(b.ownValue).replace(",", ".")));
  return {
    v: hasOwn ? num(b.ownValue) : num(b.retailValue),
    fallback: !hasOwn && num(b.retailValue) > 0,
    empty: !hasOwn,
  };
}

// ---------- helpers ----------
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };
const eur = (n) =>
  new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);

function drinkStatus(b) {
  const f = parseInt(b.drinkFrom), t = parseInt(b.drinkTo);
  if (!f && !t) return { key: "unknown", label: "—", color: "var(--ink-dim)" };
  if (f && NOW < f) return { key: "wait", label: `vanaf ${f}`, color: "var(--amber)" };
  if (t && NOW > t) return { key: "past", label: "over piek", color: "var(--red)" };
  return { key: "ready", label: "op dronk", color: "var(--green)" };
}

// maturity 0..1 across the window, for the signature bar
function maturity(b) {
  const f = parseInt(b.drinkFrom), t = parseInt(b.drinkTo);
  if (!f || !t || t <= f) return null;
  return Math.max(0, Math.min(1, (NOW - f) / (t - f)));
}

// duplicate detection: same producer + name + vintage (case/space-insensitive)
const dupKey = (b) => [b.producer, b.name, b.vintage].map((x) => String(x ?? "").trim().toLowerCase()).join("|");
function findDuplicate(bottles, b, ignoreId) {
  const k = dupKey(b);
  return bottles.find((x) => x.id !== ignoreId && dupKey(x) === k);
}
// merge an incoming list into a base list, summing quantity for exact duplicates
function mergeLists(base, incoming) {
  const out = base.map((b) => ({ ...b }));
  const index = new Map(out.map((b, i) => [dupKey(b), i]));
  let added = 0, merged = 0;
  for (const inc of incoming) {
    const k = dupKey(inc);
    if (index.has(k)) {
      const i = index.get(k);
      out[i] = { ...out[i], quantity: String((num(out[i].quantity) || 0) + (num(inc.quantity) || 0)) };
      merged++;
    } else { index.set(k, out.length); out.push({ ...inc }); added++; }
  }
  return { list: out, added, merged };
}

// ---------- storage (multi-layer, best-effort) ----------
const LS = (() => {
  try { const k = "__wk_t"; window.localStorage.setItem(k, "1"); window.localStorage.removeItem(k); return window.localStorage; } catch { return null; }
})();
async function rawGet(key) {
  try { if (window.storage) { const r = await window.storage.get(key); if (r && r.value != null) return r.value; } } catch {}
  try { if (LS) { const v = LS.getItem(key); if (v != null) return v; } } catch {}
  return null;
}
async function rawSet(key, value) {
  let ok = false;
  try { if (window.storage) { await window.storage.set(key, value); ok = true; } } catch {}
  try { if (LS) { LS.setItem(key, value); ok = true; } } catch {}
  return ok;
}

function cleanBottle(b) { const { _loading, _error, _confidence, ...rest } = b; return rest; }
function encodeBackup(bottles) {
  const json = JSON.stringify(bottles.map(cleanBottle));
  try { return btoa(unescape(encodeURIComponent(json))); } catch { return json; }
}
function decodeBackup(text) {
  const t = (text || "").trim();
  if (!t) return null;
  try { const j = JSON.parse(decodeURIComponent(escape(atob(t)))); if (Array.isArray(j)) return j; } catch {}
  try { const j = JSON.parse(t); if (Array.isArray(j)) return j; } catch {}
  return null;
}

// ---------- storage ----------
async function loadBottles() {
  try {
    const raw = await rawGet(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.map((b) => {
      if (b.retailValue == null && b.currentValue != null) b.retailValue = b.currentValue;
      return { ...EMPTY, ...b };
    });
  } catch { return []; }
}
async function saveBottles(list) {
  return rawSet(STORAGE_KEY, JSON.stringify(list.map(cleanBottle)));
}

// ---------- Excel ----------
const HEADERS = {
  producer: "Producent", name: "Wijn", vintage: "Jaargang", region: "Streek",
  country: "Land", color: "Kleur", grape: "Druif", quantity: "Aantal", location: "Locatie",
  purchasePrice: "Aankoopprijs", retailValue: "Retailwaarde", ownValue: "Eigen waarde",
  supplier: "Leverancier", score: "Score", drinkFrom: "Drink vanaf", drinkTo: "Drink tot", notes: "Notities", tasteNotes: "Proefnotities",
};
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const IMPORT_MAP = {
  producent: "producer", domein: "producer", producer: "producer",
  wijn: "name", naam: "name", cuvee: "name", name: "name",
  jaargang: "vintage", jaar: "vintage", vintage: "vintage", year: "vintage",
  streek: "region", regio: "region", region: "region", appellation: "region",
  land: "country", country: "country",
  kleur: "color", color: "color", type: "color",
  druif: "grape", druiven: "grape", cepage: "grape", grape: "grape", varietal: "grape",
  aantal: "quantity", quantity: "quantity", qty: "quantity",
  locatie: "location", plaats: "location", rek: "location", location: "location",
  aankoopprijs: "purchasePrice", aankoop: "purchasePrice", purchaseprice: "purchasePrice", cost: "purchasePrice",
  retailwaarde: "retailValue", marktwaarde: "retailValue", retailprijs: "retailValue", huidigewaarde: "retailValue", currentvalue: "retailValue", marketvalue: "retailValue",
  eigenwaarde: "ownValue", eigenwaardeschatting: "ownValue", ownvalue: "ownValue", geschattewaarde: "ownValue",
  waarde: "retailValue", value: "retailValue",
  leverancier: "supplier", supplier: "supplier",
  score: "score", punten: "score",
  drinkvanaf: "drinkFrom", vanaf: "drinkFrom", drinkfrom: "drinkFrom",
  drinktot: "drinkTo", tot: "drinkTo", drinkto: "drinkTo",
  notities: "notes", opmerkingen: "notes", notes: "notes",
  proefnotities: "tasteNotes", proefnota: "tasteNotes", tastingnotes: "tasteNotes", proefnotas: "tasteNotes", degustatie: "tasteNotes",
};

function exportXlsx(bottles) {
  const rows = bottles.map((b) => {
    const o = {};
    for (const k in HEADERS) o[HEADERS[k]] = b[k] ?? "";
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(rows, { header: Object.values(HEADERS) });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Kelder");
  XLSX.writeFile(wb, `wijnkelder-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
function templateXlsx() {
  const example = {
    Producent: "Château Margaux", Wijn: "Grand Vin", Jaargang: 2015, Streek: "Margaux",
    Land: "Frankrijk", Kleur: "rood", Druif: "Cabernet Sauvignon", Aantal: 3, Locatie: "Rek A – vak 4",
    Aankoopprijs: 480, Retailwaarde: 620, "Eigen waarde": "", Leverancier: "Négociant X", Score: 98,
    "Drink vanaf": 2025, "Drink tot": 2045, Notities: "",
  };
  const ws = XLSX.utils.json_to_sheet([example], { header: Object.values(HEADERS) });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Kelder");
  XLSX.writeFile(wb, "wijnkelder-template.xlsx");
}
async function parseXlsx(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });
  return raw.map((r) => {
    const b = { ...EMPTY, id: uid() };
    for (const key in r) {
      const mapped = IMPORT_MAP[norm(key)];
      if (mapped) b[mapped] = r[key];
    }
    if (!b.quantity) b.quantity = 1;
    if (!COLORS.includes(String(b.color).toLowerCase())) b.color = "rood";
    else b.color = String(b.color).toLowerCase();
    return b;
  }).filter((b) => b.name || b.producer);
}

// ---------- Claude photo analysis ----------
function extractJson(text) {
  let t = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(t); } catch {}
  const s = t.search(/[\[{]/);
  const eObj = t.lastIndexOf("}"), eArr = t.lastIndexOf("]");
  const e = Math.max(eObj, eArr);
  if (s !== -1 && e !== -1) { try { return JSON.parse(t.slice(s, e + 1)); } catch {} }
  // salvage a truncated object: cut back to the last complete "key": value pair and close braces
  if (s !== -1) {
    let frag = t.slice(s);
    const lastComma = frag.lastIndexOf(",");
    if (lastComma > 0) {
      let candidate = frag.slice(0, lastComma);
      const opens = (candidate.match(/{/g) || []).length;
      const closes = (candidate.match(/}/g) || []).length;
      candidate += "}".repeat(Math.max(0, opens - closes));
      try { return JSON.parse(candidate); } catch {}
    }
  }
  return null;
}

const API_URL = "/api/claude";
// shared API call with robust error surfacing
async function callClaude(body) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`Server gaf geen geldig antwoord (${res.status}). Mogelijk is de foto te groot.`); }
  if (data && data.error) {
    const msg = typeof data.error === "string" ? data.error : (data.error.message || "API-fout");
    throw new Error(msg);
  }
  return data;
}

const FEEDBACK_URL = "/api/feedback";
// Anonieme melding. Er gaat niets mee behalve de tekst en de appversie; het
// adres van de bestemmeling staat enkel in een omgevingsvariabele op de server.
// De melder krijgt alleen te horen of het gelukt is, nooit waarom niet.
async function sendFeedback(message) {
  try {
    const res = await fetch(FEEDBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, version: APP_VERSION }),
    });
    const data = await res.json().catch(() => null);
    return !!(res.ok && data && data.ok);
  } catch { return false; }
}

const SEARCH_URL = "/api/search";
// free search (own endpoint) — snippets voor tekst + optionele marktprijzen.
// Faalt de prijsbron, dan blijven de snippets gewoon werken.
// De resultaten worden genummerd meegegeven, zodat het model naar een bron kan
// verwijzen met een nummer en wij daar zelf de echte URL bij zoeken.
async function fetchSearch({ query, wine, prefix = "" }) {
  try {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, wine }),
    });
    const data = await res.json();
    const items = (data && data.results) || [];
    const text = items.map((r, i) => `[${prefix}${i + 1}] ${r.title}: ${r.snippet}`).join("\n").slice(0, 2600);
    return { text, items, offers: Array.isArray(data && data.offers) ? data.offers : [] };
  } catch { return { text: "", items: [], offers: [] }; }
}
async function fetchSnippets(query) { return (await fetchSearch({ query })).text; }

// ---------- marktprijs uit echte aanbiedingen ----------
// Woorden die niets onderscheidends zeggen en dus niet meetellen bij het matchen.
const PRICE_STOP = new Set(["the", "and", "van", "der", "des", "del", "della", "dei", "les", "las",
  "chateau", "château", "domaine", "weingut", "tenuta", "bodega", "bodegas", "cantina", "azienda",
  "agricola", "wijn", "wine", "vino", "vin", "cru", "grand", "premier", "classe", "classé", "reserva", "riserva"]);
const keyTokens = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length > 2 && !PRICE_STOP.has(t));
const tokenRatio = (want, hay) => (want.length ? want.filter((t) => hay.includes(t)).length / want.length : 0);
// hoe zeker hoort dit aanbod bij deze fles? 0..1
function offerMatch(offer, b) {
  const hay = [...keyTokens(offer.producer), ...keyTokens(offer.name)];
  const p = keyTokens(b.producer), n = keyTokens(b.name);
  if (!hay.length || (!p.length && !n.length)) return 0;
  const rp = tokenRatio(p, hay), rn = tokenRatio(n, hay);
  if (!p.length) return rn;
  if (!n.length) return rp;
  return 0.6 * rp + 0.4 * rn;
}
const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 100) / 100;
};
// bron-URL van het aanbod dat het dichtst bij de gekozen prijs ligt
const nearestUrl = (pool, price) =>
  (pool.map((o) => ({ u: o.url || "", d: Math.abs(num(o.price) - price) }))
    .filter((x) => x.u).sort((a, c) => a.d - c.d)[0] || {}).u || "";

// kies een marktprijs: eerst de exacte jaargang, anders naburige jaargangen van dezelfde wijn
function marketPrice(offers, b) {
  const cand = (offers || []).filter((o) => num(o.price) > 0 && (!o.volumeMl || o.volumeMl === 750) && offerMatch(o, b) >= 0.55);
  if (!cand.length) return null;
  const y = parseInt(b.vintage);
  const exact = y ? cand.filter((o) => parseInt(o.vintage) === y) : [];
  if (exact.length) {
    const price = median(exact.map((o) => num(o.price)));
    return { price, basis: "exact", n: exact.length, years: [y], url: nearestUrl(exact, price) };
  }
  const near = y ? cand.filter((o) => Math.abs(parseInt(o.vintage) - y) <= 5) : [];
  const pool = near.length ? near : cand;
  const years = [...new Set(pool.map((o) => o.vintage).filter(Boolean))].sort();
  const price = median(pool.map((o) => num(o.price)));
  return { price, basis: "nabij", n: pool.length, years, url: nearestUrl(pool, price) };
}
// Vivino-score van dezelfde wijn: eerst deze jaargang, anders de jaargang met de
// meeste beoordelingen (die wordt dan expliciet als 'andere jaargang' gemeld)
function vivinoRating(offers, b) {
  const cand = (offers || []).filter((o) => num(o.rating) > 0 && num(o.ratings) > 0 && offerMatch(o, b) >= 0.55);
  if (!cand.length) return null;
  const best = (arr) => arr.reduce((a, c) => (num(c.ratings) > num(a.ratings) ? c : a));
  const y = parseInt(b.vintage);
  const exact = y ? cand.filter((o) => parseInt(o.vintage) === y) : [];
  const pick = best(exact.length ? exact : cand);
  return { rating: num(pick.rating), ratings: num(pick.ratings), vintage: pick.vintage, exact: exact.length > 0 };
}
// vaste zin met de echte Vivino-cijfers; nooit door het model geschreven
function vivinoLine(vr) {
  if (!vr) return "";
  const score = vr.rating.toFixed(1).replace(".", ",");
  const n = vr.ratings.toLocaleString("nl-BE");
  return vr.exact
    ? `Vivino ${score}/5 uit ${n} beoordelingen (jaargang ${vr.vintage}).`
    : `Vivino ${score}/5 uit ${n} beoordelingen van jaargang ${vr.vintage}, ter indicatie.`;
}

// leesbare lijst voor de AI-prompt (blijft klein: max 12 regels)
function offerLines(offers, b) {
  return (offers || [])
    .filter((o) => num(o.price) > 0 && (!o.volumeMl || o.volumeMl === 750) && offerMatch(o, b) >= 0.55)
    .sort((a, c) => Math.abs(num(a.vintage) - num(b.vintage)) - Math.abs(num(c.vintage) - num(b.vintage)))
    .slice(0, 12)
    .map((o) => `- ${[o.producer, o.name].filter(Boolean).join(" ")} ${o.vintage}: € ${o.price}`)
    .join("\n");
}

const WINE_SCHEMA = `{
  "producer": "domein/producent",
  "name": "naam van de cuvée",
  "vintage": jaargang als getal of "NV",
  "region": "streek/appellation",
  "country": "land",
  "color": "één van: rood, wit, rosé, mousserend, versterkt, oranje",
  "grape": "druif/druiven met percentages indien gekend, bv. 'Nerello Mascalese 90%, Nerello Cappuccio 10%'",
  "description": "korte beschrijving van de wijn in het Nederlands, 1-2 zinnen",
  "drinkFrom": beste drinkjaar vanaf (getal),
  "drinkTo": beste drinkjaar tot (getal),
  "score": kritiekscore 0-100 indien gekend anders null,
  "confidence": "hoog, midden of laag",
  "notes": "korte relevante nota"
}`;

// images: array of { base64, media } — may be multiple photos (front/back) of the SAME bottle
async function analyzePhoto(images) {
  const imgs = Array.isArray(images) ? images : [images];
  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    system:
      "Je bent een ervaren sommelier en wijnexpert. De foto's tonen ALLEMAAL DEZELFDE fles (bv. voor- en achteretiket); combineer alle informatie tot één identificatie. " +
      "Bepaal alles uit het etiket en je eigen kennis, zonder externe bronnen. Geef GEEN prijs: prijzen worden apart opgezocht bij echte winkels. Hou de beschrijving op één korte zin. " +
      "Begin je antwoord met '{' en eindig met '}'. Antwoord UITSLUITEND met het volledige, geldige JSON-object volgens het schema, zonder enige tekst, uitleg of markdown ervoor of erna.",
    messages: [{
      role: "user",
      content: [
        ...imgs.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media, data: im.base64 } })),
        { type: "text", text: `Identificeer deze wijn (alle foto's zijn dezelfde fles) en geef exact dit JSON-object terug:\n${WINE_SCHEMA}` },
      ],
    }],
  };
  const data = await callClaude(body);
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const parsed = extractJson(text);
  if (!parsed) throw new Error("Kon de wijn niet lezen uit dit resultaat.");
  return parsed;
}

// identify a wine from a typed name (fallback when a photo isn't recognized)
async function searchWineByName(query) {
  const ctx = await fetchSnippets(`${query} wijn`);
  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1400,
    system:
      "Je bent een ervaren sommelier. Identificeer de wijn op basis van de zoekterm en de meegeleverde zoekresultaten, aangevuld met je eigen kennis. " +
      "Geef GEEN prijs: prijzen worden apart opgezocht bij echte winkels. " +
      "Begin je antwoord met '{' en eindig met '}'. Antwoord UITSLUITEND met het volledige, geldige JSON-object volgens het schema, zonder tekst errond of markdown.",
    messages: [{ role: "user", content: `Zoekterm: ${query}\n\nZoekresultaten:\n${ctx || "(geen)"}\n\nGeef exact dit JSON-object terug:\n${WINE_SCHEMA}` }],
  };
  const data = await callClaude(body);
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const parsed = extractJson(text);
  if (!parsed) throw new Error("Niets gevonden voor deze zoekterm.");
  return parsed;
}

// full per-vintage lookup: price, drink window, reviews, description, location — all vintage-specific
async function lookupWineFull(b) {
  const schema = `{
  "grape": "druif/druiven met percentages indien gekend, bv. 'Nerello Mascalese 90%, Nerello Cappuccio 10%'",
  "description": "beschrijving van deze wijn en jaargang in het Nederlands, 2-3 zinnen",
  "retailPrice": winkelprijs per fles van 75 cl in EUR die LETTERLIJK in de zoekresultaten staat, anders null (nooit zelf schatten),
  "priceVintage": jaargang waarop die prijs slaat (getal) of null,
  "priceSource": "naam van de winkel of website uit de zoekresultaten waar die prijs staat, anders null",
  "priceSourceIndex": het nummer [n] van het zoekresultaat waar die prijs staat, anders null,
  "drinkFrom": beste drinkjaar vanaf voor deze jaargang (getal),
  "drinkTo": beste drinkjaar tot voor deze jaargang (getal),
  "score": kritiekscore 0-100 die in de zoekresultaten staat voor DEZE jaargang, anders null,
  "reviews": "2 à 3 zinnen samenvatting van wat proevers en recensenten over deze wijn schrijven, in het Nederlands, met de bronnaam erbij; gaat het over een andere jaargang, begin dan met 'Recensie van jaargang JAAR, ter indicatie:'; is er niets, schrijf dan exact 'Geen recensie gevonden.'",
  "placeName": "plaats waar de wijn gemaakt wordt (domein, streek, land)",
  "lat": breedtegraad als getal,
  "lng": lengtegraad als getal
}`;
  const wijn = [b.producer, b.name, b.vintage, "-", b.region, b.country].filter(Boolean).join(" ");
  const naam = [b.producer, b.name, b.vintage].filter(Boolean).join(" ");
  // twee gratis zoekopdrachten: één voor prijs/algemeen, één gericht op recensies
  const [main, rev] = await Promise.all([
    fetchSearch({
      query: `${naam} wijn prijs per fles`,
      wine: { producer: b.producer, name: b.name, vintage: b.vintage },
    }),
    fetchSearch({ query: `${naam} recensie review tasting notes proefnotities`, prefix: "R" }),
  ]);
  const { text: ctx, items, offers } = main;
  const mp = marketPrice(offers, b);
  const vr = vivinoRating(offers, b);
  const lines = offerLines(offers, b);
  const priceCtx = lines
    ? `Echte winkelprijzen (75 cl, EUR, Belgische markt):\n${lines}\n` +
      (mp ? (mp.basis === "exact"
        ? `Prijs voor jaargang ${b.vintage}: € ${mp.price}. Die wordt automatisch gebruikt; laat retailPrice op null.\n`
        : `Voor jaargang ${b.vintage} is er geen aanbod; naburige jaargangen (${mp.years.join(", ")}) liggen rond € ${mp.price}. Die wordt automatisch gebruikt; laat retailPrice op null.\n`) : "")
    : "Geen winkelprijzen gevonden. Vul retailPrice enkel in als er een concreet bedrag in de zoekresultaten hieronder staat, met de bron erbij; anders null.\n";
  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1400,
    system:
      "Je bent een ervaren sommelier. Voor prijzen, scores en recensies gebruik je UITSLUITEND de meegeleverde zoekresultaten; je eigen kennis mag enkel de beschrijving, de druif, het drinkvenster en de locatie invullen. " +
      "Prijs: nooit schatten. Staat er geen concreet bedrag in de zoekresultaten, dan is retailPrice null. Het gaat altijd om één fles van 75 cl. " +
      "Recensies: schrijf 2 à 3 zinnen over hoe deze wijn proeft en wat recensenten ervan vinden, ALLEEN op basis van de meegeleverde recensieresultaten, met de bronnaam erbij. " +
      "Verzin nooit een citaat, punt of bron. Vind je niets voor deze jaargang, dan mag je recensies van een ANDERE jaargang van dezelfde wijn samenvatten, " +
      "maar dan begint reviews verplicht met 'Recensie van jaargang JAAR, ter indicatie:' en blijft score null. Staat er in de resultaten echt niets over deze wijn, dan is reviews exact 'Geen recensie gevonden.' " +
      "Vermeld Vivino niet in reviews; die score wordt er automatisch bij gezet. " +
      "Verwijs bij een prijs met priceSourceIndex naar het nummer van het zoekresultaat waar dat bedrag staat. " +
      "Begin met '{' en eindig met '}'. Antwoord UITSLUITEND met het volledige geldige JSON-object volgens het schema, zonder tekst errond of markdown.",
    messages: [{
      role: "user",
      content: `Wijn en jaargang: ${wijn}\n\n${priceCtx}\nZoekresultaten:\n${ctx || "(geen)"}\n\n` +
        `Recensies en proefnotities uit een aparte zoekopdracht:\n${rev.text || "(geen)"}\n\n` +
        `Geef exact dit JSON-object terug:\n${schema}`,
    }],
  };
  const data = await callClaude(body);
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const parsed = extractJson(text);
  if (!parsed) throw new Error("Kon jaargang niet opzoeken.");
  return applyReviews(applyMarketPrice(parsed, mp, b, items), vr);
}

// Prijs: enkel echte bedragen. Volgorde: (1) marktprijs voor exact deze jaargang,
// (2) marktprijs van naburige jaargangen, (3) een bedrag dat het model letterlijk
// uit de zoekresultaten haalde (met bron), (4) niets — dan blijft de prijs leeg.
// De bron-URL komt altijd uit onze eigen lijst (via het nummer van het
// zoekresultaat), nooit uit de tekst van het model: zo kan ze niet verzonnen zijn.
function applyMarketPrice(res, mp, b, items) {
  const found = num(res.retailPrice);
  const src = String(res.priceSource || "").trim();
  const idx = parseInt(res.priceSourceIndex);
  const hit = idx > 0 && Array.isArray(items) ? items[idx - 1] : null;
  if (mp && mp.basis === "exact") {
    res.retailPrice = mp.price;
    res.priceNote = `marktprijs jaargang ${b.vintage} (${mp.n} aanbieding${mp.n > 1 ? "en" : ""}, 75 cl)`;
    res.priceUrl = mp.url || "";
  } else if (mp) {
    res.retailPrice = mp.price;
    res.priceNote = `marktprijs van jaargang${mp.years.length > 1 ? "en" : ""} ${mp.years.join(", ")}, ter indicatie`;
    res.priceUrl = mp.url || "";
  } else if (found > 0 && src) {
    const py = parseInt(res.priceVintage), y = parseInt(b.vintage);
    res.retailPrice = found;
    res.priceNote = py && y && py !== y
      ? `winkelprijs van jaargang ${py} bij ${src}, ter indicatie`
      : `winkelprijs uit de zoekresultaten (${src})`;
    res.priceUrl = (hit && hit.url) || "";
  } else {
    res.retailPrice = "";
    res.priceNote = "geen prijs gevonden";
    res.priceUrl = "";
  }
  return res;
}

// Vivino-score met aantal beoordelingen erbij, met de jaargang expliciet vermeld.
function applyReviews(res, vr) {
  const line = vivinoLine(vr);
  const cur = String(res.reviews || "").trim();
  const none = !cur || /geen recensie/i.test(cur);
  if (!line) { res.reviews = none ? "Geen recensie gevonden." : cur; return res; }
  res.reviews = none ? line : `${cur} ${line}`;
  return res;
}

// map an analysis/search result into a bottle draft
function resultToData(res) {
  return {
    ...EMPTY, id: uid(),
    producer: res.producer || "", name: res.name || "",
    vintage: res.vintage ?? "", region: res.region || "", country: res.country || "",
    color: COLORS.includes(String(res.color).toLowerCase()) ? String(res.color).toLowerCase() : "rood",
    grape: res.grape || "", description: res.description || "",
    quantity: 1, location: "",
    // prijs komt nooit uit de etiketlezing zelf, enkel uit de opzoeking bij winkels
    purchasePrice: "", retailValue: "", ownValue: "",
    supplier: "", score: res.score ?? "",
    drinkFrom: res.drinkFrom ?? "", drinkTo: res.drinkTo ?? "",
    notes: res.notes || "",
    priceNote: "", priceUrl: "",
    _confidence: res.confidence || "",
  };
}

// velden die 'Info opzoeken' oplevert, samengevoegd met wat er al staat.
// Een gevonden winkelprijs mag een prijs van een eerdere opzoeking WEL corrigeren,
// maar een zelf ingevulde prijs (en eigen waarde/aankoopprijs) blijft altijd staan.
// Wordt er niets gevonden, dan blijft de prijs leeg — nooit een schatting.
function enrichPatch(b, r, { keepFilled = false } = {}) {
  const keep = (cur, next) => (keepFilled && cur !== "" && cur != null ? cur : (next ?? cur ?? ""));
  const found = num(r.retailPrice) > 0;
  const had = b.retailValue !== "" && b.retailValue != null;
  const locked = b.priceManual || (keepFilled && had);
  const price = locked || !found
    ? { retailValue: b.retailValue ?? "", priceNote: had ? (b.priceNote || "") : "geen prijs gevonden", priceUrl: had ? (b.priceUrl || "") : "" }
    : { retailValue: r.retailPrice, priceNote: r.priceNote || "", priceUrl: r.priceUrl || "" };
  return {
    grape: b.grape || r.grape || "",
    description: r.description || b.description || "",
    reviews: r.reviews || b.reviews || "",
    placeName: r.placeName || b.placeName || "",
    lat: r.lat ?? b.lat ?? "",
    lng: r.lng ?? b.lng ?? "",
    ...price,
    drinkFrom: keep(b.drinkFrom, r.drinkFrom),
    drinkTo: keep(b.drinkTo, r.drinkTo),
    score: keep(b.score, r.score),
    enriched: true,
  };
}

// ---------- Vraag de sommelier ----------
// De APP filtert eerst zelf op de harde criteria uit de vraag (prijs, kleur,
// status). Enkel de flessen die daaraan voldoen gaan mee als kandidatenlijst.
// Zo kan het model niets aanraden dat niet aan je vraag voldoet, en blijft de
// context klein genoeg om de kost per vraag laag te houden.
const SOMM_MAX_CHARS = 30000;
const SOMM_LEGENDE = "producent en wijn | jaargang | kleur | druif | streek | prijs per fles | drinkvenster en status | aantal | locatie | score | proefnotities";

// Deze functie is bewust deterministisch: geen AI, gewoon lezen wat er staat.
function parseCriteria(q) {
  const s = " " + String(q || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") + " ";
  const c = {};
  // maximumprijs: "onder 50 euro", "max 40", "minder dan 30", "tot € 25", "<50"
  const price = /(?:onder(?:\s+de)?|max(?:imaal|imum)?|minder\s+dan|goedkoper\s+dan|tot|budget\s+van|<)\s*(?:€\s*)?(\d{1,5})|€\s*(\d{1,5})\s*(?:of\s+minder|max)/.exec(s);
  if (price) {
    const n = parseInt(price[1] || price[2]);
    const isYear = n >= 1900 && n <= 2100 && !/€|euro/.test(s);
    if (n > 0 && !isYear) c.maxPrice = n;
  }
  // kleur
  if (/\brode?\b|\brood\b/.test(s)) c.color = "rood";
  else if (/\bwitte?\b|\bwit\b/.test(s)) c.color = "wit";
  else if (/\brose\b|\brosee?\b/.test(s)) c.color = "rosé";
  else if (/mousserend|bubbel|champagne|cava|prosecco|schuimwijn/.test(s)) c.color = "mousserend";
  else if (/versterkt|porto|sherry|madeira/.test(s)) c.color = "versterkt";
  else if (/oranje\s*wijn|orange\s*wine/.test(s)) c.color = "oranje";
  // nu drinkbaar
  if (/op\s*dronk|nu\s+(?:te\s+)?drink|drinkklaar|klaar\s+om\s+te\s+drinken|vanavond|nu\s+open/.test(s)) c.readyNow = true;
  return c;
}
const critLabels = (c) => [
  c.maxPrice ? `maximaal € ${c.maxPrice} per fles` : "",
  c.color ? `kleur ${c.color}` : "",
  c.readyNow ? "nu op dronk" : "",
].filter(Boolean);

// past deze fles bij de harde criteria? (prijs onbekend telt niet als 'onder X')
function matchesCriteria(b, c) {
  if ((num(b.quantity) || 0) <= 0) return false;
  if (c.color && String(b.color).toLowerCase() !== c.color) return false;
  if (c.readyNow && drinkStatus(b).key !== "ready") return false;
  if (c.maxPrice) { const v = effVal(b).v; if (!(v > 0) || v > c.maxPrice) return false; }
  return true;
}
// niets gevonden? dan laten we criteria één voor één vallen om te tonen wat er
// het dichtst bij komt — expliciet gemarkeerd als 'voldoet niet'
function relaxCriteria(bottles, c) {
  const steps = [
    { drop: "prijs", c: { ...c, maxPrice: null } },
    { drop: "status", c: { ...c, maxPrice: null, readyNow: false } },
    { drop: "kleur", c: {} },
  ];
  for (const s of steps) {
    const list = bottles.filter((b) => matchesCriteria(b, s.c));
    if (list.length) return { list: list.slice(0, 25), relaxed: s.drop };
  }
  return { list: [], relaxed: null };
}

function cellarLine(b, withNotes) {
  const st = drinkStatus(b);
  const window = [b.drinkFrom, b.drinkTo].filter(Boolean).join("-");
  const v = effVal(b).v;
  const parts = [
    [b.producer, b.name].filter(Boolean).join(" ") || "onbekende wijn",
    b.vintage || "NV",
    b.color,
    b.grape,
    [b.region, b.country].filter(Boolean).join(", "),
    v > 0 ? `€${Math.round(v)}` : "prijs onbekend",
    [window, st.label !== "—" ? st.label : ""].filter(Boolean).join(" ") || "geen drinkvenster",
    `${num(b.quantity) || 1}x`,
    b.location,
    num(b.score) > 0 ? `score ${b.score}` : "",
  ];
  let line = parts.filter(Boolean).join(" | ");
  if (withNotes && b.tasteNotes) line += ` | proefnota: ${String(b.tasteNotes).replace(/\s+/g, " ").slice(0, 200)}`;
  if (withNotes && b.description) line += ` | over de wijn: ${String(b.description).replace(/\s+/g, " ").slice(0, 200)}`;
  return line.slice(0, 500);
}
// bouwt de lijst op; wordt ze te groot, dan vallen eerst de proefnotities
// weg en pas daarna de laatste wijnen (dat wordt dan gemeld in het antwoord)
function cellarContext(bottles) {
  const build = (withNotes) => bottles.map((b, i) => `${i + 1}. ${cellarLine(b, withNotes)}`);
  let lines = build(true);
  let notesDropped = false;
  if (lines.join("\n").length > SOMM_MAX_CHARS) { lines = build(false); notesDropped = true; }
  const kept = [];
  let len = 0;
  for (const l of lines) {
    if (len + l.length + 1 > SOMM_MAX_CHARS) break;
    kept.push(l); len += l.length + 1;
  }
  return { text: kept.join("\n"), cut: bottles.length - kept.length, notesDropped };
}

// Sonnet in plaats van Haiku: dit is de enige functie waar de eigenaar bewust
// voor een duurder model koos (±2 cent per vraag). Zie CLAUDE.md.
const SOMMELIER_MODEL = "claude-sonnet-4-6";
const SOMM_SYSTEM =
  "Je bent de persoonlijke sommelier van deze wijnkelder. Je krijgt een KANDIDATENLIJST: dat zijn de flessen die de app al selecteerde omdat ze aan de harde criteria van de vraag voldoen. " +
  "Regels: (1) beveel UITSLUITEND flessen uit die kandidatenlijst aan, nooit een wijn die er niet in staat; " +
  "(2) verzin nooit een prijs, jaargang, score, streek of proefnota die er niet bij staat; " +
  "(3) respecteer alle criteria die bij de vraag staan; " +
  "(4) leg bij elke aanbeveling in één of twee zinnen uit waarom die wijn bij het gerecht of de gelegenheid past — verwijs naar druif, streek, stijl of de proefnotities; " +
  "(5) noem telkens producent, wijn en jaargang, en de locatie in de kelder als die gekend is; " +
  "(6) geef maximaal vier suggesties, de beste eerst; " +
  "(7) staat de lijst als 'voldoet NIET aan alle criteria' gemarkeerd, zeg dan eerlijk dat er niets past en zeg er bij elke suggestie expliciet bij wat er niet klopt (te duur, nog te jong, andere kleur). Is de lijst leeg, zeg dan gewoon dat je niets passends vindt. " +
  "Antwoord in vlot, informeel Nederlands (Vlaams), zonder tabellen en zonder markdown-opmaak: korte alinea's of streepjes.";

async function askSommelier({ bottles, question, history }) {
  const crit = parseCriteria(question);
  const labels = critLabels(crit);
  const strict = bottles.filter((b) => matchesCriteria(b, crit));
  const fallback = strict.length ? null : relaxCriteria(bottles, crit);
  const cand = strict.length ? strict : (fallback ? fallback.list : []);
  const { text, cut, notesDropped } = cellarContext(cand);
  // hoeveel flessen vielen af omdat we hun prijs niet kennen? dat is eerlijker
  // dan ze stilzwijgend weg te laten
  const noPrice = crit.maxPrice
    ? bottles.filter((b) => (num(b.quantity) || 0) > 0 && !(effVal(b).v > 0)).length : 0;
  // vorige beurten gaan beknopt mee, zodat een vervolgvraag context heeft
  const hist = (history || []).slice(-2)
    .map((t) => `Eerdere vraag: ${t.q}\nJouw eerdere antwoord (beknopt): ${String(t.a).replace(/\s+/g, " ").slice(0, 600)}`)
    .join("\n\n");
  const kop = strict.length
    ? `Kandidaten uit mijn kelder (${cand.length} flessen die voldoen aan: ${labels.length ? labels.join(", ") : "geen harde criteria"})`
    : `Deze flessen voldoen NIET aan alle criteria (${labels.join(", ") || "—"}); er is niets dat wel voldoet`;
  const body = {
    model: SOMMELIER_MODEL,
    max_tokens: 900,
    thinking: { type: "disabled" },
    system: SOMM_SYSTEM,
    messages: [{
      role: "user",
      content:
        (labels.length ? `Harde criteria uit mijn vraag: ${labels.join(", ")}.\n\n` : "") +
        `${kop}.\nFormaat per regel: ${SOMM_LEGENDE}\n${text || "(geen enkele fles)"}\n` +
        (cut ? `\n(${cut} kandidaten zijn niet meegestuurd omdat de lijst te lang is; zeg dat erbij.)\n` : "") +
        (notesDropped ? "(proefnotities zijn weggelaten om plaats te sparen)\n" : "") +
        (noPrice ? `(${noPrice} wijnen zijn weggelaten omdat hun prijs niet gekend is; vermeld dat kort.)\n` : "") +
        (hist ? `\n${hist}\n` : "") +
        `\nMijn vraag: ${question}`,
    }],
  };
  const data = await callClaude(body);
  const out = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  if (!out) throw new Error("Geen antwoord gekregen.");
  return out;
}

// ==================================================================
export default function App() {
  const [bottles, setBottles] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [fColor, setFColor] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [sort, setSort] = useState("producer");
  const [edit, setEdit] = useState(null);          // bottle being edited or new
  const [photoJobs, setPhotoJobs] = useState(null); // array of {id,status,preview,data,error}
  const [importPending, setImportPending] = useState(null);
  const [detail, setDetail] = useState(null);       // bottle being viewed on its card
  const scale = 1;
  const [toast, setToast] = useState("");
  const [savedAt, setSavedAt] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dupPrompt, setDupPrompt] = useState(null); // { incoming, existing, source }
  const [showBackup, setShowBackup] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [confirmReq, setConfirmReq] = useState(null); // { message, action }
  const askConfirm = (message, action) => setConfirmReq({ message, action });
  const [bulkInit, setBulkInit] = useState(null);
  const [showSomm, setShowSomm] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [sommThread, setSommThread] = useState([]); // [{q, a}] — blijft bewaard tijdens de sessie

  const fileImport = useRef();
  const filePhoto = useRef();
  const filePhotoOne = useRef();
  const filePhotoAdd = useRef();
  const [addTarget, setAddTarget] = useState(null);
  const bottlesRef = useRef(bottles);
  useEffect(() => { bottlesRef.current = bottles; }, [bottles]);

  useEffect(() => { loadBottles().then((b) => { setBottles(b); setLoaded(true); }); }, []);
  // single source of truth for saving: persist on every change to bottles
  useEffect(() => {
    if (!loaded) return;
    saveBottles(bottles).then((ok) => { if (ok !== false) setSavedAt(new Date()); });
  }, [bottles, loaded]);
  // extra safety: also save when the app is hidden or closed
  useEffect(() => {
    const save = () => { if (bottlesRef.current.length) saveBottles(bottlesRef.current); };
    const onVis = () => { if (document.hidden) save(); };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("pagehide", save); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  const persist = (next) => setBottles(next);
  // patch a single bottle by id (safe under parallel updates); keeps detail view in sync
  const patchBottle = (id, patch) => {
    setBottles((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    setDetail((d) => (d && d.id === id ? { ...d, ...patch } : d));
  };
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  const countries = useMemo(
    () => [...new Set(bottles.map((b) => b.country).filter(Boolean))].sort(), [bottles]);

  const filtered = useMemo(() => {
    let list = bottles.filter((b) => {
      if (fColor && String(b.color).toLowerCase() !== fColor) return false;
      if (fStatus && drinkStatus(b).key !== fStatus) return false;
      if (query) {
        const q = query.toLowerCase();
        const hay = [b.producer, b.name, b.region, b.country, b.location, b.vintage, b.supplier]
          .join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const s = sort;
    list = [...list].sort((a, b) => {
      if (s === "value") return effVal(b).v * num(b.quantity) - effVal(a).v * num(a.quantity);
      if (s === "vintage") return num(a.vintage) - num(b.vintage);
      if (s === "drinkTo") return (num(a.drinkTo) || 9999) - (num(b.drinkTo) || 9999);
      return `${a.producer} ${a.name}`.localeCompare(`${b.producer} ${b.name}`);
    });
    return list;
  }, [bottles, query, fColor, fStatus, sort]);

  const stats = useMemo(() => {
    let flessen = 0, cost = 0, value = 0;
    for (const b of bottles) {
      const q = num(b.quantity) || 0;
      flessen += q; cost += num(b.purchasePrice) * q; value += effVal(b).v * q;
    }
    const gain = value - cost;
    const pct = cost > 0 ? (gain / cost) * 100 : 0;
    return { flessen, wijnen: bottles.length, cost, value, gain, pct };
  }, [bottles]);

  // ---- CRUD ----
  // behoudt een al toegekende id, zodat een achtergrondopzoeking de juiste fles bijwerkt
  const commitNew = (list, b) => [{ ...cleanBottle(b), id: b.id || uid() }, ...list];
  // add a new bottle, but stop for confirmation if the same wine already exists
  const addOrPrompt = (b, source) => {
    const cleaned = { ...cleanBottle(b), color: String(b.color || "rood").toLowerCase() };
    const existing = findDuplicate(bottles, cleaned);
    if (existing) { setDupPrompt({ incoming: cleaned, existing, source }); return false; }
    persist(commitNew(bottles, cleaned));
    return true;
  };
  const resolveDup = (action) => {
    const dp = dupPrompt; if (!dp) return;
    if (action === "merge") {
      persist(bottles.map((x) => x.id === dp.existing.id
        ? { ...x, quantity: String((num(x.quantity) || 0) + (num(dp.incoming.quantity) || 1)) } : x));
      flash("Aantal opgeteld bij de bestaande fles.");
    } else if (action === "add") {
      persist(commitNew(bottles, dp.incoming));
      flash("Apart toegevoegd.");
    }
    if (action !== "cancel" && dp.source?.jobId) {
      setPhotoJobs((prev) => { const rest = (prev || []).filter((j) => j.id !== dp.source.jobId); return rest.length ? rest : null; });
    }
    setDupPrompt(null);
  };

  const saveEdit = () => {
    const b = { ...edit };
    if (!b.name && !b.producer) { flash("Naam of producent is verplicht."); return; }
    b.color = String(b.color).toLowerCase();
    if (b.id) { persist(bottles.map((x) => (x.id === b.id ? b : x))); setEdit(null); return; }
    const nieuw = { ...cleanBottle(b), id: uid() };
    const added = addOrPrompt(nieuw, null);
    setEdit(null);
    if (added) { flash("Toegevoegd, info wordt opgezocht…"); autoLookup(nieuw); }
  };
  // achtergrondopzoeking na handmatig toevoegen: vult enkel lege velden aan,
  // zodat wat je zelf intikte blijft staan
  const autoLookup = (b) => {
    lookupWineFull(b)
      .then((r) => { patchBottle(b.id, enrichPatch(b, r, { keepFilled: true })); flash("Info opgezocht en aangevuld."); })
      .catch(() => flash("Toegevoegd. Info opzoeken lukte niet."));
  };
  const removeBottle = (id) => persist(bottles.filter((b) => b.id !== id));

  // ---- bulk multi-vintage ----
  const addBulk = (shared, rows) => {
    let list = bottles, added = 0, merged = 0;
    rows.forEach((row) => {
      const vintage = String(row.vintage || "").trim();
      const qty = String(row.quantity || "1");
      if (!vintage) return;
      const b = { ...cleanBottle(shared), vintage, quantity: qty, color: String(shared.color || "rood").toLowerCase() };
      const existing = findDuplicate(list, b);
      if (existing) { list = list.map((x) => x.id === existing.id ? { ...x, quantity: String((num(x.quantity) || 0) + (num(qty) || 0)) } : x); merged++; }
      else { const nb = { ...b, id: uid(), enriched: false }; list = [nb, ...list]; added++; }
    });
    persist(list);
    setShowBulk(false);
    flash(`${added} toegevoegd${merged ? `, ${merged} samengevoegd` : ""}.`);
  };

  // ---- backup / restore (text, works without downloads) ----
  const doRestore = (text, mode) => {
    const parsed = decodeBackup(text);
    if (!parsed) { flash("Kon deze backup niet lezen."); return; }
    const norml = parsed.map((b) => ({ ...EMPTY, ...b, id: b.id || uid() }));
    if (mode === "replace") {
      const doIt = () => { persist(norml); flash(`${norml.length} flessen hersteld (vervangen).`); setShowRestore(false); };
      if (bottles.length) askConfirm(`Je hele kelder (${bottles.length} wijnen) vervangen door deze backup (${norml.length})?`, doIt);
      else doIt();
    } else {
      const { list, added, merged } = mergeLists(bottles, norml);
      persist(list);
      flash(`${added} hersteld${merged ? `, ${merged} samengevoegd` : ""}.`);
      setShowRestore(false);
    }
  };

  // ---- import ----
  const onImportFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { const rows = await parseXlsx(f); setImportPending(rows); }
    catch { flash("Kon dit bestand niet lezen."); }
    e.target.value = "";
  };
  const applyImport = (mode, rows) => {
    const list = rows || importPending;
    if (mode === "replace") {
      const doIt = () => { persist(list); flash(`${list.length} wijnen geïmporteerd (vervangen).`); setImportPending(null); };
      if (bottles.length) askConfirm(`Je hele kelder (${bottles.length} wijnen) vervangen door deze ${list.length}? Dit kan je niet ongedaan maken.`, doIt);
      else doIt();
    } else {
      const { list: merged, added, merged: mg } = mergeLists(bottles, list);
      persist(merged);
      flash(`${added} toegevoegd${mg ? `, ${mg} samengevoegd` : ""}.`);
      setImportPending(null);
    }
  };

  // ---- photo ----
  // read + downscale to JPEG (fixes HEIC iPhone photos and keeps uploads small/fast)
  const readImageFile = (f) => new Promise((resolve) => {
    const rd = new FileReader();
    rd.onload = async () => {
      const dataUrl = String(rd.result);
      try {
        const img = await new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i); i.onerror = rej;
          i.src = dataUrl;
        });
        const MAX = 1200;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const jpeg = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ base64: jpeg.split(",")[1], media: "image/jpeg", preview: jpeg });
      } catch {
        resolve({ base64: dataUrl.split(",")[1], media: f.type || "image/jpeg", preview: dataUrl });
      }
    };
    rd.readAsDataURL(f);
  });
  // etiket lezen en meteen de volledige info (prijs, drinkvenster, recensies) ophalen
  const runAnalyze = (jobId, images) => {
    analyzePhoto(images)
      .then((res) => {
        const data = resultToData(res);
        setPhotoJobs((prev) => prev && prev.map((j) => j.id === jobId ? { ...j, status: "enriching", data } : j));
        return runJobLookup(jobId, data);
      })
      .catch((err) => setPhotoJobs((prev) => prev && prev.map((j) => j.id === jobId ? { ...j, status: "error", error: err.message } : j)));
  };
  // tweede stap van een foto-job: info opzoeken en in het formulier zetten
  const runJobLookup = (jobId, data) =>
    lookupWineFull(data)
      .then((r) => setPhotoJobs((prev) => prev && prev.map((j) => {
        if (j.id !== jobId) return j;
        const cur = j.data || data;
        return { ...j, status: "done", data: { ...cur, ...enrichPatch(cur, r) } };
      })))
      .catch(() => setPhotoJobs((prev) => prev && prev.map((j) => j.id === jobId ? { ...j, status: "done" } : j)));
  // default: each selected photo is a separate wine
  const onPhotoFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    const jobs = await Promise.all(files.map(async (f) => {
      const im = await readImageFile(f);
      return { id: uid(), status: "pending", images: [im], preview: im.preview, data: null, error: null };
    }));
    setPhotoJobs(jobs);
    jobs.forEach((job) => runAnalyze(job.id, job.images));
  };
  // one wine, several photos (front + back) in a single analysis
  const onPhotoOneFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    const imgs = await Promise.all(files.map(readImageFile));
    const job = { id: uid(), status: "pending", images: imgs, preview: imgs[0].preview, data: null, error: null };
    setPhotoJobs([job]);
    runAnalyze(job.id, imgs);
  };
  // add extra photo(s) to an existing job and re-analyze with all of them
  const onAddPhotoToJob = (jobId) => { setAddTarget(jobId); filePhotoAdd.current.click(); };
  const onPhotoAddFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    const jobId = addTarget; setAddTarget(null);
    if (!files.length || !jobId) return;
    const imgs = await Promise.all(files.map(readImageFile));
    let all = imgs;
    setPhotoJobs((prev) => prev && prev.map((j) => {
      if (j.id !== jobId) return j;
      all = [...(j.images || []), ...imgs];
      return { ...j, images: all, preview: j.preview || imgs[0].preview, status: "pending", error: null };
    }));
    runAnalyze(jobId, all);
  };
  const addPhotoResult = (jobId) => {
    const job = photoJobs.find((j) => j.id === jobId);
    if (!job?.data) return;
    const added = addOrPrompt(job.data, { jobId });
    if (added) {
      const rest = photoJobs.filter((j) => j.id !== jobId);
      setPhotoJobs(rest.length ? rest : null);
      flash("Toegevoegd aan de kelder.");
    }
  };

  // ---- update one bottle (used by detail card + enrichment) ----
  const updateBottle = (b) => {
    persist(bottles.map((x) => (x.id === b.id ? b : x)));
    setDetail((d) => (d && d.id === b.id ? b : d));
  };
  const enrichDetail = async (b) => {
    setDetail({ ...b, _loading: true, _error: null });
    try {
      const r = await lookupWineFull(b);
      patchBottle(b.id, { ...enrichPatch(b, r), _loading: false });
    } catch (e) {
      setDetail((d) => (d && d.id === b.id ? { ...d, _loading: false, _error: e.message } : d));
    }
  };

  return (
    <div style={S.app}>
      <style>{CSS}</style>

      {/* ---- header / ledger ---- */}
      <header className="apphead" style={S.header}>
        <div style={S.brandRow}>
          <div style={S.brand}>
            <Wine size={22} strokeWidth={1.5} style={{ color: "var(--wine-bright)" }} />
            <span style={S.brandName}>Kelder</span>
            {savedAt && <span style={S.savedTag}><Check size={11} /> bewaard {savedAt.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" })}</span>}
          </div>
          <div style={S.actions}>
            <button style={S.btnGhost} onClick={() => setShowSomm(true)}><MessageCircle size={15} /> Sommelier</button>
            <button style={S.btnPrimary} onClick={() => filePhoto.current.click()}><Camera size={15} /> Foto</button>
            <button style={S.btnPrimary} onClick={() => setEdit({ ...EMPTY })}><Plus size={15} /> Fles</button>
            <div style={{ position: "relative" }}>
              <button style={S.btnGhost} onClick={() => setMenuOpen((o) => !o)} aria-label="Meer"><MoreHorizontal size={16} /></button>
              {menuOpen && (
                <>
                  <div style={S.menuBackdrop} onClick={() => setMenuOpen(false)} />
                  <div style={S.menu}>
                    <button className="mi" style={S.menuItem} onClick={() => { setMenuOpen(false); filePhotoOne.current.click(); }}><Camera size={15} /> Foto's van 1 fles (voor + achter)</button>
                    <button className="mi" style={S.menuItem} onClick={() => { setMenuOpen(false); setBulkInit(null); setShowBulk(true); }}><Layers size={15} /> Meerdere jaargangen</button>
                    <div style={S.menuSep} />
                    <button className="mi" style={S.menuItem} onClick={() => { setMenuOpen(false); setShowBackup(true); }}><Save size={15} /> Backup (kopieer)</button>
                    <button className="mi" style={S.menuItem} onClick={() => { setMenuOpen(false); setShowRestore(true); }}><Clipboard size={15} /> Herstel (plak)</button>
                    <div style={S.menuSep} />
                    <button className="mi" style={S.menuItem} onClick={() => { setMenuOpen(false); fileImport.current.click(); }}><Upload size={15} /> Excel importeren</button>
                    <button className="mi" style={S.menuItem} onClick={() => { setMenuOpen(false); exportXlsx(bottles); }}><Download size={15} /> Excel exporteren</button>
                    <div style={S.menuSep} />
                    <button className="mi" style={S.menuItem}
                      onClick={() => { setMenuOpen(false); setShowFeedback(true); }}>
                      <MessageSquare size={15} /> Meld een probleem of idee
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div style={S.ledger}>
          <Stat label="In kelder" value={`${stats.flessen} flessen`} sub={`${stats.wijnen} wijnen`} />
          <Stat label="Aankoop" value={eur(stats.cost)} />
          <Stat label="Kelderwaarde" value={eur(stats.value)} accent="gold" />
          <Stat
            label="Ongerealiseerd"
            value={`${stats.gain >= 0 ? "+" : ""}${eur(stats.gain)}`}
            sub={`${stats.gain >= 0 ? "+" : ""}${stats.pct.toFixed(1)}%`}
            accent={stats.gain >= 0 ? "green" : "red"} />
        </div>
      </header>

      {/* ---- toolbar ---- */}
      <div style={S.toolbar}>
        <div style={S.searchWrap}>
          <Search size={16} style={{ color: "var(--ink-dim)" }} />
          <input style={S.search} placeholder="Zoek producent, wijn, streek, locatie…"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select style={S.select} value={fColor} onChange={(e) => setFColor(e.target.value)}>
          <option value="">Alle kleuren</option>
          {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select style={S.select} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Elke status</option>
          <option value="ready">Op dronk</option>
          <option value="wait">Nog wachten</option>
          <option value="past">Over piek</option>
          <option value="unknown">Geen venster</option>
        </select>
        <select style={S.select} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="producer">Sorteer: naam</option>
          <option value="value">Sorteer: waarde</option>
          <option value="vintage">Sorteer: jaargang</option>
          <option value="drinkTo">Sorteer: drink tot</option>
        </select>
      </div>

      {/* ---- list ---- */}
      {!loaded ? (
        <div style={S.empty}><Loader2 className="spin" size={22} /> <span>Kelder laden…</span></div>
      ) : filtered.length === 0 ? (
        <EmptyState hasBottles={bottles.length > 0}
          onPhoto={() => filePhoto.current.click()}
          onImport={() => fileImport.current.click()}
          onAdd={() => setEdit({ ...EMPTY })}
          onTemplate={templateXlsx} />
      ) : (
        <div style={S.list}>
          {filtered.map((b) => <Row key={b.id} b={b} scale={scale} onOpen={() => setDetail(b)}
            onDelete={() => askConfirm(`${[b.producer, b.name, b.vintage].filter(Boolean).join(" ")} verwijderen?`, () => { removeBottle(b.id); flash("Verwijderd."); })} />)}
        </div>
      )}

      {/* hidden inputs */}
      <input ref={fileImport} type="file" accept=".xlsx,.xls,.csv" hidden onChange={onImportFile} />
      <input ref={filePhoto} type="file" accept="image/*" multiple hidden onChange={onPhotoFiles} />
      <input ref={filePhotoOne} type="file" accept="image/*" multiple hidden onChange={onPhotoOneFiles} />
      <input ref={filePhotoAdd} type="file" accept="image/*" multiple hidden onChange={onPhotoAddFiles} />

      {/* ---- modals ---- */}
      {detail && <DetailModal b={detail} scale={scale} onClose={() => setDetail(null)}
        onEdit={() => { setEdit(detail); setDetail(null); }}
        onEnrich={() => enrichDetail(detail)} onSave={updateBottle} />}
      {edit && <EditModal edit={edit} setEdit={setEdit} onSave={saveEdit}
        onMultiVintage={(e) => { setBulkInit({ producer: e.producer, name: e.name, region: e.region, country: e.country, color: e.color, grape: e.grape, location: e.location, supplier: e.supplier }); setEdit(null); setShowBulk(true); }} />}
      {importPending && <ImportModal rows={importPending} onApply={applyImport} onCancel={() => setImportPending(null)} />}
      {photoJobs && <PhotoModal jobs={photoJobs} setJobs={setPhotoJobs} onAdd={addPhotoResult} onAddPhoto={onAddPhotoToJob} onLookup={runJobLookup} onClose={() => setPhotoJobs(null)} />}
      {dupPrompt && <DupModal dp={dupPrompt} onResolve={resolveDup} />}
      {showBulk && <BulkModal initial={bulkInit} onAdd={addBulk} onClose={() => setShowBulk(false)} />}
      {showSomm && <SommelierModal bottles={bottles} thread={sommThread} setThread={setSommThread} onClose={() => setShowSomm(false)} />}
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      {showBackup && <BackupModal text={encodeBackup(bottles)} count={bottles.length} onClose={() => setShowBackup(false)} />}
      {showRestore && <RestoreModal onRestore={doRestore} onClose={() => setShowRestore(false)} />}
      {confirmReq && <ConfirmModal message={confirmReq.message}
        onCancel={() => setConfirmReq(null)}
        onConfirm={() => { const a = confirmReq.action; setConfirmReq(null); a(); }} />}

      {toast && <div style={S.toast}>{toast}</div>}
    </div>
  );
}

// ---------- small components ----------
function Stat({ label, value, sub, accent }) {
  const col = accent === "gold" ? "var(--gold)" : accent === "green" ? "var(--green)" : accent === "red" ? "var(--red)" : "var(--ink)";
  return (
    <div style={S.stat}>
      <div style={S.statLabel}>{label}</div>
      <div style={{ ...S.statValue, color: col }}>{value}</div>
      {sub && <div style={{ ...S.statSub, color: accent ? col : "var(--ink-dim)" }}>{sub}</div>}
    </div>
  );
}

function Row({ b, scale, onOpen, onDelete }) {
  const st = drinkStatus(b);
  const m = maturity(b);
  const dot = { rood: "#7B1E2B", wit: "#D9C97A", "rosé": "#E1A0A6", mousserend: "#E7D9A0", versterkt: "#8A4B24", oranje: "#C77D2E" }[b.color] || "#7B1E2B";
  const sc = (px) => Math.round(px * scale);
  const sub = [b.name, b.region].filter(Boolean).join(" · ");
  return (
    <div style={S.row} onClick={onOpen} className="row">
      <div style={{ ...S.colorDot, background: dot, alignSelf: "flex-start", marginTop: sc(6) }} title={b.color} />
      <div style={S.rowMain}>
        <div style={S.rowLine}>
          <span style={{ ...S.producer, fontSize: sc(15), flex: 1, minWidth: 0 }}>{b.producer || b.name || "—"}</span>
          <span style={S.rowLineRight}>
            {b.vintage && <span style={{ ...S.vintage, fontSize: sc(14) }}>{b.vintage}</span>}
            <span style={{ ...S.qtyPill, fontSize: sc(12) }}>{b.quantity || 1}×</span>
          </span>
        </div>
        <div style={S.rowLine}>
          <span style={{ ...S.rowSub, fontSize: sc(13) }}>{sub || "—"}</span>
          <span style={{ ...S.status, color: st.color, fontSize: sc(12) }}>{st.label}</span>
        </div>
        {m !== null ? (
          <div style={{ marginTop: sc(6) }}>
            <div style={{ ...S.matTrack, maxWidth: "100%", marginTop: 0 }}><div style={{ ...S.matNow, left: `${m * 100}%` }} /></div>
            <div style={{ ...S.matYears, maxWidth: "100%", fontSize: sc(11) }}><span>{b.drinkFrom}</span><span>{b.drinkTo}</span></div>
          </div>
        ) : (b.drinkFrom || b.drinkTo) ? (
          <div style={{ ...S.matYears, maxWidth: "100%", fontSize: sc(11), marginTop: sc(5) }}><span>drinkvenster {[b.drinkFrom, b.drinkTo].filter(Boolean).join(" – ")}</span></div>
        ) : null}
        {b.location && <div style={{ ...S.loc, fontSize: sc(11), marginTop: sc(4) }}>📍 {b.location}</div>}
      </div>
      <button className="iconbtn" style={{ ...S.iconBtn, alignSelf: "flex-start" }} onClick={(e) => { e.stopPropagation(); onDelete(); }}><Trash2 size={14} /></button>
    </div>
  );
}

function EmptyState({ hasBottles, onPhoto, onImport, onAdd, onTemplate }) {
  return (
    <div style={S.emptyBig}>
      <Wine size={40} strokeWidth={1} style={{ color: "var(--line)" }} />
      <h2 style={S.emptyTitle}>{hasBottles ? "Niets gevonden" : "Je kelder is nog leeg"}</h2>
      <p style={S.emptyText}>
        {hasBottles ? "Pas je zoekopdracht of filters aan." : "Begin met een foto van een etiket, importeer je Excel, of voeg handmatig toe."}
      </p>
      {!hasBottles && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", marginTop: 6 }}>
          <button style={S.btnPrimary} onClick={onPhoto}><Camera size={15} /> Foto analyseren</button>
          <button style={S.btnGhost} onClick={onImport}><Upload size={15} /> Excel importeren</button>
          <button style={S.btnGhost} onClick={onAdd}><Plus size={15} /> Handmatig</button>
          <button style={S.btnLink} onClick={onTemplate}><FileSpreadsheet size={14} /> Template downloaden</button>
        </div>
      )}
    </div>
  );
}

// ---------- edit modal ----------
// ---------- shared bottle form (used by edit + photo review) ----------
function BottleFields({ v, on }) {
  const fld = (k, label, type = "text", w) => (
    <label key={k} style={{ ...S.field, flex: w || 1 }}>
      <span style={S.fieldLabel}>{label}</span>
      <input style={S.input} type={type} value={v[k] ?? ""} onChange={(e) => on(k, e.target.value)} inputMode={type === "number" ? "decimal" : undefined} />
    </label>
  );
  return (
    <div style={S.form}>
      <div style={S.formRow}>{fld("producer", "Producent")}{fld("name", "Wijn / cuvée")}</div>
      <div style={S.formRow}>
        {fld("vintage", "Jaargang", "text", 0.7)}
        <label style={{ ...S.field, flex: 0.9 }}>
          <span style={S.fieldLabel}>Kleur</span>
          <select style={S.input} value={v.color} onChange={(e) => on("color", e.target.value)}>
            {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <div style={{ ...S.field, flex: 0.9 }}>
          <span style={S.fieldLabel}>Aantal</span>
          <QtyStepper value={v.quantity} onChange={(val) => on("quantity", val)} />
        </div>
      </div>
      <div style={S.formRow}>{fld("grape", "Druif")}{fld("score", "Score", "number", 0.5)}</div>
      <div style={S.formRow}>{fld("region", "Streek")}{fld("country", "Land")}</div>
      <div style={S.formRow}>{fld("location", "Locatie in kelder")}{fld("supplier", "Leverancier")}</div>
      <div style={S.formRow}>{fld("purchasePrice", "Aankoopprijs (€/fles)", "number")}{fld("retailValue", "Retailwaarde (€/fles)", "number")}</div>
      <label style={S.field}>
        <span style={S.fieldLabel}>Eigen geschatte waarde (€/fles)</span>
        <input style={S.input} type="number" inputMode="decimal" value={v.ownValue ?? ""} onChange={(e) => on("ownValue", e.target.value)}
          placeholder={num(v.retailValue) > 0 ? `leeg = retail (${eur(num(v.retailValue))})` : "leeg = retail"} />
      </label>
      <div style={S.formRow}>{fld("drinkFrom", "Drink vanaf", "number")}{fld("drinkTo", "Drink tot", "number")}</div>
      <label style={S.field}>
        <span style={S.fieldLabel}>Mijn proefnotities</span>
        <textarea style={{ ...S.input, minHeight: 110, resize: "vertical", lineHeight: 1.5 }} rows={5} value={v.tasteNotes ?? ""} onChange={(e) => on("tasteNotes", e.target.value)}
          placeholder="Kleur, neus, smaak, evolutie…" />
      </label>
      <label style={S.field}>
        <span style={S.fieldLabel}>Notities</span>
        <textarea style={{ ...S.input, minHeight: 90, resize: "vertical", lineHeight: 1.5 }} rows={4} value={v.notes ?? ""} onChange={(e) => on("notes", e.target.value)} />
      </label>
    </div>
  );
}

// ---------- edit modal ----------
function EditModal({ edit, setEdit, onSave, onMultiVintage }) {
  const set = (k, v) => setEdit({ ...edit, ...fieldPatch(k, v) });
  const canMulti = edit.producer || edit.name;
  return (
    <Overlay onClose={() => setEdit(null)}>
      <div style={S.modalHead}>
        <h3 style={S.modalTitle}>{edit.id ? "Fles bewerken" : "Nieuwe fles"}</h3>
        <button style={S.iconBtn} onClick={() => setEdit(null)}><X size={18} /></button>
      </div>
      <BottleFields v={edit} on={set} />
      {onMultiVintage && (
        <button style={{ ...S.btnGhost, width: "100%", marginTop: 12, justifyContent: "center" }}
          onClick={() => onMultiVintage(edit)} disabled={!canMulti}>
          <Layers size={15} /> Meerdere jaargangen van deze wijn
        </button>
      )}
      <div style={S.modalFoot}>
        <button style={S.btnGhost} onClick={() => setEdit(null)}>Annuleren</button>
        <button style={S.btnPrimary} onClick={onSave}><Check size={15} /> Opslaan</button>
      </div>
    </Overlay>
  );
}

// ---------- shared quantity stepper ----------
function QtyStepper({ value, onChange, big }) {
  const v = Math.max(0, parseInt(value) || 0);
  const set = (n) => onChange(String(Math.max(0, n)));
  const sz = big ? S.stepBtnBig : S.stepBtn;
  return (
    <div style={S.stepper}>
      <button style={sz} onClick={() => set(v - 1)} aria-label="Minder">−</button>
      <input style={{ ...S.stepInput, width: big ? 52 : 42 }} value={v}
        onChange={(e) => set(parseInt(e.target.value.replace(/\D/g, "")) || 0)}
        inputMode="numeric" />
      <button style={sz} onClick={() => set(v + 1)} aria-label="Meer">+</button>
    </div>
  );
}

// ---------- import modal ----------
function ImportModal({ rows, onApply, onCancel }) {
  const [items, setItems] = useState(rows);
  const setQty = (id, q) => setItems(items.map((b) => (b.id === id ? { ...b, quantity: q } : b)));
  const totaal = items.reduce((s, b) => s + (num(b.quantity) || 0), 0);
  return (
    <Overlay onClose={onCancel} wide>
      <div style={S.modalHead}>
        <h3 style={S.modalTitle}>Import</h3>
        <button style={S.iconBtn} onClick={onCancel}><X size={18} /></button>
      </div>
      <p style={{ ...S.emptyText, textAlign: "left", margin: "0 0 14px" }}>
        <strong style={{ color: "var(--ink)" }}>{items.length}</strong> wijnen · <strong style={{ color: "var(--gold)" }}>{totaal}</strong> flessen. Stel het aantal bij waar nodig.
      </p>
      <div style={S.importList}>
        {items.map((b) => (
          <div key={b.id} style={S.importRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={S.rowTop}>
                <span style={S.producer}>{b.producer || b.name || "—"}</span>
                {b.vintage && <span style={S.vintage}>{b.vintage}</span>}
              </div>
              {(b.producer && b.name) && <div style={{ ...S.rowSub }}>{b.name}</div>}
            </div>
            <QtyStepper value={b.quantity} onChange={(q) => setQty(b.id, q)} />
          </div>
        ))}
      </div>
      <div style={S.modalFoot}>
        <button style={S.btnGhost} onClick={onCancel}>Annuleren</button>
        <button style={S.btnGhost} onClick={() => onApply("replace", items)}>Vervangen</button>
        <button style={S.btnPrimary} onClick={() => onApply("append", items)}>Toevoegen</button>
      </div>
    </Overlay>
  );
}

// ---------- photo modal ----------
// job is nog bezig zolang het etiket gelezen of de info opgezocht wordt
const busy = (job) => job.status === "pending" || job.status === "enriching";
function PhotoModal({ jobs, setJobs, onAdd, onAddPhoto, onLookup, onClose }) {
  const [queries, setQueries] = useState({});
  const [searching, setSearching] = useState(null);
  const setData = (id, k, v) => setJobs((prev) => prev.map((j) => j.id === id ? { ...j, data: { ...j.data, ...fieldPatch(k, v) } } : j));

  const doSearch = async (jobId) => {
    const q = (queries[jobId] || "").trim();
    if (!q) return;
    setSearching(jobId);
    try {
      const res = await searchWineByName(q);
      let draft = null;
      setJobs((prev) => prev.map((j) => {
        if (j.id !== jobId) return j;
        const d = resultToData(res);
        draft = { ...d, quantity: j.data?.quantity ?? d.quantity, location: j.data?.location ?? "", purchasePrice: j.data?.purchasePrice ?? "", ownValue: j.data?.ownValue ?? "" };
        return { ...j, status: "enriching", error: null, data: draft };
      }));
      // meteen ook prijs, drinkvenster en recensies erbij
      if (draft && onLookup) await onLookup(jobId, draft);
    } catch (e) {
      setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, error: e.message } : j));
    } finally { setSearching(null); }
  };

  const SearchRow = ({ job }) => (
    <div style={S.searchRow}>
      <input style={{ ...S.input, flex: 1 }} placeholder="Niet juist? Zoek op naam, bv. Passopisciaro Contrada G 2015"
        value={queries[job.id] || ""} onChange={(e) => setQueries({ ...queries, [job.id]: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Enter") doSearch(job.id); }} />
      <button style={S.btnGhost} onClick={() => doSearch(job.id)} disabled={searching === job.id}>
        {searching === job.id ? <Loader2 className="spin" size={15} /> : <Search size={15} />} Zoek
      </button>
    </div>
  );

  return (
    <Overlay onClose={onClose} wide>
      <div style={S.modalHead}>
        <h3 style={S.modalTitle}>Foto-analyse</h3>
        <button style={S.iconBtn} onClick={onClose}><X size={18} /></button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxHeight: "72vh", overflowY: "auto" }}>
        {jobs.map((job) => (
          <div key={job.id} style={S.job}>
            <div style={S.jobTop}>
              <div style={{ position: "relative", flexShrink: 0 }}>
                <img src={job.preview} alt="" style={S.thumb} />
                {job.images && job.images.length > 1 && <span style={S.imgCount}>{job.images.length} foto's</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {job.status === "pending" && (
                  <div style={S.jobPending}><Loader2 className="spin" size={16} /> Etiket lezen…</div>
                )}
                {job.status === "enriching" && (
                  <>
                    <div style={S.jobHead}>
                      <span style={S.producer}>{job.data?.producer || job.data?.name || "Niet herkend"}</span>
                    </div>
                    <div style={{ ...S.jobPending, marginTop: 6 }}><Loader2 className="spin" size={16} /> Prijs, drinkvenster en recensies opzoeken…</div>
                  </>
                )}
                {!busy(job) && (
                  <div style={S.jobHead}>
                    <span style={S.producer}>{job.data?.producer || job.data?.name || "Niet herkend"}</span>
                    {job.data?._confidence && <span style={S.badge}>zekerheid: {job.data._confidence}</span>}
                  </div>
                )}
                {job.error && <div style={{ ...S.jobError, marginTop: 6 }}><AlertCircle size={15} /> {job.error}</div>}
                {!busy(job) && onAddPhoto && (
                  <button style={{ ...S.btnGhost, marginTop: 8 }} onClick={() => onAddPhoto(job.id)}>
                    <Camera size={15} /> Foto toevoegen (bv. achterkant)
                  </button>
                )}
                {!busy(job) && <SearchRow job={job} />}
              </div>
            </div>

            {!busy(job) && job.data && (
              <>
                <BottleFields v={job.data} on={(k, v) => setData(job.id, k, v)} />
                <button style={{ ...S.btnPrimary, marginTop: 4 }} onClick={() => onAdd(job.id)}>
                  <Check size={15} /> Toevoegen aan kelder
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </Overlay>
  );
}

// full = bijna schermvullend venster met een eigen scrollgebied binnenin
function Overlay({ children, onClose, small, wide, full }) {
  const box = full
    ? { ...S.modal, ...S.modalFull }
    : { ...S.modal, maxWidth: small ? 440 : wide ? 720 : 620 };
  return (
    <div style={{ ...S.overlay, padding: full ? 8 : 16 }} onClick={onClose}>
      <div className="modalcard" style={box} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// ---------- generic confirm ----------
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <Overlay onClose={onCancel} small>
      <div style={S.modalHead}><h3 style={S.modalTitle}>Ben je zeker?</h3>
        <button style={S.iconBtn} onClick={onCancel}><X size={18} /></button></div>
      <p style={{ ...S.bodyText, margin: "0 0 18px" }}>{message}</p>
      <div style={S.modalFoot}>
        <button style={S.btnGhost} onClick={onCancel}>Annuleren</button>
        <button style={S.btnPrimary} onClick={onConfirm}><Check size={15} /> Bevestigen</button>
      </div>
    </Overlay>
  );
}

// ---------- duplicate prompt ----------
function DupModal({ dp, onResolve }) {
  const e = dp.existing;
  const label = [e.producer, e.name, e.vintage].filter(Boolean).join(" · ");
  return (
    <Overlay onClose={() => onResolve("cancel")} small>
      <div style={S.modalHead}><h3 style={S.modalTitle}>Staat al in je kelder</h3>
        <button style={S.iconBtn} onClick={() => onResolve("cancel")}><X size={18} /></button></div>
      <p style={{ ...S.bodyText, margin: "0 0 6px" }}>{label || "Deze wijn"} staat er al{e.quantity ? ` (${e.quantity}× ${e.location ? "· " + e.location : ""})` : ""}.</p>
      <p style={{ ...S.bodyText, color: "var(--ink-dim)", margin: "0 0 18px" }}>Wil je het nieuwe aantal ({dp.incoming.quantity || 1}×) optellen, of dit toch als aparte regel toevoegen?</p>
      <div style={S.modalFoot}>
        <button style={S.btnGhost} onClick={() => onResolve("cancel")}>Annuleren</button>
        <button style={S.btnGhost} onClick={() => onResolve("add")}>Apart toevoegen</button>
        <button style={S.btnPrimary} onClick={() => onResolve("merge")}><Check size={15} /> Aantal optellen</button>
      </div>
    </Overlay>
  );
}

// ---------- bulk multi-vintage ----------
function BulkModal({ initial, onAdd, onClose }) {
  const [shared, setShared] = useState({ ...EMPTY, ...(initial || {}) });
  const prefilled = !!(initial && (initial.producer || initial.name));
  const [rows, setRows] = useState([{ vintage: "", quantity: "1" }, { vintage: "", quantity: "1" }, { vintage: "", quantity: "1" }]);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setShared({ ...shared, [k]: v });
  const setRow = (i, k, v) => setRows(rows.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const addRow = () => setRows([...rows, { vintage: "", quantity: "1" }]);
  const rmRow = (i) => setRows(rows.filter((_, j) => j !== i));
  const filled = rows.filter((r) => String(r.vintage).trim());
  const total = filled.reduce((s, r) => s + (num(r.quantity) || 0), 0);

  const lookup = async () => {
    const q = [shared.producer, shared.name].filter(Boolean).join(" ").trim();
    if (!q) return;
    setBusy(true);
    try {
      const res = await searchWineByName(q);
      const d = resultToData(res);
      setShared((s) => ({ ...s, producer: d.producer || s.producer, name: d.name || s.name, region: d.region || s.region, country: d.country || s.country, color: d.color || s.color, grape: d.grape || s.grape }));
    } catch { /* ignore */ } finally { setBusy(false); }
  };

  const fld = (k, label, w) => (
    <label key={k} style={{ ...S.field, flex: w || 1 }}>
      <span style={S.fieldLabel}>{label}</span>
      <input style={S.input} value={shared[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  return (
    <Overlay onClose={onClose}>
      <div style={S.modalHead}><h3 style={S.modalTitle}>Meerdere jaargangen</h3>
        <button style={S.iconBtn} onClick={onClose}><X size={18} /></button></div>
      <p style={{ ...S.bodyText, color: "var(--ink-dim)", margin: "0 0 14px" }}>
        {prefilled ? "Voeg extra jaargangen toe van deze wijn. " : "Zelfde wijn, in één keer meerdere jaargangen en aantallen. "}
        Open daarna per jaargang de detailkaart en tik op 'Info opzoeken' voor prijs, drinkvenster en recensies.
      </p>
      <div style={S.form}>
        <div style={S.formRow}>{fld("producer", "Producent")}{fld("name", "Wijn / cuvée")}</div>
        <div style={S.formRow}>
          <label style={{ ...S.field, flex: 1 }}>
            <span style={S.fieldLabel}>Kleur</span>
            <select style={S.input} value={shared.color} onChange={(e) => set("color", e.target.value)}>
              {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {fld("grape", "Druif")}
          <button style={{ ...S.btnGhost, alignSelf: "flex-end", height: 40 }} onClick={lookup} disabled={busy}>
            {busy ? <Loader2 className="spin" size={15} /> : <Search size={15} />} Opzoeken
          </button>
        </div>
        <div style={S.formRow}>{fld("region", "Streek")}{fld("country", "Land")}</div>
        <div style={S.formRow}>{fld("location", "Locatie")}{fld("supplier", "Leverancier")}</div>

        <div style={{ ...S.sectionLabel, marginTop: 6 }}>Jaargangen</div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <label style={{ ...S.field, flex: 1 }}>
              {i === 0 && <span style={S.fieldLabel}>Jaargang</span>}
              <input style={S.input} placeholder="bv. 2018" value={r.vintage} onChange={(e) => setRow(i, "vintage", e.target.value)} inputMode="numeric" />
            </label>
            <div style={{ ...S.field, flex: "0 0 auto" }}>
              {i === 0 && <span style={S.fieldLabel}>Aantal</span>}
              <QtyStepper value={r.quantity} onChange={(v) => setRow(i, "quantity", v)} />
            </div>
            <button style={{ ...S.iconBtn, marginBottom: 2 }} onClick={() => rmRow(i)} disabled={rows.length <= 1}><Trash2 size={15} /></button>
          </div>
        ))}
        <button style={{ ...S.btnGhost, alignSelf: "flex-start" }} onClick={addRow}><Plus size={15} /> Jaargang toevoegen</button>
      </div>
      <div style={S.modalFoot}>
        <button style={S.btnGhost} onClick={onClose}>Annuleren</button>
        <button style={S.btnPrimary} onClick={() => onAdd(shared, filled)} disabled={!filled.length || (!shared.producer && !shared.name)}>
          <Check size={15} /> {filled.length} jaargangen · {total} flessen toevoegen
        </button>
      </div>
    </Overlay>
  );
}

// ---------- vraag de sommelier ----------
// invoerveld: standaard ±4 regels, groeit mee tot deze maxhoogte
const SOMM_INPUT_MIN = 96;
const SOMM_INPUT_MAX = 220;
const SOMM_TIPS = [
  "Welke wijnen onder 50 euro die nu op dronk zijn passen bij een vispannetje?",
  "Wat drink ik het best eerst, voor het over piek gaat?",
  "Kies een fles voor een etentje met vrienden vanavond.",
];
function SommelierModal({ bottles, thread, setThread, onClose }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const scroller = useRef();
  const inputRef = useRef();
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [thread, busy]);
  // het invoerveld groeit mee met de tekst, tot de maxhoogte; daarna scrollt het
  const grow = (el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(SOMM_INPUT_MAX, Math.max(SOMM_INPUT_MIN, el.scrollHeight)) + "px";
  };

  const send = async (text) => {
    const question = String(text ?? q).trim();
    if (!question || busy) return;
    setQ(""); setErr(""); setBusy(true);
    grow(inputRef.current);
    try {
      const a = await askSommelier({ bottles, question, history: thread });
      setThread((t) => [...t, { q: question, a }]);
    } catch (e) {
      setErr(e.message || "Er ging iets mis.");
    } finally { setBusy(false); }
  };

  return (
    <Overlay onClose={onClose} full>
      <div style={{ ...S.modalHead, marginBottom: 12, flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={S.modalTitle}>Vraag de sommelier</h3>
          <div style={{ ...S.rowSub, marginTop: 3 }}>Hij kent je {bottles.length} {bottles.length === 1 ? "wijn" : "wijnen"} en antwoordt met flessen uit je eigen kelder.</div>
        </div>
        <button style={S.iconBtn} onClick={onClose}><X size={18} /></button>
      </div>

      <div ref={scroller} style={S.chatScroll}>
        {!thread.length && !busy && (
          <div style={S.chatIntro}>
            {bottles.length === 0
              ? <p style={{ ...S.bodyText, margin: 0 }}>Je kelder is nog leeg. Voeg eerst een paar flessen toe, dan kan de sommelier iets aanraden.</p>
              : <>
                  <p style={{ ...S.bodyText, margin: "0 0 12px" }}>Stel gerust een vraag in je eigen woorden. Bijvoorbeeld:</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
                    {SOMM_TIPS.map((t) => (
                      <button key={t} className="mi" style={S.chatTip} onClick={() => send(t)}>{t}</button>
                    ))}
                  </div>
                </>}
          </div>
        )}
        {thread.map((t, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={S.chatQ}>{t.q}</div>
            <div style={S.chatA}>{t.a}</div>
          </div>
        ))}
        {busy && <div style={{ ...S.jobPending, padding: "10px 0" }}><Loader2 className="spin" size={16} /> De sommelier denkt na…</div>}
        {err && <div style={{ ...S.jobError, padding: "10px 0" }}><AlertCircle size={15} /> {err}</div>}
      </div>

      <div style={S.chatBar}>
        <textarea
          ref={inputRef}
          style={{ ...S.input, flex: 1, minHeight: SOMM_INPUT_MIN, maxHeight: SOMM_INPUT_MAX, overflowY: "auto", resize: "vertical", lineHeight: 1.5 }}
          rows={4}
          placeholder={thread.length ? "Stel een vervolgvraag…" : "Bv. welke wijn past bij gegrilde zeebaars?"}
          value={q}
          onChange={(e) => { setQ(e.target.value); grow(e.target); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          disabled={bottles.length === 0} />
        <button style={{ ...S.btnPrimary, height: 46 }} onClick={() => send()} disabled={busy || !q.trim() || bottles.length === 0}>
          {busy ? <Loader2 className="spin" size={15} /> : <Send size={15} />} Vraag
        </button>
      </div>
      {thread.length > 0 && (
        <div style={{ ...S.mapCaption, marginTop: 6, textAlign: "right", flexShrink: 0 }}>
          <button style={S.btnLink} onClick={() => { setThread([]); setErr(""); }}>Gesprek wissen</button>
        </div>
      )}
    </Overlay>
  );
}

// ---------- melding (anoniem) ----------
function FeedbackModal({ onClose }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const send = async () => {
    const msg = text.trim();
    if (!msg || busy) return;
    setBusy(true); setErr("");
    const ok = await sendFeedback(msg);
    setBusy(false);
    if (ok) { setDone(true); setText(""); }
    else setErr("Versturen lukte niet, probeer later opnieuw.");
  };

  return (
    <Overlay onClose={onClose} small>
      <div style={S.modalHead}>
        <h3 style={S.modalTitle}>Melding</h3>
        <button style={S.iconBtn} onClick={onClose}><X size={18} /></button>
      </div>
      {done ? (
        <>
          <p style={{ ...S.bodyText, margin: "0 0 4px", color: "var(--green)" }}><Check size={15} /> Verzonden, bedankt.</p>
          <div style={S.modalFoot}><button style={S.btnPrimary} onClick={onClose}>Sluiten</button></div>
        </>
      ) : (
        <>
          <p style={{ ...S.bodyText, color: "var(--ink-dim)", margin: "0 0 12px" }}>
            Loopt er iets mis of heb je een idee? Schrijf het hier. Je melding wordt anoniem doorgestuurd; er gaat niets van je kelder mee.
          </p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus
            placeholder="Wat loopt er mis, of wat zou je graag anders zien?"
            style={{ ...S.input, height: 150, resize: "vertical", lineHeight: 1.5 }} />
          {err && <div style={{ ...S.jobError, padding: "10px 0" }}><AlertCircle size={15} /> {err}</div>}
          <div style={S.modalFoot}>
            <button style={S.btnGhost} onClick={onClose}>Annuleren</button>
            <button style={S.btnPrimary} onClick={send} disabled={busy || !text.trim()}>
              {busy ? <Loader2 className="spin" size={15} /> : <Send size={15} />} Versturen
            </button>
          </div>
        </>
      )}
    </Overlay>
  );
}

// ---------- backup / restore ----------
function BackupModal({ text, count, onClose }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef();
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); }
    catch {
      try { ref.current.select(); document.execCommand("copy"); setCopied(true); } catch { /* user copies manually */ }
    }
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Overlay onClose={onClose} small>
      <div style={S.modalHead}><h3 style={S.modalTitle}>Backup</h3>
        <button style={S.iconBtn} onClick={onClose}><X size={18} /></button></div>
      <p style={{ ...S.bodyText, color: "var(--ink-dim)", margin: "0 0 12px" }}>
        Kopieer deze tekst en bewaar ze veilig (bv. in Notities of een mail naar jezelf). Met Herstel laad je ze later terug. {count} flessen.
      </p>
      <textarea ref={ref} readOnly value={text} onFocus={(e) => e.target.select()}
        style={{ ...S.input, height: 150, fontFamily: "monospace", fontSize: 11, resize: "vertical" }} />
      <div style={S.modalFoot}>
        <button style={S.btnPrimary} onClick={copy}>{copied ? <Check size={15} /> : <Save size={15} />} {copied ? "Gekopieerd" : "Kopieer"}</button>
      </div>
    </Overlay>
  );
}
function RestoreModal({ onRestore, onClose }) {
  const [text, setText] = useState("");
  return (
    <Overlay onClose={onClose} small>
      <div style={S.modalHead}><h3 style={S.modalTitle}>Herstel</h3>
        <button style={S.iconBtn} onClick={onClose}><X size={18} /></button></div>
      <p style={{ ...S.bodyText, color: "var(--ink-dim)", margin: "0 0 12px" }}>Plak hier een eerder gekopieerde backup.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Plak je backup-tekst…"
        style={{ ...S.input, height: 150, fontFamily: "monospace", fontSize: 11, resize: "vertical" }} />
      <div style={S.modalFoot}>
        <button style={S.btnGhost} onClick={onClose}>Annuleren</button>
        <button style={S.btnGhost} onClick={() => onRestore(text, "append")} disabled={!text.trim()}>Toevoegen</button>
        <button style={S.btnPrimary} onClick={() => onRestore(text, "replace")} disabled={!text.trim()}><Check size={15} /> Vervangen</button>
      </div>
    </Overlay>
  );
}

// ---------- detail card ----------
function DetailModal({ b, scale, onClose, onEdit, onEnrich, onSave }) {
  const sc = (px) => Math.round(px * scale);
  const st = drinkStatus(b);
  const ev = effVal(b);
  const mat = maturity(b);
  const lat = num(b.lat), lng = num(b.lng);
  const hasCoords = lat !== 0 && lng !== 0;
  const osmLink = hasCoords ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=9/${lat}/${lng}` : null;


  const dot = { rood: "#7B1E2B", wit: "#D9C97A", "rosé": "#E1A0A6", mousserend: "#E7D9A0", versterkt: "#8A4B24", oranje: "#C77D2E" }[b.color] || "#7B1E2B";

  return (
    <Overlay onClose={onClose} wide>
      <div style={S.modalHead}>
        <div style={{ minWidth: 0 }}>
          <div style={S.rowTop}>
            <span style={{ ...S.colorDot, background: dot, width: 9, height: 9 }} />
            <h3 style={{ ...S.modalTitle, fontSize: sc(21) }}>{b.producer || b.name || "Wijn"}</h3>
            {b.vintage && <span style={{ ...S.vintage, fontSize: sc(15) }}>{b.vintage}</span>}
          </div>
          {b.producer && b.name && <div style={{ ...S.rowSub, fontSize: sc(13), marginTop: 2 }}>{b.name}</div>}
        </div>
        <button style={S.iconBtn} onClick={onClose}><X size={18} /></button>
      </div>

      <div style={{ maxHeight: "72vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* chips */}
        <div style={S.chips}>
          <span style={{ ...S.chip, fontSize: sc(12) }}>{b.color}</span>
          {b.grape && <span style={{ ...S.chip, fontSize: sc(12) }}>{b.grape}</span>}
          {(b.region || b.country) && <span style={{ ...S.chip, fontSize: sc(12) }}>{[b.region, b.country].filter(Boolean).join(", ")}</span>}
          {b.score && <span style={{ ...S.chip, fontSize: sc(12), color: "var(--gold)", borderColor: "var(--gold)" }}>{b.score}</span>}
          <span style={{ ...S.chip, fontSize: sc(12), color: st.color, borderColor: st.color }}>{st.label}</span>
        </div>

        {/* drink window */}
        {(b.drinkFrom || b.drinkTo) && (
          <div>
            <div style={{ ...S.sectionLabel, fontSize: sc(11) }}>Drinkvenster</div>
            {mat !== null ? (
              <>
                <div style={{ ...S.matTrack, maxWidth: "100%", height: 6 }}><div style={{ ...S.matNow, left: `${mat * 100}%`, height: 12, top: -3 }} /></div>
                <div style={{ ...S.matYears, maxWidth: "100%", fontSize: sc(13), marginTop: 6 }}>
                  <span>{b.drinkFrom}</span>
                  <span style={{ color: st.color, fontWeight: 600 }}>{st.label} · nu {NOW}</span>
                  <span>{b.drinkTo}</span>
                </div>
              </>
            ) : (
              <p style={{ ...S.bodyText, fontSize: sc(14) }}>{[b.drinkFrom, b.drinkTo].filter(Boolean).join(" – ")} <span style={{ color: st.color }}>· {st.label}</span></p>
            )}
          </div>
        )}

        {/* where made */}
        <div>
          <div style={{ ...S.sectionLabel, fontSize: sc(11) }}>Waar gemaakt</div>
          {hasCoords ? (
            <a href={osmLink} target="_blank" rel="noreferrer" style={S.mapPanel}>
              <MapPin size={22} strokeWidth={1.6} style={{ color: "var(--wine-bright)", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...S.bodyText, fontSize: sc(14), color: "var(--ink)" }}>{b.placeName || "Bekijk de locatie"}</div>
                <div style={{ ...S.mapLink, fontSize: sc(12), marginTop: 3 }}>Open in kaart <ExternalLink size={12} /></div>
              </div>
            </a>
          ) : b._loading ? (
            <div style={{ ...S.mapPlaceholder, fontSize: sc(13) }}><Loader2 className="spin" size={16} /> Locatie opzoeken…</div>
          ) : (
            <div style={{ ...S.mapPlaceholder, fontSize: sc(13) }}>Tik op 'Info opzoeken' voor locatie, recensies en actuele prijs.</div>
          )}
        </div>

        {/* description + reviews */}
        <div>
          <div style={{ ...S.sectionLabel, fontSize: sc(11) }}>Beschrijving</div>
          {b._loading && !b.description ? (
            <div style={{ ...S.mapPlaceholder, fontSize: sc(13) }}><Loader2 className="spin" size={16} /> Info ophalen…</div>
          ) : (
            <p style={{ ...S.bodyText, fontSize: sc(14) }}>{b.description || "Tik onderaan op 'Info opzoeken' voor een beschrijving van deze jaargang."}</p>
          )}
        </div>
        <div>
          <div style={{ ...S.sectionLabel, fontSize: sc(11) }}>Recente recensies</div>
          <p style={{ ...S.bodyText, fontSize: sc(14) }}>{b.reviews || (b._loading ? "…" : "Nog niet opgezocht.")}</p>
        </div>
        {b._error && <div style={{ ...S.jobError, fontSize: sc(13) }}><AlertCircle size={15} /> {b._error}</div>}

        {/* values */}
        <div>
          <div style={{ ...S.sectionLabel, fontSize: sc(11) }}>Waarde per fles</div>
          <div style={S.valGrid}>
            <ValCell label="Aankoop" value={num(b.purchasePrice) > 0 ? eur(num(b.purchasePrice)) : "—"} sc={sc} />
            <ValCell label="Retail" value={num(b.retailValue) > 0 ? eur(num(b.retailValue)) : "—"} sc={sc} />
            <ValCell
              label="Eigen schatting"
              value={ev.empty ? (ev.fallback ? `${eur(ev.v)}*` : "—") : eur(ev.v)}
              sub={ev.fallback ? "niet ingevuld · retail" : ev.empty ? "" : "eigen waarde"}
              muted={ev.fallback}
              sc={sc} />
          </div>
          <div style={{ ...S.mapCaption, fontSize: sc(12), marginTop: 8 }}>
            {b.quantity || 1}× in kelder · totaal {eur(ev.v * (num(b.quantity) || 1))}{ev.fallback ? " (op retail)" : ""}
          </div>
          {(b.priceNote || b.priceUrl) && (
            <div style={{ ...S.mapCaption, fontSize: sc(12), marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {b.priceNote && <span>Retail: {b.priceNote}</span>}
              {b.priceUrl && (
                <a href={b.priceUrl} target="_blank" rel="noreferrer" style={{ ...S.mapLink, fontSize: sc(12) }}>
                  bron <ExternalLink size={12} />
                </a>
              )}
            </div>
          )}
        </div>

        {b.location && <div><div style={{ ...S.sectionLabel, fontSize: sc(11) }}>Locatie</div><p style={{ ...S.bodyText, fontSize: sc(14) }}>{b.location}</p></div>}
        {b.tasteNotes && <div><div style={{ ...S.sectionLabel, fontSize: sc(11) }}>Mijn proefnotities</div><p style={{ ...S.bodyText, fontSize: sc(14), whiteSpace: "pre-wrap" }}>{b.tasteNotes}</p></div>}
        {b.notes && <div><div style={{ ...S.sectionLabel, fontSize: sc(11) }}>Notities</div><p style={{ ...S.bodyText, fontSize: sc(14) }}>{b.notes}</p></div>}
      </div>

      <div style={S.modalFoot}>
        <button style={S.btnGhost} onClick={onEnrich} disabled={b._loading}>
          {b._loading ? <Loader2 className="spin" size={15} /> : <Search size={15} />} Info opzoeken
        </button>
        <button style={S.btnPrimary} onClick={onEdit}><Pencil size={15} /> Bewerken</button>
      </div>
    </Overlay>
  );
}
function ValCell({ label, value, sub, muted, sc }) {
  return (
    <div style={S.valCell}>
      <div style={{ ...S.valCellLabel, fontSize: sc(11) }}>{label}</div>
      <div style={{ ...S.valCellValue, fontSize: sc(17), color: muted ? "var(--ink-dim)" : "var(--ink)", fontStyle: muted ? "italic" : "normal" }}>{value}</div>
      {sub && <div style={{ ...S.valCellSub, fontSize: sc(10) }}>{sub}</div>}
    </div>
  );
}

// ==================== styles ====================
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
* { box-sizing: border-box; }
:root{
  --bg:#12100E; --bg2:#1B1714; --bg3:#241F1B; --bg4:#2E2823;
  --line:#38302A; --line2:#473D35;
  --ink:#EEE7DC; --ink2:#CFC4B5; --ink-dim:#9C8F7F;
  --wine:#7A1F2B; --wine-bright:#A83544; --wine-glow:rgba(168,53,68,.28);
  --gold:#C9A24B; --gold-dim:#8E7434;
  --green:#8AA84B; --amber:#D2A049; --red:#C6553B;
}
html,body{margin:0;background:#12100E;-webkit-text-size-adjust:100%;text-size-adjust:100%;}
.spin{animation:spin 1s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}
@keyframes fadeUp{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}
.row{position:relative;transition:background .14s ease, box-shadow .14s ease;}
.row:before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:transparent;transition:background .14s ease;}
.row:hover{background:var(--bg2)!important;}
.row:hover:before{background:var(--wine-bright);}
.iconbtn:hover{background:var(--bg3)!important;color:var(--ink)!important;}
.mi:hover{background:var(--bg3)!important;}
button{transition:filter .12s ease, background .12s ease, border-color .12s ease;}
button:not(.iconbtn):not(:disabled):hover{filter:brightness(1.08);}
.chip{transition:border-color .12s;}
input,select,textarea{font-family:inherit;}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--wine-bright)!important;box-shadow:0 0 0 3px var(--wine-glow);}
::placeholder{color:var(--ink-dim);}
::-webkit-scrollbar{width:9px;height:9px;} ::-webkit-scrollbar-thumb{background:var(--line2);border-radius:5px;} ::-webkit-scrollbar-track{background:transparent;}
button:disabled{opacity:.4;cursor:default;}
.apphead{padding-top:calc(16px + env(safe-area-inset-top))!important;}
.modalcard{animation:fadeUp .18s ease both;}
`;

const S = {
  app: {
    minHeight: "100vh", color: "var(--ink)", fontFamily: "'Inter',system-ui,sans-serif", fontSize: 14, paddingBottom: 60,
    background: "radial-gradient(120% 80% at 50% -10%, #221A16 0%, #16120F 45%, #100E0C 100%)",
  },
  header: { position: "sticky", top: 0, zIndex: 10, background: "linear-gradient(180deg, rgba(20,16,13,.96), rgba(20,16,13,.82))", backdropFilter: "blur(8px)", borderBottom: "1px solid var(--line)", padding: "16px 22px 0" },
  brandRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  brand: { display: "flex", alignItems: "center", gap: 11 },
  brandName: { fontFamily: "'Spectral',serif", fontSize: 27, fontWeight: 600, letterSpacing: 0.4, color: "var(--ink)" },
  savedTag: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--green)", background: "rgba(127,163,75,.12)", border: "1px solid rgba(127,163,75,.3)", padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap" },
  menuBackdrop: { position: "fixed", inset: 0, zIndex: 40 },
  menu: { position: "absolute", right: 0, top: 44, zIndex: 41, background: "var(--bg2)", border: "1px solid var(--line2)", borderRadius: 12, padding: 6, minWidth: 210, boxShadow: "0 16px 40px rgba(0,0,0,.5)", display: "flex", flexDirection: "column", gap: 2 },
  menuItem: { display: "flex", alignItems: "center", gap: 9, background: "transparent", border: "none", color: "var(--ink)", padding: "10px 12px", borderRadius: 8, fontSize: 13.5, cursor: "pointer", textAlign: "left", width: "100%" },
  menuSep: { height: 1, background: "var(--line)", margin: "4px 6px" },
  actions: { display: "flex", gap: 8, flexWrap: "wrap" },
  ledger: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px 16px", padding: "16px 0 14px" },
  stat: { minWidth: 0 },
  statLabel: { fontSize: 10.5, textTransform: "uppercase", letterSpacing: 1.4, color: "var(--ink-dim)", marginBottom: 4 },
  statValue: { fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 500, whiteSpace: "nowrap", letterSpacing: -0.3 },
  statSub: { fontFamily: "'JetBrains Mono',monospace", fontSize: 12, marginTop: 2 },

  toolbar: { display: "flex", gap: 8, padding: "16px 22px", flexWrap: "wrap", alignItems: "center" },
  searchWrap: { display: "flex", alignItems: "center", gap: 8, background: "var(--bg2)", border: "1px solid var(--line)", borderRadius: 10, padding: "0 13px", flex: "1 1 260px", height: 40 },
  search: { border: "none", background: "transparent", color: "var(--ink)", flex: 1, fontSize: 16 },
  select: { background: "var(--bg2)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--ink2)", height: 40, padding: "0 12px", fontSize: 16, cursor: "pointer" },

  list: { padding: "4px 12px 0" },
  row: { display: "flex", alignItems: "flex-start", gap: 12, padding: "13px 10px 14px 12px", borderBottom: "1px solid var(--bg3)", cursor: "pointer" },
  colorDot: { width: 9, height: 9, borderRadius: "50%", flexShrink: 0, boxShadow: "0 0 0 1px rgba(255,255,255,.1), 0 0 8px rgba(0,0,0,.4)" },
  rowMain: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 },
  rowLine: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 },
  rowLineRight: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
  qtyPill: { fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "var(--ink2)", background: "var(--bg3)", border: "1px solid var(--line)", padding: "1px 8px", borderRadius: 20, whiteSpace: "nowrap" },
  rowTop: { display: "flex", alignItems: "baseline", gap: 9 },
  producer: { fontFamily: "'Spectral',serif", fontWeight: 600, fontSize: 16, letterSpacing: 0.2, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  vintage: { fontFamily: "'JetBrains Mono',monospace", fontSize: 14, color: "var(--gold)", letterSpacing: 0.5 },
  rowSub: { fontSize: 13, color: "var(--ink2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 },
  dim: { color: "var(--ink-dim)" },
  matTrack: { position: "relative", height: 4, borderRadius: 3, marginTop: 9, maxWidth: 240, background: "linear-gradient(90deg, var(--amber) 0%, var(--green) 50%, var(--red) 100%)", opacity: 0.85 },
  matWrap: { marginTop: 2 },
  matYears: { display: "flex", justifyContent: "space-between", maxWidth: 240, marginTop: 3, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "var(--ink-dim)", letterSpacing: 0.3 },
  matNow: { position: "absolute", top: -3, width: 3, height: 10, borderRadius: 2, background: "var(--ink)", boxShadow: "0 0 0 2px var(--bg), 0 0 6px rgba(0,0,0,.6)", transform: "translateX(-50%)" },
  matFill: { height: "100%", borderRadius: 3 },
  rowMeta: { width: 118, flexShrink: 0, textAlign: "right" },
  status: { fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", letterSpacing: 0.2 },
  loc: { fontSize: 12, color: "var(--ink-dim)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  rowNums: { width: 98, flexShrink: 0, textAlign: "right" },
  qty: { fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: "var(--ink-dim)" },
  val: { fontFamily: "'JetBrains Mono',monospace", fontSize: 14, color: "var(--ink)", marginTop: 3, letterSpacing: -0.2 },
  rowBtns: { display: "flex", gap: 2, flexShrink: 0 },
  iconBtn: { background: "transparent", border: "none", color: "var(--ink-dim)", width: 32, height: 32, borderRadius: 8, cursor: "pointer", display: "grid", placeItems: "center" },

  empty: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 60, color: "var(--ink-dim)" },
  emptyBig: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "60px 20px", textAlign: "center" },
  emptyTitle: { fontFamily: "'Spectral',serif", fontSize: 22, fontWeight: 500, margin: "8px 0 0" },
  emptyText: { color: "var(--ink-dim)", maxWidth: 420, lineHeight: 1.5, margin: 0 },

  btnPrimary: { display: "inline-flex", alignItems: "center", gap: 6, background: "linear-gradient(180deg, var(--wine-bright), var(--wine))", border: "1px solid var(--wine-bright)", color: "#fff", padding: "0 15px", height: 38, borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 1px 2px rgba(0,0,0,.3)" },
  btnGhost: { display: "inline-flex", alignItems: "center", gap: 6, background: "var(--bg2)", border: "1px solid var(--line)", color: "var(--ink2)", padding: "0 15px", height: 38, borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: "pointer" },
  btnLink: { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: "var(--gold)", fontSize: 13, cursor: "pointer" },

  overlay: { position: "fixed", inset: 0, background: "rgba(6,4,3,.74)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center", padding: 16, zIndex: 50 },
  modal: { width: "100%", background: "linear-gradient(180deg, #201B17, #1A1613)", border: "1px solid var(--line2)", borderRadius: 16, padding: 22, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 30px 80px rgba(0,0,0,.6)" },
  modalFull: {
    maxWidth: 940, height: "calc(100vh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom))",
    maxHeight: "none", overflow: "hidden", display: "flex", flexDirection: "column",
    padding: "18px 18px calc(14px + env(safe-area-inset-bottom))",
  },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 18 },
  modalTitle: { fontFamily: "'Spectral',serif", fontSize: 21, fontWeight: 600, margin: 0, letterSpacing: 0.2 },
  form: { display: "flex", flexDirection: "column", gap: 13 },
  formRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  field: { display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 130 },
  fieldLabel: { fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--ink-dim)" },
  input: { background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 9, color: "var(--ink)", padding: "10px 12px", fontSize: 16, width: "100%" },
  modalFoot: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 },

  stepper: { display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 },
  stepBtn: { width: 36, height: 36, borderRadius: 9, border: "1px solid var(--line2)", background: "var(--bg3)", color: "var(--ink)", fontSize: 20, lineHeight: 1, cursor: "pointer", display: "grid", placeItems: "center", userSelect: "none" },
  stepBtnBig: { width: 42, height: 42, borderRadius: 10, border: "1px solid var(--wine-bright)", background: "linear-gradient(180deg, var(--wine-bright), var(--wine))", color: "#fff", fontSize: 22, lineHeight: 1, cursor: "pointer", display: "grid", placeItems: "center", userSelect: "none" },
  stepInput: { height: 36, textAlign: "center", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 9, color: "var(--ink)", fontFamily: "'JetBrains Mono',monospace", fontSize: 16, fontWeight: 500 },
  importList: { display: "flex", flexDirection: "column", maxHeight: "58vh", overflowY: "auto", border: "1px solid var(--line)", borderRadius: 12, background: "var(--bg)" },
  importRow: { display: "flex", alignItems: "center", gap: 12, padding: "11px 15px", borderBottom: "1px solid var(--bg3)" },

  job: { display: "flex", flexDirection: "column", gap: 14, padding: 15, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 12 },
  jobTop: { display: "flex", gap: 15, alignItems: "flex-start" },
  searchRow: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" },
  thumb: { width: 82, height: 104, objectFit: "cover", borderRadius: 9, flexShrink: 0, border: "1px solid var(--line2)" },
  imgCount: { position: "absolute", bottom: 4, left: 4, fontSize: 10, background: "rgba(0,0,0,.7)", color: "#fff", padding: "1px 6px", borderRadius: 10, border: "1px solid var(--line2)" },
  jobPending: { display: "flex", alignItems: "center", gap: 8, color: "var(--ink-dim)", padding: "20px 0" },
  jobError: { display: "flex", alignItems: "center", gap: 8, color: "var(--red)", padding: "20px 0" },
  jobHead: { display: "flex", alignItems: "center", gap: 10, marginBottom: 11, flexWrap: "wrap" },
  badge: { fontSize: 11, background: "var(--bg3)", color: "var(--ink-dim)", padding: "3px 9px", borderRadius: 20, border: "1px solid var(--line)" },
  miniGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 },
  photoDesc: { fontSize: 13, color: "var(--ink2)", lineHeight: 1.55, margin: "10px 0 0" },

  textSize: { display: "inline-flex", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", height: 38, background: "var(--bg2)" },
  tsBtn: { width: 36, background: "transparent", border: "none", color: "var(--ink2)", cursor: "pointer", display: "grid", placeItems: "center", lineHeight: 1, fontFamily: "'Spectral',serif" },

  // sommelier: scrollend antwoordgebied, invoerveld blijft onderaan staan
  chatScroll: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 18, overflowY: "auto", padding: "2px 2px 4px" },
  chatIntro: { background: "var(--bg)", border: "1px dashed var(--line2)", borderRadius: 12, padding: "16px 16px 18px" },
  chatTip: { background: "var(--bg2)", border: "1px solid var(--line)", color: "var(--ink2)", borderRadius: 20, padding: "10px 16px", fontSize: 16, cursor: "pointer", textAlign: "left", lineHeight: 1.45 },
  chatQ: { alignSelf: "flex-end", maxWidth: "88%", background: "linear-gradient(180deg, var(--wine-bright), var(--wine))", color: "#fff", borderRadius: "14px 14px 4px 14px", padding: "11px 15px", fontSize: 16, lineHeight: 1.5 },
  chatA: { alignSelf: "flex-start", maxWidth: "94%", background: "var(--bg)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: "14px 14px 14px 4px", padding: "14px 17px", fontSize: 16, lineHeight: 1.7, whiteSpace: "pre-wrap" },
  chatBar: { display: "flex", gap: 8, alignItems: "flex-end", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)", flexShrink: 0 },

  chips: { display: "flex", flexWrap: "wrap", gap: 7 },
  chip: { fontSize: 12, border: "1px solid var(--line2)", color: "var(--ink2)", padding: "4px 11px", borderRadius: 20, background: "var(--bg2)", textTransform: "capitalize", letterSpacing: 0.2 },
  sectionLabel: { fontSize: 10.5, textTransform: "uppercase", letterSpacing: 1.4, color: "var(--gold-dim)", marginBottom: 8, fontWeight: 600 },
  bottleImg: { width: 78, height: 130, objectFit: "cover", borderRadius: 10, border: "1px solid var(--line2)", background: "var(--bg)", flexShrink: 0 },
  map: { width: "100%", height: 210, border: "1px solid var(--line2)", borderRadius: 12, background: "var(--bg)", display: "block", objectFit: "cover", cursor: "pointer" },
  mapFoot: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" },
  mapPanel: { display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "var(--bg)", border: "1px solid var(--line2)", borderRadius: 12, textDecoration: "none", cursor: "pointer" },
  mapLink: { display: "inline-flex", alignItems: "center", gap: 4, color: "var(--gold)", fontSize: 12, textDecoration: "none", whiteSpace: "nowrap" },
  mapCaption: { fontSize: 12, color: "var(--ink-dim)" },
  mapPlaceholder: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-dim)", background: "var(--bg)", border: "1px dashed var(--line2)", borderRadius: 12, padding: "20px 15px" },
  bodyText: { fontSize: 14, lineHeight: 1.65, color: "var(--ink2)", margin: 0 },
  valGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9 },
  valCell: { background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 12, padding: "11px 13px", minWidth: 0 },
  valCellLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--ink-dim)", marginBottom: 4 },
  valCellValue: { fontFamily: "'JetBrains Mono',monospace", fontSize: 17, fontWeight: 500, whiteSpace: "nowrap" },
  valCellSub: { fontSize: 10, color: "var(--ink-dim)", marginTop: 3 },

  toast: { position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "var(--bg3)", border: "1px solid var(--line)", color: "var(--ink)", padding: "10px 18px", borderRadius: 10, fontSize: 13, zIndex: 60, boxShadow: "0 8px 30px rgba(0,0,0,.4)" },
};


// ---- PWA mount ----
import { createRoot } from "react-dom/client";
const rootEl = document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<App />);
