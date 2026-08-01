import React, { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import {
  Search, Plus, Upload, Download, Camera, X, Wine, Trash2,
  Pencil, Check, Loader2, FileSpreadsheet, AlertCircle, ArrowUpDown,
  MapPin, ExternalLink, MoreHorizontal, Layers, Save, Clipboard,
  MessageCircle, Send, MessageSquare, RefreshCw, Eye, EyeOff, Globe, BookOpen
} from "lucide-react";
// Leaflet zit mee in de bundel (geen CDN, geen sleutel, geen kosten). De kaart
// zelf komt van OpenStreetMap; die tegels zijn gratis maar hebben wel netwerk nodig.
import L from "leaflet";
import leafletCss from "leaflet/dist/leaflet.css";

const STORAGE_KEY = "wijnkelder-flessen-v1";
const NOW = new Date().getFullYear();
// Hou dit gelijk met het cachenummer in sw.js; het gaat mee met een melding.
const APP_VERSION = "kelder-v56";

const COLORS = ["rood", "wit", "rosé", "mousserend", "versterkt", "oranje"];

const EMPTY = {
  producer: "", name: "", vintage: "", region: "", country: "",
  color: "rood", quantity: 1, location: "",
  purchasePrice: "", retailValue: "", ownValue: "",
  supplier: "", score: "", drinkFrom: "", drinkTo: "", notes: "", tasteNotes: "",
  grape: "", description: "", reviews: "", lat: "", lng: "", placeName: "", imageUrl: "", enriched: false,
  priceNote: "", priceManual: false, priceUrl: "", verifyNote: "",
  volumeMl: 750,
  drinkLog: [], herproefOp: "", buitenKelder: false,
};

// Flesformaten. 75 cl is de norm; alle prijzen die we opzoeken gelden daarvoor.
// Draaiboek bij het afvinken van een fles. Alles mag leeg blijven; wat leeg is, is
// niet van toepassing en komt niet in het logboek. Wie een veld bijzet, zet het
// HIER: het venster, het logboek en de samenvatting voor de sommelier lezen alle
// drie uit deze ene lijst.
// De aanvinkbare woorden staan vast, zodat je er later op kan tellen; het veld
// "eigen woorden" vangt alles op wat er niet tussen staat.
const AROMA_PRIMAIR = [
  "citrus", "appel/peer", "steenfruit", "tropisch fruit", "rood fruit", "zwart fruit",
  "gedroogd fruit", "bloemen", "kruiden", "peper", "groen/plantaardig", "mineraal", "vuursteen",
];
const AROMA_SECUNDAIR = [
  "gist", "brood/brioche", "boter", "room", "vanille", "kokos", "toast", "geroosterd hout",
  "ceder", "rook", "chocolade", "melkzuur",
];
const AROMA_TERTIAIR = [
  "leer", "tabak", "paddenstoel", "onderhout", "truffel", "noten", "karamel", "honing",
  "gedroogde bloemen", "balsamico", "vlees/wild", "petrol",
];

const DRINK_VRAGEN = [
  { k: "gelegenheid", label: "Gelegenheid of gezelschap", hint: "bv. verjaardag Marie, met Jan en An" },
  { k: "waar", label: "Waar", hint: "bv. thuis, restaurant De Kok" },
  { k: "gerecht", label: "Wat aten we erbij", hint: "bv. ossobuco" },
  { k: "kleur", label: "Kleur", chips: ["bleek", "diep", "helder", "troebel", "paars", "robijn", "granaat", "baksteen", "strogeel", "goudgeel", "amber", "koper", "zalm"] },
  { k: "neusPrimair", label: "Neus · primair (fruit, bloem, kruid)", chips: AROMA_PRIMAIR },
  { k: "neusSecundair", label: "Neus · secundair (gisting, hout)", chips: AROMA_SECUNDAIR },
  { k: "neusTertiair", label: "Neus · tertiair (rijping)", chips: AROMA_TERTIAIR },
  { k: "smaak", label: "Smaak", chips: ["droog", "halfdroog", "zoet", "frisse zuren", "zachte zuren", "stevige tannines", "fijne tannines", "stroef", "licht", "medium", "vol", "stevige alcohol", "zilt", "bitter", "lange afdronk", "korte afdronk"] },
  { k: "evolutie", label: "Evolutie", chips: ["nog gesloten", "nog jong", "opent traag", "op dronk", "volle rijpheid", "begint te dalen", "over de piek", "vermoeid", "kurk of afwijking"] },
  { k: "indruk", label: "Eigen woorden", hint: "wat de vinkjes niet vatten", groot: true },
  { k: "punten", label: "Mijn score op 100", hint: "bv. 95", getal: true },
  { k: "nogKopen", label: "Zou ik hem opnieuw kopen?", keuzes: ["", "ja", "misschien", "nee"] },
];

// Waarom een fles uit de kelder verdwijnt. Enkel "gedronken" telt mee in de
// drinkstatistiek; verkocht of weggegeven hoort daar niet thuis.
const WEG_REDENEN = [
  { k: "gedronken", label: "Gedronken", werkwoord: "afgevinkt" },
  { k: "verkocht", label: "Verkocht", werkwoord: "verkocht" },
  { k: "weggegeven", label: "Weggegeven", werkwoord: "weggegeven" },
  { k: "kapot", label: "Kapot of verloren", werkwoord: "afgeboekt" },
];

// Mijn oordeel over de rijpheid, en wanneer ik hem opnieuw wil proeven. De twee
// staan in één keuzelijst omdat het dezelfde vraag beantwoordt: en nu?
const RIJPHEID = [
  { k: "rijp", label: "Mooi op dronk", jaren: 0 },
  { k: "kort", label: "Op dronk, kort bewaarpotentieel", jaren: 1 },
  { k: "over", label: "Over de piek, drinken", jaren: 0 },
];

const FORMATEN = [
  { ml: 375, label: "halve fles (37,5 cl)" },
  { ml: 750, label: "fles (75 cl)" },
  { ml: 1500, label: "magnum (1,5 l)" },
  { ml: 3000, label: "dubbele magnum (3 l)" },
  { ml: 5000, label: "jeroboam (5 l)" },
];
const formaatLabel = (ml) => (FORMATEN.find((f) => f.ml === (num(ml) || 750)) || {}).label || `${num(ml)} ml`;
const formaatKort = (ml) => { const v = num(ml) || 750; return v === 750 ? "" : v === 1500 ? "magnum" : v === 375 ? "halve fles" : v >= 1000 ? `${v / 1000} l` : `${v / 10} cl`; };

// Een zelf ingetikte retailwaarde blijft altijd staan: een latere opzoeking mag
// ze niet overschrijven. Daarom wordt handmatige invoer apart gemarkeerd.
function fieldPatch(k, v) {
  if (k === "retailValue") return { retailValue: v, priceManual: true, priceNote: v === "" ? "" : "zelf ingevuld", priceUrl: "" };
  return { [k]: v };
}

// which value counts for portfolio math: own estimate if set, else retail
function effVal(b) {
  const hasOwn = b.ownValue !== "" && b.ownValue != null && money(b.ownValue) > 0;
  return {
    v: hasOwn ? money(b.ownValue) : money(b.retailValue),
    fallback: !hasOwn && money(b.retailValue) > 0,
    empty: !hasOwn,
  };
}

// ---------- helpers ----------
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };
// Geldbedragen apart lezen: "1.200" is twaalfhonderd euro, niet 1,2. Een punt of
// komma gevolgd door precies drie cijfers is een duizendtalscheiding; één of twee
// cijfers erna is een decimaal. Bewust NIET voor jaartallen, aantallen of
// coördinaten — daar zou 43.317 ineens 43317 worden.
function money(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const t = String(v ?? "").replace(/[^\d.,-]/g, "");
  if (!t) return 0;
  const laatste = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
  let s;
  if (laatste < 0) s = t;
  else {
    const achter = t.length - laatste - 1;
    s = achter >= 1 && achter <= 2
      ? t.slice(0, laatste).replace(/[.,]/g, "") + "." + t.slice(laatste + 1)
      : t.replace(/[.,]/g, "");
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
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
const dupKey = (b) => [b.producer, b.name, b.vintage, num(b.volumeMl) || 750].map((x) => String(x ?? "").trim().toLowerCase()).join("|");
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

function cleanBottle(b) { const { _loading, _error, _confidence, _nieuw, ...rest } = b; return rest; }
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
// De hoofdsleutel blijft ongewijzigd. Daarnaast houden we één generatie terug bij:
// vóór elke overschrijving gaat de vorige inhoud naar PREV_KEY. Zo is er altijd een
// vangnet, ook als er ooit iets misgaat tijdens het bewaren.
const PREV_KEY = STORAGE_KEY + "-vorige";
// voorkeur, geen kelderdata: aparte sleutel zodat de kelder er nooit door geraakt wordt
const NAAM_KEY = "wijnkelder-naam";
const STANDAARDNAAM = "Wijnkelder";

// Elke fles krijgt gegarandeerd een eigen id: zonder id wist het verwijderen van
// één fles ze allemaal, omdat ze dan niet meer uit elkaar te houden zijn.
function normBottle(b) {
  const o = { ...b };
  if (o.retailValue == null && o.currentValue != null) o.retailValue = o.currentValue;
  return { ...EMPTY, ...o, id: o.id || uid() };
}

// Geeft { list, ok } terug. ok=false betekent: de opslag was NIET leeg maar
// onleesbaar. De app mag dan niets bewaren, anders wist ze de kelder.
async function loadBottles() {
  let raw;
  try { raw = await rawGet(STORAGE_KEY); } catch { return { list: [], ok: false }; }
  if (raw == null || raw === "") return { list: [], ok: true };  // echt een lege kelder
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return { list: [], ok: false };
    return { list: list.map(normBottle), ok: true };
  } catch { return { list: [], ok: false }; }
}

// De vorige generatie, voor 'Vorige versie terugzetten'.
async function loadPrevious() {
  try {
    const raw = await rawGet(PREV_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.map(normBottle) : null;
  } catch { return null; }
}

async function saveBottles(list) {
  const nieuw = JSON.stringify(list.map(cleanBottle));
  try {
    const vorige = await rawGet(STORAGE_KEY);
    if (vorige && vorige !== nieuw) await rawSet(PREV_KEY, vorige);
  } catch { /* het vangnet mag het bewaren zelf nooit tegenhouden */ }
  return rawSet(STORAGE_KEY, nieuw);
}

// ---------- Excel ----------
const HEADERS = {
  producer: "Producent", name: "Wijn", vintage: "Jaargang", region: "Streek",
  country: "Land", color: "Kleur", grape: "Druif", quantity: "Aantal", location: "Locatie",
  purchasePrice: "Aankoopprijs", retailValue: "Retailwaarde", ownValue: "Eigen waarde", volumeMl: "Formaat (ml)",
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
  formaat: "volumeMl", volume: "volumeMl", volumeml: "volumeMl", inhoud: "volumeMl",
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
async function fetchSearch({ query, wine, wiki, pages, term, geo, prefix = "", max = 2600 }) {
  try {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, wine, wiki, pages, term, geo }),
    });
    const data = await res.json();
    const items = (data && data.results) || [];
    const text = items.map((r, i) => `[${prefix}${i + 1}] ${r.title}: ${r.snippet}`).join("\n").slice(0, max);
    return {
      text, items,
      offers: Array.isArray(data && data.offers) ? data.offers : [],
      wiki: (data && data.wiki) || null,
      rates: (data && data.rates) || null,
      pagePrices: (data && data.pagePrices) || [],
      geo: (data && data.geo) || null,
      sources: (data && data.sources) || {},
    };
  } catch { return { text: "", items: [], offers: [], wiki: null, sources: { web: "fout", vivino: "fout" } }; }
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
// Woorden die niets over de identiteit van een wijn zeggen: elke Bourgogne is
// "grand cru", elke Chianti is "classico". Ze mogen dus geen verschil maken.
const ALGEMEEN = new Set([
  "grand", "cru", "crus", "premier", "1er", "1e", "village", "villages", "grands",
  "classico", "riserva", "reserva", "reserve", "superiore", "supérieur", "superieur",
  "docg", "doc", "aoc", "aop", "igt", "igp", "doca", "vdp", "gran", "seleccion",
  "vino", "vin", "vins", "wine", "wines", "wein", "wijn", "vino", "vinho",
  "rood", "rouge", "rosso", "red", "wit", "blanc", "bianco", "white", "rose", "rosato",
  "brut", "sec", "demi", "extra", "millesime", "millésime", "cuvee", "cuvée",
  "domaine", "domain", "chateau", "château", "castello", "tenuta", "azienda", "agricola",
  "cantina", "cantine", "weingut", "bodega", "bodegas", "quinta", "maison", "cave", "caves",
  "fattoria", "podere", "estate", "winery", "societe", "société", "fils", "pere", "père",
  "freres", "frères", "figli", "hijos", "and", "the", "van", "der", "des", "les", "del",
  "della", "delle", "dei", "degli", "produttori", "societa", "società", "srl", "spa",
  "france", "italia", "italie", "italy", "espana", "españa", "spanje", "product",
  "classe", "classé", "class", "premier", "grand", "vieilles", "selection",
]);

// Een woord telt als "gekend" wanneer het al ergens bij de fles staat. We
// vergelijken soepel op de eerste vijf letters, zodat toscana en toscane, en
// bourgogne en borgogna, niet als een andere wijn tellen.
function eigenWoorden(b) {
  const uit = new Set();
  for (const veld of [b.producer, b.name, b.region, b.country, b.grape, b.vintage]) {
    for (const t of keyTokens(veld)) uit.add(t);
  }
  return uit;
}

const gekendWoord = (t, eigen) => {
  if (/^\d+$/.test(t)) return true;              // jaartallen en inhoudsmaten
  if (ALGEMEEN.has(t)) return true;
  if (eigen.has(t)) return true;
  for (const e of eigen) {
    if (e.length >= 5 && t.length >= 5 && (e.startsWith(t.slice(0, 5)) || t.startsWith(e.slice(0, 5)))) return true;
  }
  return false;
};

// Welke woorden voegt dit resultaat toe die NIET bij mijn fles horen? Dat is het
// gevaarlijke geval: "Chambertin Clos de Bèze" is een ANDERE wijn dan "Chambertin",
// ook al staat mijn hele naam erin.
function vreemdeWoorden(tekst, b) {
  const eigen = eigenWoorden(b);
  return [...new Set(keyTokens(tekst))].filter((t) => !gekendWoord(t, eigen));
}

// Zit mijn eigen naam er wel in? Anders is het gewoon een andere wijn van
// dezelfde producent, zoals Clos de la Roche bij een zoektocht naar Chambertin.
function naamKlopt(offer, b) {
  const mijn = keyTokens(b.name);
  if (!mijn.length) return true;
  const hay = [...keyTokens(offer.name), ...keyTokens(offer.producer)];
  return tokenRatio(mijn, hay) >= 0.6;
}

// De aanbiedingen die het best bij DEZE wijn passen. Niet "alles boven een
// drempel", maar de groep met de MINSTE vreemde woorden: zo wint "Chambertin
// Grand Cru" het van "Chambertin Clos de Bèze Grand Cru", en blijven bij Soldera
// alle aanbiedingen van "Case Basse Sangiovese Toscana" gewoon staan.
function vivinoKeuze(offers, b) {
  const pas = (offers || []).filter((o) => offerMatch(o, b) >= 0.55 && naamKlopt(o, b));
  if (!pas.length) return { lijst: [], vreemd: 0 };
  const met = pas.map((o) => ({ o, vreemd: vreemdeWoorden(o.name, b).length }));
  const minste = Math.min(...met.map((x) => x.vreemd));
  return { lijst: met.filter((x) => x.vreemd === minste).map((x) => x.o), vreemd: minste };
}

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
// ---------- prijzen uit de zoekresultaten zelf ----------
// Tweede prijsbron naast Vivino. De bedragen worden hier met een patroon uit de
// tekst gehaald, niet door het model bedacht, en elk bedrag houdt zijn bron-URL.
// "1.234,56" / "1,234.56" / "30,00" / "30.00" → 1234.56 / 30
function parseAmount(s) {
  let t = String(s).replace(/[^\d.,]/g, "");
  if (!t) return 0;
  const komma = t.lastIndexOf(","), punt = t.lastIndexOf(".");
  const dec = Math.max(komma, punt);
  if (dec >= 0 && t.length - dec - 1 <= 2 && t.length - dec - 1 >= 1) {
    t = t.slice(0, dec).replace(/[.,]/g, "") + "." + t.slice(dec + 1);
  } else t = t.replace(/[.,]/g, "");
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}
// tekst die verraadt dat het niet om één gewone fles van 75 cl gaat
const NIET_FLES = /per\s*(2|3|4|6|12)\b|\b(6|12)\s*(x|st|flessen)|doos|kist|case\s*of|halve\s*fles|37[,.]?5\s*cl|375\s*ml|magnum|1[,.]5\s*l\b|\b3\s*l\b|50\s*cl|500\s*ml|per\s*liter|\/\s*l\b/i;
const GELDBEDRAG = /(?:€|eur)\s*([0-9][0-9.,]{0,9})|([0-9][0-9.,]{2,9})\s*(?:€|eur\b)/gi;
// Webshopfragmenten schrijven de prijs vaak zónder muntteken ("795,00 per fles").
// Twee decimalen achter een komma of punt is in die context vrijwel altijd een prijs.
const BEDRAG_KAAL = /\b\d{1,3}(?:[.\s]\d{3})+[,.]\d{2}\b|\b\d+[,.]\d{2}\b/g;
const PRIJSCONTEXT = /prijs|prijzen|kopen|bestel|per\s*fles|voorraad|winkel|vanaf|aanbieding|€|\beur\b/i;
const VERZENDKOST = /verzend|leverings?kost|shipping|porto|bezorg/i;
const GEEN_PRIJS_ACHTER = /^\s*(punten|points|score|beoordel|rating|\/\s*(5|10|20|100)\b|%)/i;
// Bedragen in een andere munt worden omgerekend met de ECB-dagkoers. Kennen we de
// koers niet, dan wordt het bedrag geweerd in plaats van gegokt.
const MUNT_TEKEN = { "$": "USD", "£": "GBP", "¥": "JPY" };
// alle munten die de ECB publiceert; staat er zo'n code bij het bedrag, dan is het
// géén euro en moet er omgerekend worden
const ECB_MUNTEN = ["USD","JPY","BGN","CZK","DKK","GBP","HUF","PLN","RON","SEK","CHF","ISK","NOK","TRY",
  "AUD","BRL","CAD","CNY","HKD","IDR","ILS","INR","KRW","MXN","MYR","NZD","PHP","SGD","THB","ZAR"];
const MUNT_CODE = new RegExp(`\\b(${ECB_MUNTEN.join("|")})\\b`, "i");
const VREEMDE_MUNT = new RegExp(`[$£¥]|\\bdollars?\\b|\\bpounds?\\b|${MUNT_CODE.source}`, "i");
// welke munt staat er vlak bij het bedrag? ("" = euro)
function muntBij(voor, na) {
  const stuk = `${voor} ${na}`;
  const code = MUNT_CODE.exec(stuk);
  if (code) return code[1].toUpperCase();
  if (/\bdollars?\b/i.test(stuk)) return "USD";
  if (/\bpounds?\b/i.test(stuk)) return "GBP";
  const teken = /[$£¥]/.exec(stuk);
  return teken ? MUNT_TEKEN[teken[0]] : "";
}
// Handelaars noteren vaak exclusief btw; dat is niet wat een fles in de winkel kost.
const EXCL_BTW = /excl\.?\s*(btw|b\.?t\.?w|vat|tax)|exclusief\s*btw|ex\.?\s*btw|zonder\s*btw|\+\s*21\s*%/i;
const BTW_TARIEF = 1.21;   // België

function snippetPrices(items, b, rates) {
  const want = keyTokens(wineTerm(b));
  const out = [];
  for (const it of items || []) {
    const tekst = `${it.title || ""} ${it.snippet || ""}`;
    // hoort dit resultaat wel bij deze wijn?
    const hay = keyTokens(tekst);
    if (!want.length || tokenRatio(want, hay) < 0.6) continue;
    // De titel zegt WELKE wijn de winkel verkoopt. Staat daar een woord in dat
    // niets met mijn fles te maken heeft, dan is het een andere wijn — zo kwam de
    // prijs van een Gevrey-Chambertin op een Chambertin Grand Cru terecht.
    if (vreemdeWoorden(it.title || "", b).length) continue;
    if (NIET_FLES.test(tekst)) continue;
    const jaar = (tekst.match(/\b(19[5-9]\d|20[0-4]\d)\b/g) || []).map(Number);
    const gezien = new Set();
    const voegToe = (ruw, index, lengte) => {
      const voor = tekst.slice(Math.max(0, index - 40), index);
      const na = tekst.slice(index + lengte, index + lengte + 25);
      // verzendkosten en puntenscores zijn geen flesprijs
      if (VERZENDKOST.test(voor)) return;
      if (GEEN_PRIJS_ACHTER.test(na)) return;
      let p = parseAmount(ruw);
      // andere munt dan euro: omrekenen met de ECB-dagkoers, of weren als we die niet hebben
      const dichtbij = tekst.slice(Math.max(0, index - 12), index);
      let munt = "";
      if (VREEMDE_MUNT.test(dichtbij) || VREEMDE_MUNT.test(na.slice(0, 8))) {
        munt = muntBij(dichtbij, na.slice(0, 8));
        const koers = munt && rates ? rates[munt] : 0;
        if (!koers) return;                       // geen koers = geen prijs, niet gokken
        p = p / koers;
      }
      const zonderBtw = EXCL_BTW.test(voor) || EXCL_BTW.test(na);
      if (zonderBtw) p = p * BTW_TARIEF;
      p = Math.round(p * 100) / 100;
      if (p >= 3 && p <= 50000 && !gezien.has(p)) {
        gezien.add(p);
        out.push({ price: p, url: it.url || "", title: it.title || "", years: jaar, btw: zonderBtw, munt });
      }
    };
    let m;
    GELDBEDRAG.lastIndex = 0;
    while ((m = GELDBEDRAG.exec(tekst))) voegToe(m[1] || m[2], m.index, m[0].length);
    if (PRIJSCONTEXT.test(tekst)) {
      BEDRAG_KAAL.lastIndex = 0;
      while ((m = BEDRAG_KAAL.exec(tekst))) voegToe(m[0], m.index, m[0].length);
    }
  }
  return out;
}

// bron-URL van het aanbod dat het dichtst bij de gekozen prijs ligt
const nearestUrl = (pool, price) =>
  (pool.map((o) => ({ u: o.url || "", d: Math.abs(num(o.price) - price) }))
    .filter((x) => x.u).sort((a, c) => a.d - c.d)[0] || {}).u || "";

// Alle prijsbronnen samen: Vivino-aanbiedingen én bedragen uit de zoekresultaten.
// Meerdere bronnen maken de prijs robuuster dan één bron, en met de mediaan weegt
// één uitschieter (een verkeerde wijn, een doosprijs) niet door.
function pickPrice(offers, snips, b) {
  const uitVivino = vivinoKeuze(offers, b).lijst
    .filter((o) => num(o.price) > 0 && (!o.volumeMl || o.volumeMl === 750))
    .map((o) => ({ price: num(o.price), url: o.url || "", years: [parseInt(o.vintage)].filter(Boolean), bron: "Vivino" }));
  const uitWeb = (snips || []).map((s) => ({ ...s, bron: s.title || "zoekresultaat" }));
  const alle = [...uitVivino, ...uitWeb];
  if (!alle.length) return null;

  const y = parseInt(b.vintage);
  const exact = y ? alle.filter((p) => p.years.includes(y)) : [];
  const pool = exact.length ? exact : alle;
  const prijs = median(pool.map((p) => p.price));
  const dichtst = [...pool].sort((a, c) => Math.abs(a.price - prijs) - Math.abs(c.price - prijs))[0];
  const bronnen = [...new Set(pool.map((p) => (p.bron === "Vivino" ? "Vivino" : "winkels")))];
  return {
    price: prijs, n: pool.length, exact: exact.length > 0, url: dichtst ? dichtst.url : "",
    years: [...new Set(pool.flatMap((p) => p.years))].sort(), bronnen,
    btw: pool.some((p) => p.btw),   // zat er een prijs excl. btw bij die we hebben bijgeteld?
    munten: [...new Set(pool.map((p) => p.munt).filter(Boolean))],
  };
}

// kies een marktprijs: eerst de exacte jaargang, anders naburige jaargangen van dezelfde wijn
function marketPrice(offers, b) {
  const cand = vivinoKeuze(offers, b).lijst.filter((o) => num(o.price) > 0 && (!o.volumeMl || o.volumeMl === 750));
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
// Herkomst volgens Vivino (streek + land), van het best passende aanbod. Dit is
// harde brondata en gaat dus vóór op wat het model uit de naam zou afleiden.
// Etiketfoto van het best passende aanbod, bij voorkeur van de eigen jaargang.
function vivinoImage(offers, b) {
  const passend = vivinoKeuze(offers, b).lijst.filter((o) => o.image);
  if (!passend.length) return "";
  const y = parseInt(b.vintage);
  const exact = y ? passend.filter((o) => parseInt(o.vintage) === y) : [];
  return (exact[0] || passend[0]).image;
}

function vivinoOrigin(offers, b) {
  const beste = vivinoKeuze(offers, b).lijst.filter((o) => o.region || o.country)
    .sort((a, c) => offerMatch(c, b) - offerMatch(a, b))[0];
  return beste ? { region: beste.region || "", country: beste.country || "" } : null;
}

// Vivino-score van dezelfde wijn: eerst deze jaargang, anders de jaargang met de
// meeste beoordelingen (die wordt dan expliciet als 'andere jaargang' gemeld)
function vivinoRating(offers, b) {
  const cand = vivinoKeuze(offers, b).lijst.filter((o) => num(o.rating) > 0 && num(o.ratings) > 0);
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

// Zoekterm zonder dubbels: staat de producentnaam al in de wijnnaam ("Soldera" +
// "Soldera Case Basse"), dan vervuilt die herhaling de zoekopdracht.
function wineTerm(b) {
  const kaal = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  const naam = String(b.name || "").trim();
  const inNaam = new Set(naam.split(/\s+/).map(kaal).filter(Boolean));
  const prod = String(b.producer || "").trim().split(/\s+/).filter((w) => kaal(w) && !inNaam.has(kaal(w))).join(" ");
  // haakjes en leestekens halen we eruit: "Soldera (Gianfranco Soldera)" zoekt slechter
  const uit = [prod, naam].filter(Boolean).join(" ").trim() || String(b.producer || b.name || "").trim();
  return uit.replace(/[()\[\]{}"'`]/g, " ").replace(/\s+/g, " ").trim();
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
  "confidence": "hoog, midden of laag"
}`;

// images: array of { base64, media } — may be multiple photos (front/back) of the SAME bottle
async function analyzePhoto(images) {
  const imgs = Array.isArray(images) ? images : [images];
  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    system:
      "Je bent een ervaren sommelier en wijnexpert. De foto's tonen ALLEMAAL DEZELFDE fles (bv. voor- en achteretiket); combineer alle informatie tot één identificatie. " +
      "Op een etiket staan ook woorden die GEEN naam zijn: 'Azienda Agricola', 'Domaine', 'Château', 'Tenuta', 'Cantina', 'Weingut', 'Bodegas', 'Quinta', 'Società Agricola', 'Imbottigliato all'origine', 'Mis en bouteille', 'Produce of'. " +
      "Zet zo'n woord NOOIT alleen in 'producer': zoek de echte naam van het huis die erbij staat. Vind je die niet, laat 'producer' dan leeg in plaats van een rechtsvorm te geven. " +
      "Zet NOOIT de jaargang, het alcoholpercentage of de inhoud (75 cl) in 'name'; het jaartal hoort enkel in 'vintage'. Is er geen aparte cuvéenaam, gebruik dan de appellatie als 'name'. " +
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
  return schoonEtiket(parsed);
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
  "priceCurrency": "de muntcode van dat bedrag zoals het er staat (EUR, USD, GBP...), anders null",
  "priceInclVat": true als het bedrag inclusief btw is, false als het uitdrukkelijk exclusief btw is, null als het er niet bij staat,
  "drinkFrom": beste drinkjaar vanaf voor deze jaargang (getal),
  "drinkTo": beste drinkjaar tot voor deze jaargang (getal),
  "score": kritiekscore 0-100 die in de zoekresultaten staat voor DEZE jaargang, anders null,
  "reviews": "2 à 3 zinnen samenvatting van wat proevers en recensenten over deze wijn schrijven, in het Nederlands, met de bronnaam erbij; gaat het over een andere jaargang, begin dan met 'Recensie van jaargang JAAR, ter indicatie:'; is er niets, schrijf dan exact 'Geen recensie gevonden.'",
  "region": "streek/appellation VOLGENS DE ZOEKRESULTATEN; laat leeg als je het daar niet terugvindt",
  "country": "land VOLGENS DE ZOEKRESULTATEN; laat leeg als je het daar niet terugvindt",
  "placeName": "plaats waar de wijn gemaakt wordt (domein, streek, land)"
}`;
  // De streek NIET als vaststaand feit meegeven: komt ze uit een eerdere
  // etiketlezing, dan is ze mogelijk fout en herhaalt het model die fout eindeloos.
  const wijn = [b.producer, b.name, b.vintage].filter(Boolean).join(" ");
  const vermoeden = [b.region, b.country].filter(Boolean).join(", ");
  const naam = [wineTerm(b), b.vintage].filter(Boolean).join(" ");
  // twee gratis zoekopdrachten: één voor prijs/algemeen, één gericht op recensies
  // De prijszoekopdracht krijgt ook de Wikipedia-opzoeking mee (gratis, geen sleutel)
  // en is wat korter afgekapt, zodat het totaal richting het model gelijk blijft.
  // NIET tegelijk zoeken: Brave laat op de gratis laag één bevraging per seconde toe,
  // dus twee gelijktijdige zoekopdrachten leveren gegarandeerd een weigering op de
  // tweede op — en dat was net de recensiezoekopdracht.
  const zoek = async () => {
    const eerste = await fetchSearch({
      query: `${naam} wijn prijs per fles`,
      wine: { term: naam, producer: b.producer, name: b.name, vintage: b.vintage },
      wiki: String(b.producer || b.name || "").trim(),
      max: 2000,
    });
    const tweede = await fetchSearch({ query: `${naam} recensie review tasting notes`, prefix: "R" });
    return [eerste, tweede];
  };
  // DuckDuckGo knijpt bij drukte soms af en geeft dan een lege pagina terug. Komt
  // ALLES leeg terug, dan is dat een mislukte opzoeking en géén bewijs dat er niets
  // bestaat: één keer gratis opnieuw proberen, en anders eerlijk melden dat het
  // misliep — zo wordt een fles niet onterecht als prijsloos weggeschreven.
  let [main, rev] = await zoek();
  const leeg = (s) => !s.items.length && !s.offers.length;
  if (leeg(main) && leeg(rev)) {
    [main, rev] = await zoek();
    if (leeg(main) && leeg(rev)) {
      throw new Error("De zoekbronnen gaven even niets terug. Probeer het zo meteen opnieuw.");
    }
  }
  const { text: ctx, items, offers } = main;
  // prijzen uit ALLE resultaten (ook die van de recensiezoekopdracht: webshops
  // duiken daar evengoed op) samen met de Vivino-aanbiedingen
  const snips = snippetPrices([...(items || []), ...(rev.items || [])], b, main.rates);
  let mp = pickPrice(offers, snips, b);
  // Nog geen prijs? Dan de winkelpagina's zelf openen. Webshops zetten hun prijs
  // machineleesbaar in de pagina, ook wanneer het zoekfragment ze niet toont.
  let paginaNoot = "";
  if (!mp) {
    // Een extra zoekopdracht gericht op winkels: de gewone resultaten zijn vaak
    // redactionele sites die de wijn beschrijven maar niet verkopen.
    const winkelZoek = await fetchSearch({ query: `${naam} kopen prijs per fles` });
    const urls = [...new Set([...(items || []), ...(winkelZoek.items || []), ...(rev.items || [])]
      .map((i) => i.url).filter(Boolean))];
    paginaNoot = urls.length ? "" : "geen winkeladressen in de resultaten";
    if (urls.length) {
      const pg = await fetchSearch({ pages: urls, term: naam });
      const koersen = pg.rates || main.rates;
      const uitPaginas = (pg.pagePrices || []).map((p) => {
        let prijs = num(p.price);
        const munt = String(p.currency || "EUR").toUpperCase();
        if (munt !== "EUR") {
          const koers = koersen && koersen[munt];
          if (!koers) return null;                       // geen koers = geen prijs
          prijs = prijs / koers;
        }
        if (p.exclBtw) prijs = prijs * BTW_TARIEF;
        prijs = Math.round(prijs * 100) / 100;
        if (!(prijs >= 3 && prijs <= 50000)) return null;
        return {
          price: prijs, url: p.url || "", title: p.title || "",
          years: (String(p.title || "").match(/\b(19[5-9]\d|20[0-4]\d)\b/g) || []).map(Number),
          btw: !!p.exclBtw, munt: munt === "EUR" ? "" : munt,
        };
      }).filter(Boolean);
      if (uitPaginas.length) mp = pickPrice(offers, uitPaginas, b);
      if (!mp) paginaNoot = `${urls.length} winkelpagina${urls.length > 1 ? "'s" : ""} nagekeken, geen prijs`;
    }
  }
  const vr = vivinoRating(offers, b);
  const lines = offerLines(offers, b);
  const priceCtx = mp
    ? `Echte winkelprijzen (75 cl, EUR): ${mp.n} bedrag${mp.n > 1 ? "en" : ""} gevonden, mediaan € ${mp.price} (jaargang${mp.years.length > 1 ? "en" : ""} ${mp.years.join(", ") || "onbekend"}).\n` +
      (lines ? `${lines}\n` : "") + "Die prijs wordt automatisch gebruikt; laat retailPrice op null.\n"
    : "Geen winkelprijzen gevonden. Vul retailPrice enkel in als er een concreet bedrag in de zoekresultaten hieronder staat, met de bron erbij; anders null.\n";
  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1400,
    system:
      "Je bent een ervaren sommelier. Voor prijzen, scores, recensies EN de herkomst (streek/land) gebruik je UITSLUITEND de meegeleverde zoekresultaten; je eigen kennis mag enkel de beschrijving, de druif en het drinkvenster invullen. " +
      "De streek die de gebruiker meegeeft komt uit een etiketlezing en kan fout zijn: bevestigen de zoekresultaten ze niet, neem ze dan NIET over. " +
      "Staat er een Wikipedia-blok bij, gebruik dat voor de beschrijving en de herkomst (streek en land), maar NOOIT als recensie of score. " +
      "Een Franstalige naam betekent niet dat de wijn uit Frankrijk komt — er wordt ook in België, Zwitserland en Canada Franstalig geëtiketteerd. Laat region en country leeg als de resultaten er niets over zeggen. " +
      "Prijs: nooit schatten. Staat er geen concreet bedrag in de zoekresultaten, dan is retailPrice null. Het gaat altijd om één fles van 75 cl. " +
      "Neem het bedrag over ZOALS het er staat en vul priceCurrency en priceInclVat naar waarheid in; reken zelf niets om, dat doet de app. " +
      "Recensies: schrijf 2 à 3 zinnen over hoe deze wijn proeft en wat recensenten ervan vinden, ALLEEN op basis van de meegeleverde recensieresultaten, met de bronnaam erbij. " +
      "Verzin nooit een citaat, punt of bron. Vind je niets voor deze jaargang, dan mag je recensies van een ANDERE jaargang van dezelfde wijn samenvatten, " +
      "maar dan begint reviews verplicht met 'Recensie van jaargang JAAR, ter indicatie:' en blijft score null. Staat er in de resultaten echt niets over deze wijn, dan is reviews exact 'Geen recensie gevonden.' " +
      "Vermeld Vivino niet in reviews; die score wordt er automatisch bij gezet. " +
      "Verwijs bij een prijs met priceSourceIndex naar het nummer van het zoekresultaat waar dat bedrag staat. " +
      "Begin met '{' en eindig met '}'. Antwoord UITSLUITEND met het volledige geldige JSON-object volgens het schema, zonder tekst errond of markdown.",
    messages: [{
      role: "user",
      content: `Wijn en jaargang: ${wijn}\n` +
        (vermoeden ? `Streek volgens de etiketlezing (ONBEVESTIGD, mogelijk fout): ${vermoeden}\n` : "") +
        `\n${priceCtx}\n` +
        (main.wiki ? `Wikipedia — ${main.wiki.title} (achtergrond over domein/streek, GEEN recensie):\n${main.wiki.extract}\n\n` : "") +
        `Zoekresultaten:\n${ctx || "(geen)"}\n\n` +
        `Recensies en proefnotities uit een aparte zoekopdracht:\n${rev.text || "(geen)"}\n\n` +
        `Geef exact dit JSON-object terug:\n${schema}`,
    }],
  };
  const data = await callClaude(body);
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const parsed = extractJson(text);
  if (!parsed) throw new Error("Kon jaargang niet opzoeken.");
  const res = applyReviews(applyMarketPrice(parsed, mp, b, items, main.rates, offers), vr);
  // harde herkomstdata van Vivino wint van wat het model uit de naam afleidde
  const etiket = vivinoImage(offers, b);
  if (etiket) res.imageUrl = etiket;
  const herkomst = vivinoOrigin(offers, b);
  if (herkomst && herkomst.country) { res.region = herkomst.region || res.region; res.country = herkomst.country; }
  // Coördinaten uit een echte geocoder in plaats van uit het model: zo krijgt elke
  // jaargang van dezelfde wijn hetzelfde punt, en klopt het ook nog.
  const plek = [res.region || b.region, res.country || b.country].filter(Boolean).join(", ");
  const g = plek ? (await fetchSearch({ geo: plek })).geo : null;
  res.lat = g ? g.lat : "";
  res.lng = g ? g.lng : "";
  if (g && !res.placeName) res.placeName = plek;

  // Gaven de webbronnen niets terug, dan is er niets geverifieerd: dat moet je
  // kunnen zien, anders blijft een gok van de etiketlezing er staan als feit.
  const webBron = main.sources.webBron || "de webzoekopdracht";
  // Werd Brave niet gebruikt, zeg er dan bij waarom — anders blijft onduidelijk of
  // de sleutel ontbreekt, geweigerd wordt, of dat Brave gewoon niets vond.
  const braveUitleg = main.sources.brave && main.sources.brave !== "ok" && main.sources.brave !== "niet gevraagd"
    ? ` (Brave: ${main.sources.brave})` : "";
  res.verifyNote = (items.length || rev.items.length)
    ? ""
    : `Niet geverifieerd: ${webBron} gaf geen resultaten${braveUitleg}, dus streek, beschrijving en recensies konden niet nagekeken worden.`;
  // Wordt er geen prijs gevonden terwijl een bron onbereikbaar was, zeg dat er
  // dan bij. Anders lijkt een geblokkeerde bron op "deze wijn bestaat nergens".
  if (res.retailPrice === "") {
    const kapot = (v) => v === "onbereikbaar" || v === "fout";
    const web = main.sources.webBron || "de webzoekopdracht";
    // Vivino kan resultaten geven die geen van alle bij DEZE wijn horen; dat is iets
    // anders dan een lege of onbereikbare bron en moet apart benoemd worden.
    const passend = (offers || []).filter((o) => offerMatch(o, b) >= 0.55).length;
    const stuk = [
      kapot(main.sources.vivino) ? "Vivino was niet bereikbaar"
        : main.sources.vivino === "leeg" ? "Vivino gaf niets terug"
        : !passend ? `Vivino kende deze wijn niet (${offers.length} andere resultaten na ${main.sources.vivinoPogingen || 1} poging${(main.sources.vivinoPogingen || 1) > 1 ? "en" : ""})` : "",
      kapot(main.sources.web) ? `${web} was niet bereikbaar` : main.sources.web === "leeg" ? `${web} gaf niets terug` : "",
    ].filter(Boolean);
    if (paginaNoot) stuk.push(paginaNoot);
    if (stuk.length) res.priceNote = `geen prijs gevonden — ${stuk.join(", ")}`;
  }
  return res;
}

// Prijs: enkel echte bedragen. Volgorde: (1) marktprijs voor exact deze jaargang,
// (2) marktprijs van naburige jaargangen, (3) een bedrag dat het model letterlijk
// uit de zoekresultaten haalde (met bron), (4) niets — dan blijft de prijs leeg.
// De bron-URL komt altijd uit onze eigen lijst (via het nummer van het
// zoekresultaat), nooit uit de tekst van het model: zo kan ze niet verzonnen zijn.
function applyMarketPrice(res, mp, b, items, rates, offers) {
  // welke wijn heeft Vivino ons eigenlijk gegeven? Wijkt die naam af van wat er
  // bij de fles staat, dan hoort dat in de notitie
  // Enkel melden wanneer de gevonden wijn woorden bevat die niet bij mijn fles
  // horen. Dat Vivino een Haut-Brion "Pessac-Leognan" noemt is geen verschil dat
  // je moet nakijken; "Clos de Beze" bij een Chambertin wel.
  const keuze = vivinoKeuze(offers, b);
  // Waarschuw enkel bij het gevaarlijke geval: de gevonden naam bevat MIJN hele
  // naam en nog woorden erbij, zoals "Chambertin Clos de Beze" bij een
  // "Chambertin". Noemt Vivino de wijn gewoon anders (een Haut-Brion heet daar
  // "Pessac-Leognan"), dan is er niets aan de hand en zwijgen we.
  const mijnNaam = keyTokens(b.name);
  const eerste = keuze.lijst[0];
  const specifieker = eerste && mijnNaam.length
    && mijnNaam.every((t) => keyTokens(eerste.name).includes(t));
  const anders = specifieker && keuze.vreemd > 0
    ? ` \u2014 let op: Vivino noemt deze wijn "${eerste.name}"` : "";
  const btwNoot = (mp && mp.btw ? ", btw bijgeteld" : "") +
    (mp && mp.munten && mp.munten.length ? `, omgerekend van ${mp.munten.join(" en ")} (ECB-dagkoers)` : "");
  const found = num(res.retailPrice);
  const src = String(res.priceSource || "").trim();
  const idx = parseInt(res.priceSourceIndex);
  const hit = idx > 0 && Array.isArray(items) ? items[idx - 1] : null;
  if (mp && mp.n > 1) {
    const waar = mp.bronnen.join(" en ");
    res.retailPrice = mp.price;
    res.priceNote = (mp.exact
      ? `mediaan van ${mp.n} winkelprijzen voor jaargang ${b.vintage} (${waar})`
      : mp.years.length
        ? `mediaan van ${mp.n} winkelprijzen, jaargang${mp.years.length > 1 ? "en" : ""} ${mp.years.join(", ")} — ter indicatie`
        : `mediaan van ${mp.n} winkelprijzen (${waar}), jaargang niet vermeld — ter indicatie`) + btwNoot;
    res.priceUrl = mp.url || "";
  } else if (mp && mp.exact) {
    res.retailPrice = mp.price;
    res.priceNote = `winkelprijs jaargang ${b.vintage} (${mp.bronnen.join(" en ")}, 75 cl)` + btwNoot;
    res.priceUrl = mp.url || "";
  } else if (mp) {
    res.retailPrice = mp.price;
    res.priceNote = (mp.years.length
      ? `winkelprijs van jaargang${mp.years.length > 1 ? "en" : ""} ${mp.years.join(", ")}, ter indicatie`
      : `winkelprijs uit een webwinkel, jaargang niet vermeld — ter indicatie`) + btwNoot;
    res.priceUrl = mp.url || "";
  } else if (found > 0 && src) {
    // Ook deze route moet in euro én inclusief btw eindigen, anders vervuilt ze de
    // statistiek. Kunnen we niet omrekenen, dan liever geen prijs.
    const munt = String(res.priceCurrency || "EUR").toUpperCase();
    let bedrag = found;
    let extra = "";
    if (munt !== "EUR") {
      const koers = rates && rates[munt];
      if (!koers) { res.retailPrice = ""; res.priceNote = `prijs gevonden in ${munt}, maar geen koers beschikbaar`; res.priceUrl = ""; return res; }
      bedrag = bedrag / koers;
      extra += `, omgerekend van ${munt} (ECB-dagkoers)`;
    }
    if (res.priceInclVat === false) { bedrag = bedrag * BTW_TARIEF; extra += ", btw bijgeteld"; }
    bedrag = Math.round(bedrag * 100) / 100;
    const py = parseInt(res.priceVintage), y = parseInt(b.vintage);
    res.retailPrice = bedrag;
    res.priceNote = (py && y && py !== y
      ? `winkelprijs van jaargang ${py} bij ${src}, ter indicatie`
      : `winkelprijs uit de zoekresultaten (${src})`) + extra;
    res.priceUrl = (hit && hit.url) || "";
  } else {
    res.retailPrice = "";
    res.priceNote = "geen prijs gevonden";
    res.priceUrl = "";
  }
  // Alle opgezochte prijzen gelden voor een fles van 75 cl. Voor een magnum of een
  // halve fles rekenen we evenredig om, en zeggen we dat er uitdrukkelijk bij.
  if (mp && anders && num(res.retailPrice) > 0) res.priceNote += anders;
  const ml = num(b.volumeMl) || 750;
  if (ml !== 750 && num(res.retailPrice) > 0) {
    res.retailPrice = Math.round(num(res.retailPrice) * (ml / 750) * 100) / 100;
    res.priceNote += `, omgerekend naar ${formaatLabel(ml)}`;
  }
  return res;
}

// Vivino-score met aantal beoordelingen erbij, met de jaargang expliciet vermeld.
function applyReviews(res, vr) {
  const line = vivinoLine(vr);
  const cur = String(res.reviews || "").trim();
  const none = !cur || /geen recensie/i.test(cur);
  if (!line) { res.reviews = none ? "Geen recensie gevonden." : cur; return res; }
  // Het Vivino-cijfer is een AANVULLING, nooit de hele inhoud. Is er geen enkele
  // recensie gevonden, dan moet dat er ook staan; anders lijkt een gemiddelde van
  // duizenden gebruikers op een proefnotitie.
  res.reviews = none ? `Geen recensie gevonden. ${line}` : `${cur} ${line}`;
  return res;
}

// map an analysis/search result into a bottle draft
// Rechtsvormen zijn geen producentnaam, en een jaartal is geen wijnnaam. Wat het
// model daar toch in zet, halen we er hier uit: anders zoekt de app verder op
// "Azienda Agricola" en vindt ze nooit de juiste wijn.
const RECHTSVORM = /^(azienda\s+agricola|societa\s+agricola|società\s+agricola|domaine|domain|ch(a|â)teau|tenuta|cantina|cantine|weingut|bodegas?|quinta|maison|fattoria|podere|winery|estate|casa|vinicola|vi(n|ñ)edos)$/i;

function schoonEtiket(d) {
  const uit = { ...d };
  const kaal = (x) => String(x || "").trim().replace(/[.,;]+$/, "");
  if (RECHTSVORM.test(kaal(uit.producer))) uit.producer = "";
  // een naam die enkel een getal is (jaartal, inhoud) zegt niets
  if (/^[\d\s.,%clL-]+$/.test(kaal(uit.name))) uit.name = "";
  // stond de jaargang achteraan de naam, dan mag ze daar weg
  const jaar = String(uit.vintage || "").match(/\d{4}/);
  if (jaar) uit.name = String(uit.name || "").replace(new RegExp(`\\b${jaar[0]}\\b`, "g"), "").replace(/\s+/g, " ").trim();
  return uit;
}

function resultToData(ruw) {
  const res = schoonEtiket(ruw);
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
    // notities blijven van de gebruiker: de etiketlezing schrijft er niet in,
    // want die gok werd nooit meer gecorrigeerd en bleef als feit staan
    notes: "",
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
    // r.priceNote bevat de REDEN (welke bron niets gaf); die mag hier niet
    // verloren gaan, anders zie je enkel een kale "geen prijs gevonden"
    ? { retailValue: b.retailValue ?? "", priceNote: had ? (b.priceNote || "") : (r.priceNote || "geen prijs gevonden"), priceUrl: had ? (b.priceUrl || "") : "" }
    : { retailValue: r.retailPrice, priceNote: r.priceNote || "", priceUrl: r.priceUrl || "" };
  return {
    grape: b.grape || r.grape || "",
    // streek en land mogen door de opzoeking gecorrigeerd worden: een foute
    // etiketlezing bleef anders eeuwig staan (en werd door elke opzoeking herhaald)
    region: keep(b.region, r.region || b.region),
    country: keep(b.country, r.country || b.country),
    description: r.description || b.description || "",
    reviews: r.reviews || b.reviews || "",
    placeName: r.placeName || b.placeName || "",
    imageUrl: r.imageUrl || b.imageUrl || "",
    lat: r.lat ?? b.lat ?? "",
    lng: r.lng ?? b.lng ?? "",
    ...price,
    verifyNote: r.verifyNote || "",
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
const SOMM_LEGENDE = "producent en wijn | jaargang | kleur | druif | streek | waarde | aankoopprijs | winkel | drinkvenster en status | aantal | formaat | locatie | score | eigen proefnotitie | recensies | beschrijving";

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

function cellarLine(b, n) {
  const st = drinkStatus(b);
  const window = [b.drinkFrom, b.drinkTo].filter(Boolean).join("-");
  const v = effVal(b).v;
  const kort = (t, n) => String(t || "").replace(/\s+/g, " ").trim().slice(0, n);
  const parts = [
    [b.producer, b.name].filter(Boolean).join(" ") || "onbekende wijn",
    b.vintage || "NV",
    b.color,
    b.grape,
    [b.region, b.country].filter(Boolean).join(", "),
    v > 0 ? `waarde €${Math.round(v)}` : "waarde onbekend",
    money(b.purchasePrice) > 0 ? `gekocht voor €${Math.round(money(b.purchasePrice))}` : "",
    b.supplier ? `bij ${kort(b.supplier, 40)}` : "",
    [window, st.label !== "—" ? st.label : ""].filter(Boolean).join(" ") || "geen drinkvenster",
    `${num(b.quantity) || 1}x`,
    formaatKort(b.volumeMl),
    b.location,
    num(b.score) > 0 ? `score ${b.score}` : "",
  ];
  // De basisregel wordt begrensd, de teksten krijgen elk hun eigen ruimte. Zo kan
  // een lange wijnnaam nooit de eigen proefnotitie van de gebruiker wegduwen.
  let line = parts.filter(Boolean).join(" | ").slice(0, 320);
  if (n.eigen && b.tasteNotes) line += ` | MIJN EIGEN PROEFNOTITIE: "${kort(b.tasteNotes, n.eigen)}"`;
  if (n.notitie && b.notes) line += ` | mijn notitie: ${kort(b.notes, n.notitie)}`;
  if (n.recensie && b.reviews) line += ` | recensies: ${kort(b.reviews, n.recensie)}`;
  if (n.over && b.description) line += ` | over de wijn: ${kort(b.description, n.over)}`;
  return line;
}
// bouwt de lijst op; wordt ze te groot, dan vallen eerst de proefnotities
// weg en pas daarna de laatste wijnen (dat wordt dan gemeld in het antwoord)
// Hoeveel plaats de teksten per fles maximaal krijgen als alles past.
const SOMM_RUIM = { eigen: 600, notitie: 200, recensie: 300, over: 250 };
const SOMM_KAAL = { eigen: 0, notitie: 0, recensie: 0, over: 0 };

// De kale regels moeten er sowieso in; wat overblijft verdelen we eerlijk over de
// flessen. Krimpt de ruimte, dan sneuvelt eerst de beschrijving, dan de recensie,
// dan mijn losse notitie. De eigen proefnotitie verdwijnt als allerlaatste: die is
// het waardevolst en staat nergens anders.
function somRuimte(bottles) {
  if (!bottles.length) return SOMM_KAAL;
  const kaal = bottles.map((b, i) => `${i + 1}. ${cellarLine(b, SOMM_KAAL)}`).join("\n").length;
  // elk stukje tekst sleept ook een etiket mee (' | MIJN EIGEN PROEFNOTITIE: "…"'),
  // dus houden we daar per fles wat ruimte voor vrij
  const per = Math.floor(Math.max(0, SOMM_MAX_CHARS - kaal) / bottles.length) - 100;
  // onder de 60 tekens is een notitie niet meer dan een halve zin: dan liever niets
  if (per < 60) return SOMM_KAAL;
  return {
    eigen: Math.min(SOMM_RUIM.eigen, per),
    notitie: Math.min(SOMM_RUIM.notitie, Math.max(0, per - SOMM_RUIM.eigen)),
    recensie: Math.min(SOMM_RUIM.recensie, Math.max(0, per - SOMM_RUIM.eigen - SOMM_RUIM.notitie)),
    over: Math.min(SOMM_RUIM.over, Math.max(0, per - SOMM_RUIM.eigen - SOMM_RUIM.notitie - SOMM_RUIM.recensie)),
  };
}

function cellarContext(bottles) {
  const n = somRuimte(bottles);
  const lines = bottles.map((b, i) => `${i + 1}. ${cellarLine(b, n)}`);
  const notesDropped =
    n.eigen >= SOMM_RUIM.eigen && n.notitie >= SOMM_RUIM.notitie && n.recensie >= SOMM_RUIM.recensie && n.over >= SOMM_RUIM.over
      ? ""
      : n.eigen > 0
        ? "de notities zijn ingekort om plaats te sparen"
        : "de notities zijn weggelaten om plaats te sparen";
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
  "Je bent de persoonlijke sommelier van deze wijnkelder. Je krijgt een KANDIDATENLIJST met de flessen die aan de vraag voldoen, met per fles alles wat de app erover weet. " +
  "ALLES in die lijst is beschikbare informatie — ook wat achter 'MIJN EIGEN PROEFNOTITIE' staat: dat schreef de eigenaar zelf. Gebruik die notities actief en citeer er kort uit wanneer ze relevant zijn; zeg NOOIT dat je ze niet hebt. " +
  "Begin METEEN met je aanbeveling, zonder inleiding als 'op basis van wat ik vind' of 'goede vraag'. " +
  "Wees concreet: zeg wat DEZE fles onderscheidt — de jaargang, de rijping, de eigen proefnotitie, de score, waar ze ligt. Vermijd algemeenheden die voor elke rode of witte wijn gelden. " +
  "Geef hoogstens drie suggesties, de beste eerst, en durf te zeggen welke jij zou opentrekken en waarom. " +
  "Regels: (1) beveel UITSLUITEND flessen uit die kandidatenlijst aan, nooit een wijn die er niet in staat; " +
  "(2) verzin nooit een prijs, jaargang, score, streek of proefnota die er niet bij staat; " +
  "(3) respecteer alle criteria die bij de vraag staan; " +
  "(4) leg bij elke aanbeveling in één of twee zinnen uit waarom die wijn bij het gerecht of de gelegenheid past — verwijs naar druif, streek, stijl of de proefnotities; " +
  "(5) noem telkens producent, wijn en jaargang, en de locatie in de kelder als die gekend is; " +
  "(6) geef maximaal vier suggesties, de beste eerst; " +
  "(7) staat de lijst als 'voldoet NIET aan alle criteria' gemarkeerd, zeg dan eerlijk dat er niets past en zeg er bij elke suggestie expliciet bij wat er niet klopt (te duur, nog te jong, andere kleur). Is de lijst leeg, zeg dan gewoon dat je niets passends vindt. " +
  "Staat er een MIJN DRINKLOGBOEK bij, dan zijn die cijfers al geteld door de app: neem ze letterlijk over voor vragen over wat er gedronken werd of hoeveel dat kostte, en reken er zelf niets bij. " +
  "Antwoord in vlot, informeel Nederlands (Vlaams), zonder tabellen en zonder markdown-opmaak: korte alinea's of streepjes.";

// Wat je effectief gedronken hebt, deterministisch geteld uit het logboek. Het
// model rekent hier niets zelf uit: het krijgt de cijfers kant en klaar.
// De aangevinkte woorden en de eigen tekst tot één leesbare zin, want dat is wat
// er bij de proefnotities terechtkomt.
// Oude regels uit het logboek hebben nog geen soort; die waren altijd gedronken.
const logSoort = (e) => (WEG_REDENEN.find((r) => r.k === (e.type || "gedronken")) || WEG_REDENEN[0]).label.toLowerCase();

function drinkZin(e) {
  const lijst = (k) => (Array.isArray(e[k]) ? e[k] : []).join(", ");
  const delen = [
    lijst("kleur") ? `Kleur: ${lijst("kleur")}.` : "",
    [lijst("neusPrimair"), lijst("neusSecundair"), lijst("neusTertiair")].filter(Boolean).join(", "),
    lijst("smaak") ? `Smaak: ${lijst("smaak")}.` : "",
    lijst("evolutie") ? `Evolutie: ${lijst("evolutie")}.` : "",
    e.rijpheid || "",
    String(e.indruk || "").trim(),
    e.gerecht ? `Bij ${e.gerecht}.` : "",
    (e.gelegenheid || e.waar) ? `(${[e.gelegenheid, e.waar].filter(Boolean).join(", ")})` : "",
  ];
  const neus = delen[1] ? `Neus: ${delen[1]}.` : "";
  delen[1] = neus;
  return delen.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function drinkSamenvatting(bottles) {
  const rijen = [];
  for (const b of bottles || []) {
    for (const e of (Array.isArray(b.drinkLog) ? b.drinkLog : [])) rijen.push({ ...e, b });
  }
  if (!rijen.length) return "";
  rijen.sort((x, y) => String(y.d).localeCompare(String(x.d)));
  // oude regels hebben nog geen soort; die waren altijd gedronken
  const gedronken = rijen.filter((x) => (x.type || "gedronken") === "gedronken");
  const verkocht = rijen.filter((x) => x.type === "verkocht");
  const nu = new Date().toISOString().slice(0, 10);
  const tel = (lijst, vanaf) => {
    const r = lijst.filter((x) => String(x.d) >= vanaf);
    return { n: r.reduce((s, x) => s + (num(x.n) || 1), 0), v: r.reduce((s, x) => s + (num(x.v) || 0) * (num(x.n) || 1), 0) };
  };
  const regel = (l, t) => `${l}: ${t.n} fles${t.n === 1 ? "" : "sen"}${t.v > 0 ? `, samen ongeveer ${eur(t.v)}` : ""}`;
  const laatste = gedronken.slice(0, 12).map((x) => {
    const extra = DRINK_VRAGEN
      .map((v) => {
        const w = Array.isArray(x[v.k]) ? x[v.k].join(", ") : x[v.k];
        return w ? `${v.label.toLowerCase()}: ${w}` : "";
      })
      .filter(Boolean).join("; ");
    return `- ${x.d} · ${(num(x.n) || 1)}× ${[x.b.producer, x.b.name, x.b.vintage].filter(Boolean).join(" ")}` +
      `${num(x.v) > 0 ? ` (${eur(num(x.v) * (num(x.n) || 1))})` : ""}${x.rijpheid ? ` — ${x.rijpheid}` : ""}${extra ? ` — ${extra}` : ""}`;
  }).join("\n").slice(0, 1800);
  const vk = verkocht.reduce((s, x) => s + (num(x.n) || 1), 0);
  const verkoop = vk
    ? `\nApart hiervan verkocht of weggegeven: ${vk} fles${vk === 1 ? "" : "sen"}. Die tellen NIET mee als gedronken.\n`
    : "";
  return "\nMIJN DRINKLOGBOEK (al geteld, gebruik deze cijfers letterlijk):\n" +
    `${regel("Deze maand gedronken", tel(gedronken, nu.slice(0, 8) + "01"))}\n` +
    `${regel("Dit jaar gedronken", tel(gedronken, nu.slice(0, 4) + "-01-01"))}\n` +
    `${regel("In totaal gedronken", tel(gedronken, "0000"))}\n` +
    verkoop +
    `Laatst gedronken:\n${laatste}\n`;
}

async function askSommelier({ bottles, alles, question, history }) {
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
        (notesDropped ? `(${notesDropped}; de lijst was te lang.)\n` : "") +
        (noPrice ? `(${noPrice} wijnen zijn weggelaten omdat hun prijs niet gekend is; vermeld dat kort.)\n` : "") +
        drinkSamenvatting(alles || bottles) +
        (hist ? `\n${hist}\n` : "") +
        `\nMijn vraag: ${question}`,
    }],
  };
  const data = await callClaude(body);
  const out = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  if (!out) throw new Error("Geen antwoord gekregen.");
  return out;
}

// ---------- vraag over één fles (op de detailkaart) ----------
// Veel goedkoper dan een kelderbrede vraag: de context is één fles. Draait op
// Haiku, met een gratis zoekopdracht als onderbouwing, en enkel als je zelf
// op verzenden tikt — nooit automatisch bij het openen van een fles.
async function askWineQuestion({ b, question, history }) {
  const st = drinkStatus(b);
  const fles = [
    ["producent", b.producer], ["wijn", b.name], ["jaargang", b.vintage],
    ["kleur", b.color], ["druif", b.grape],
    ["streek", [b.region, b.country].filter(Boolean).join(", ")],
    ["drinkvenster", [b.drinkFrom, b.drinkTo].filter(Boolean).join("-")],
    ["status", st.label !== "—" ? st.label : ""],
    ["formaat", formaatLabel(b.volumeMl)],
    ["aantal in kelder", b.quantity], ["locatie", b.location],
    ["aankoopprijs", money(b.purchasePrice) > 0 ? `EUR ${money(b.purchasePrice)}` : ""],
    ["gekocht bij", b.supplier],
    ["huidige waarde", effVal(b).v > 0 ? `EUR ${Math.round(effVal(b).v)}` : ""],
    ["score", num(b.score) > 0 ? String(b.score) : ""],
    ["beschrijving", b.description], ["recensies", b.reviews],
    ["MIJN EIGEN PROEFNOTITIE (door de eigenaar zelf geschreven)", b.tasteNotes],
    ["mijn notities", b.notes],
  ].filter((r) => String(r[1] || "").trim())
    .map((r) => `${r[0]}: ${String(r[1]).replace(/\s+/g, " ").slice(0, 300)}`).join("\n");

  const { text: ctx } = await fetchSearch({
    query: `${[wineTerm(b), b.vintage].filter(Boolean).join(" ")} ${question}`.slice(0, 200),
  });
  const hist = (history || []).slice(-2)
    .map((t) => `Eerdere vraag: ${t.q}\nJouw eerdere antwoord (beknopt): ${String(t.a).replace(/\s+/g, " ").slice(0, 500)}`)
    .join("\n\n");
  const body = {
    model: SOMMELIER_MODEL,
    max_tokens: 900,
    thinking: { type: "disabled" },
    system:
      "Je bent de persoonlijke sommelier van deze wijnliefhebber en beantwoordt een vraag over één bepaalde fles uit zijn kelder. " +
      "ALLES onder 'De fles waarover ik iets vraag' is beschikbare informatie, ook de eigen proefnotitie van de eigenaar. Gebruik die actief en citeer er kort uit wanneer ze relevant is; zeg NOOIT dat je ze niet hebt. " +
      "Begin METEEN met het antwoord, zonder inleiding als 'op basis van wat ik vind'. Wees concreet over DEZE fles en jaargang en vermijd algemeenheden die voor elke wijn van dat type gelden. " +
      "Steun op de meegeleverde zoekresultaten voor feiten (geschiedenis van het domein, stijl, jaargang, prijzen, scores) en noem de bron als je iets overneemt. " +
      "Verzin nooit een feit, jaartal, score, prijs of citaat. Weet je iets niet of staat het niet in de resultaten, zeg dat dan gewoon; " +
      "algemene kennis mag, maar zeg er dan bij dat je het niet kon nakijken. " +
      "Antwoord in vlot, informeel Nederlands (Vlaams), in korte alinea's zonder markdown-opmaak, en hou het bij zo'n 150 woorden tenzij de vraag meer vraagt.",
    messages: [{
      role: "user",
      content: `De fles waarover ik iets vraag:\n${fles}\n\nZoekresultaten:\n${ctx || "(geen)"}\n` +
        (hist ? `\n${hist}\n` : "") + `\nMijn vraag: ${question}`,
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
  const [fTodo, setFTodo] = useState("");
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
  const [drinkFles, setDrinkFles] = useState(null);
  useZichtbareHoogte();
  const [showKaart, setShowKaart] = useState(false);
  const [showLog, setShowLog] = useState(false);
  // Een fles die je elders dronk staat wel in de gegevens (voor het logboek en de
  // sommelier) maar hoort niet in je kelder: niet in de lijst, niet in de cijfers.
  const kelder = useMemo(() => bottles.filter((b) => !b.buitenKelder), [bottles]);
  // Bewust NIET onthouden tussen twee keer openen: de app start altijd met de
  // bedragen dicht, zodat er niets op je scherm staat wanneer je ze aan iemand toont.
  const [toonGeld, setToonGeld] = useState(false);
  const wisselGeld = () => setToonGeld((v) => !v);
  // eigen naam voor de app; staat los van de kelderdata
  const [appNaam, setAppNaam] = useState(STANDAARDNAAM);
  const [naamBewerken, setNaamBewerken] = useState(false);
  useEffect(() => { try { if (LS) { const n = LS.getItem(NAAM_KEY); if (n && n.trim()) setAppNaam(n); } } catch {} }, []);
  const bewaarNaam = (n) => {
    const schoon = String(n || "").trim().slice(0, 28) || STANDAARDNAAM;
    setAppNaam(schoon);
    try { if (LS) LS.setItem(NAAM_KEY, schoon); } catch {}
  };
  const [sommThread, setSommThread] = useState([]); // [{q, a}] — blijft bewaard tijdens de sessie

  const fileImport = useRef();
  const filePhoto = useRef();
  const filePhotoAdd = useRef();
  const [addTarget, setAddTarget] = useState(null);
  const bottlesRef = useRef(bottles);
  useEffect(() => { bottlesRef.current = bottles; }, [bottles]);

  // Mislukt het lezen, dan blijft 'loaded' bewust false: het bewaar-effect hieronder
  // slaat dan niets op, zodat een onleesbare kelder niet overschreven wordt met leeg.
  const [loadFailed, setLoadFailed] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);
  useEffect(() => {
    loadBottles().then(({ list, ok }) => {
      if (!ok) { setLoadFailed(true); return; }
      setBottles(list); setLoaded(true);
    });
    loadPrevious().then((p) => setHasPrev(!!(p && p.length)));
  }, []);
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
  // De timer van een vorige melding moet afgebroken worden, anders wiste die de
  // voortgangsmelding van een lopende opzoeking na 2,6 seconden.
  const toastTimer = useRef(null);
  const setMelding = (m) => { clearTimeout(toastTimer.current); setToast(m); };
  const flash = (m) => {
    clearTimeout(toastTimer.current);
    setToast(m);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  };

  const countries = useMemo(
    () => [...new Set(bottles.map((b) => b.country).filter(Boolean))].sort(), [bottles]);

  const filtered = useMemo(() => {
    let list = kelder.filter((b) => {
      if (fColor && String(b.color).toLowerCase() !== fColor) return false;
      if (fStatus && drinkStatus(b).key !== fStatus) return false;
      if (fTodo === "geenAankoop" && money(b.purchasePrice) > 0) return false;
      if (fTodo === "geenWaarde" && effVal(b).v > 0) return false;
      if (fTodo === "nietOpgezocht" && b.enriched) return false;
      if (fTodo === "geenNotitie" && String(b.tasteNotes || "").trim()) return false;
      if (fTodo === "herproef" && !(num(b.herproefOp) && num(b.herproefOp) <= NOW)) return false;
      if (query) {
        // elk woord apart zoeken, en zonder accenten: "soldera 2019" en "rose"
        // vonden vroeger niets omdat er op de hele zin ineens gezocht werd
        const plat = (t) => String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        const hay = plat([b.producer, b.name, b.region, b.country, b.location, b.vintage, b.supplier, b.grape, b.tasteNotes].join(" "));
        const woorden = plat(query).split(/\s+/).filter(Boolean);
        if (!woorden.every((w) => hay.includes(w))) return false;
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
  }, [kelder, query, fColor, fStatus, fTodo, sort]);

  const stats = useMemo(() => {
    let flessen = 0, cost = 0, value = 0;
    // Rendement mag ALLEEN berekend worden op flessen waarvan zowel de aankoopprijs
    // als de waarde gekend is. Anders vergelijk je de aankoop van je hele kelder met
    // de waarde van een handvol flessen, en toont de app een verlies dat er niet is.
    let vgKost = 0, vgWaarde = 0, vgFlessen = 0;
    for (const b of kelder) {
      const q = num(b.quantity) || 0;
      const k = money(b.purchasePrice), w = effVal(b).v;
      flessen += q; cost += k * q; value += w * q;
      if (k > 0 && w > 0) { vgKost += k * q; vgWaarde += w * q; vgFlessen += q; }
    }
    const gain = vgWaarde - vgKost;
    const pct = vgKost > 0 ? (gain / vgKost) * 100 : 0;
    return { flessen, wijnen: kelder.length, cost, value, gain, pct, vgFlessen, volledig: vgFlessen === flessen };
  }, [kelder]);

  // ---- CRUD ----
  // behoudt een al toegekende id, zodat een achtergrondopzoeking de juiste fles bijwerkt
  const commitNew = (list, b) => [{ ...cleanBottle(b), id: b.id || uid() }, ...list];
  // add a new bottle, but stop for confirmation if the same wine already exists
  const addOrPrompt = (b, source) => {
    const cleaned = { ...cleanBottle(b), color: String(b.color || "rood").toLowerCase() };
    const existing = findDuplicate(kelder, cleaned);
    if (existing) { setDupPrompt({ incoming: cleaned, existing, source }); return false; }
    setBottles((prev) => commitNew(prev, cleaned));
    return true;
  };
  const resolveDup = (action) => {
    const dp = dupPrompt; if (!dp) return;
    if (action === "merge") {
      setBottles((prev) => prev.map((x) => x.id === dp.existing.id
        ? { ...x, quantity: String((num(x.quantity) || 0) + (num(dp.incoming.quantity) || 1)) } : x));
      flash("Aantal opgeteld bij de bestaande fles.");
    } else if (action === "add") {
      setBottles((prev) => commitNew(prev, dp.incoming));
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
    if (b.id) { setBottles((prev) => prev.map((x) => (x.id === b.id ? { ...x, ...cleanBottle(b) } : x))); setEdit(null); return; }
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
      .catch(() => flash("Toegevoegd. Info vernieuwen lukte niet."));
  };
  const removeBottle = (id) => setBottles((prev) => prev.filter((b) => b.id !== id));

  // ---- bulk multi-vintage ----
  const addBulk = (shared, rows, metOpzoeken) => {
    let list = bottles, added = 0, merged = 0;
    const nieuwe = [];
    // Laat je aankoopprijs of winkel leeg, dan neem je over wat je bij de eerste
    // ingevulde jaargang zette — anders moet je hetzelfde telkens opnieuw tikken.
    const eersteMet = (veld) => {
      const r = rows.find((x) => String(x[veld] ?? "").trim());
      return r ? String(r[veld]).trim() : "";
    };
    const valPrijs = eersteMet("purchasePrice") || shared.purchasePrice || "";
    const valWinkel = eersteMet("supplier") || shared.supplier || "";
    rows.forEach((row) => {
      const vintage = String(row.vintage || "").trim();
      const qty = String(row.quantity || "1");
      if (!vintage) return;
      const b = {
        ...cleanBottle(shared), vintage, quantity: qty,
        color: String(shared.color || "rood").toLowerCase(),
        volumeMl: num(row.volumeMl) || 750,
        purchasePrice: String(row.purchasePrice ?? "").trim() || valPrijs,
        supplier: String(row.supplier ?? "").trim() || valWinkel,
      };
      const existing = findDuplicate(list, b);
      if (existing) { list = list.map((x) => x.id === existing.id ? { ...x, quantity: String((num(x.quantity) || 0) + (num(qty) || 0)) } : x); merged++; }
      else { const nb = { ...b, id: uid(), enriched: false }; list = [nb, ...list]; added++; nieuwe.push(nb); }
    });
    persist(list);
    setShowBulk(false);
    flash(`${added} toegevoegd${merged ? `, ${merged} samengevoegd` : ""}.`);
    if (metOpzoeken && nieuwe.length) bulkLookup(nieuwe);
  };

  // Per jaargang een eigen opzoeking, ÉÉN VOOR ÉÉN. Niet parallel: Brave laat op de
  // gratis laag één bevraging per seconde toe, en elke opzoeking doet er meerdere.
  const bulkLookup = async (lijst) => {
    for (let i = 0; i < lijst.length; i++) {
      const b = lijst[i];
      setMelding(`Info opzoeken ${i + 1}/${lijst.length} — jaargang ${b.vintage}…`);
      try {
        const r = await lookupWineFull(b);
        patchBottle(b.id, enrichPatch(b, r, { keepFilled: true }));
      } catch { /* deze jaargang overslaan, de volgende gewoon proberen */ }
    }
    flash(`Info opgezocht voor ${lijst.length} jaargang${lijst.length > 1 ? "en" : ""}.`);
  };

  // ---- fles uit de kelder: afboeken en in het logboek zetten ----
  const boekGedronken = ({ reden, aantal, datum, herproef, opbrengst, antw, wijn, kostte, nieuw, alleenProeven }) => {
    const b = drinkFles;
    if (!b) return;
    const n = nieuw
      ? Math.max(1, parseInt(aantal) || 1)
      : Math.max(1, Math.min(num(b.quantity) || 1, parseInt(aantal) || 1));
    const info = WEG_REDENEN.find((r) => r.k === reden) || WEG_REDENEN[0];
    const gedronken = info.k === "gedronken";
    // enkel wat je invulde bewaren; lege antwoorden zijn niet van toepassing
    const gevuld = gedronken
      ? Object.fromEntries(Object.entries(antw || {})
          .map(([k, v]) => [k, Array.isArray(v) ? v : String(v || "").trim()])
          .filter(([, v]) => (Array.isArray(v) ? v.length : v)))
      : {};
    const rijp = RIJPHEID.find((r) => r.k === herproef);
    const entry = {
      d: datum || new Date().toISOString().slice(0, 10),
      n, v: nieuw ? (money(kostte) || 0) : (effVal(b).v || 0), type: info.k,
      ...(money(opbrengst) > 0 ? { opbrengst: money(opbrengst) } : {}),
      ...(rijp ? { rijpheid: rijp.label } : {}),
      ...gevuld,
    };
    const log = [...(Array.isArray(b.drinkLog) ? b.drinkLog : []), entry];
    // wat je proefde gaat ook naar de proefnotities, want dat is het veld dat de
    // sommelier leest
    const stukjes = gedronken ? drinkZin(entry) : "";
    const nieuweNotitie = stukjes
      ? [String(b.tasteNotes || "").trim(), `${entry.d}: ${stukjes}`].filter(Boolean).join("\n\n")
      : b.tasteNotes;
    // "mooi op dronk" en "over de piek" betekenen: nu bekijken. Een termijn in
    // jaren zet de fles pas later in het filter.
    const jaren = rijp ? rijp.jaren : (String(herproef).startsWith("j") ? parseInt(String(herproef).slice(1)) : null);
    // Alleen proeven: de notitie wordt bewaard, de kelder blijft ongemoeid en er
    // komt geen regel in het logboek — er ging immers geen fles weg.
    if (alleenProeven) {
      patchBottle(b.id, {
        tasteNotes: nieuweNotitie,
        ...(jaren !== null && !isNaN(jaren) ? { herproefOp: String(NOW + jaren) } : {}),
        ...(antw?.punten ? { score: String(antw.punten) } : {}),
      });
      setDrinkFles(null);
      flash(stukjes ? "Proefnotitie bewaard." : "Niets ingevuld, dus niets bewaard.");
      return;
    }
    if (nieuw) {
      // een fles van elders wordt een gewone wijn met nul flessen in de kelder,
      // zodat het logboek, de proefnotitie en de sommelier er alles mee kunnen
      const verse = cleanBottle({
        ...EMPTY, ...wijn, id: uid(), quantity: "0", buitenKelder: true,
        drinkLog: [entry], tasteNotes: stukjes ? `${entry.d}: ${stukjes}` : "",
        ...(jaren !== null && !isNaN(jaren) ? { herproefOp: String(NOW + jaren) } : {}),
        ...(antw?.punten ? { score: String(antw.punten) } : {}),
      });
      setBottles((prev) => [verse, ...prev]);
      setDrinkFles(null);
      flash("In het logboek gezet.");
      return;
    }
    patchBottle(b.id, {
      quantity: String(Math.max(0, (num(b.quantity) || 0) - n)),
      drinkLog: log,
      tasteNotes: nieuweNotitie,
      ...(jaren !== null && !isNaN(jaren) ? { herproefOp: String(NOW + jaren) } : {}),
      ...(gedronken && antw?.punten ? { score: String(antw.punten) } : {}),
    });
    setDrinkFles(null);
    flash(`${n} fles${n > 1 ? "sen" : ""} ${info.werkwoord} en genoteerd.`);
  };

  // ---- een regel uit het logboek terugdraaien ----
  // Wissen is hier een echte ongedaanmaking: de flessen komen terug in de kelder,
  // want de enige reden om een regel te wissen is dat ze fout stond. Een fles die
  // je elders dronk verdwijnt helemaal wanneer haar laatste regel weg is.
  const wisLogRegel = (fles, regel) => {
    const omschrijving = `${regel.d} · ${num(regel.n) || 1} fles${(num(regel.n) || 1) > 1 ? "sen" : ""} ${[fles.producer, fles.name].filter(Boolean).join(" ")}`;
    askConfirm(`${omschrijving} terugdraaien?`, () => {
      const log = (Array.isArray(fles.drinkLog) ? fles.drinkLog : []).filter((e) => e !== regel);
      if (fles.buitenKelder && !log.length) {
        removeBottle(fles.id);
        flash("Regel gewist.");
        return;
      }
      patchBottle(fles.id, {
        drinkLog: log,
        ...(fles.buitenKelder ? {} : { quantity: String((num(fles.quantity) || 0) + (num(regel.n) || 1)) }),
      });
      flash(fles.buitenKelder ? "Regel gewist." : "Regel gewist, de flessen staan terug in je kelder.");
    });
  };

  // ---- vorige versie terugzetten ----
  const doRestorePrevious = async () => {
    const vorige = await loadPrevious();
    if (!vorige || !vorige.length) { flash("Er is geen vorige versie bewaard."); return; }
    const zetTerug = () => {
      setBottles(vorige); setLoaded(true); setLoadFailed(false);
      flash(`Vorige versie teruggezet (${vorige.length} wijnen).`);
    };
    if (bottles.length) askConfirm(`Je huidige kelder (${bottles.length} wijnen) vervangen door de vorige versie (${vorige.length} wijnen)?`, zetTerug);
    else zetTerug();
  };

  // ---- backup / restore (text, works without downloads) ----
  const doRestore = (text, mode) => {
    const parsed = decodeBackup(text);
    if (!parsed) { flash("Kon deze backup niet lezen."); return; }
    const norml = parsed.map(normBottle);
    // na een mislukte start mag er weer bewaard worden zodra er goede data staat
    const hervat = () => { setLoaded(true); setLoadFailed(false); };
    if (mode === "replace") {
      const doIt = () => { persist(norml); hervat(); flash(`${norml.length} flessen hersteld (vervangen).`); setShowRestore(false); };
      if (bottles.length) askConfirm(`Je hele kelder (${bottles.length} wijnen) vervangen door deze backup (${norml.length})?`, doIt);
      else doIt();
    } else {
      const { list, added, merged } = mergeLists(bottles, norml);
      persist(list); hervat();
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
    // zonder deze twee bleef het scherm eeuwig wachten als het lezen mislukte
    rd.onerror = () => resolve(null);
    rd.onabort = () => resolve(null);
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
      // een mislukte opzoeking niet stil inslikken: anders zie je gewoon een fles
      // zonder prijs en weet je niet dat er iets misging
      .catch((e) => setPhotoJobs((prev) => prev && prev.map((j) => j.id === jobId
        ? { ...j, status: "done", error: e.message || "Info vernieuwen lukte niet." } : j)));
  // default: each selected photo is a separate wine
  const onPhotoFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    const gelezen = (await Promise.all(files.map(readImageFile))).filter(Boolean);
    if (!gelezen.length) { flash("Kon deze foto's niet lezen."); return; }
    const jobs = gelezen.map((im) => ({ id: uid(), status: "pending", images: [im], preview: im.preview, data: null, error: null }));
    setPhotoJobs(jobs);
    jobs.forEach((job) => runAnalyze(job.id, job.images));
  };
  // one wine, several photos (front + back) in a single analysis
  // add extra photo(s) to an existing job and re-analyze with all of them
  const onAddPhotoToJob = (jobId) => { setAddTarget(jobId); filePhotoAdd.current.click(); };
  const onPhotoAddFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    const jobId = addTarget; setAddTarget(null);
    if (!files.length || !jobId) return;
    const imgs = (await Promise.all(files.map(readImageFile))).filter(Boolean);
    if (!imgs.length) { flash("Kon deze foto niet lezen."); return; }
    // De volledige lijst hier al samenstellen: de updater van setPhotoJobs loopt
    // pas bij de volgende render, dus daar de foto's uit halen stuurde enkel de
    // nieuwe foto naar de analyse en gooide de voorkant weg.
    const bestaand = (photoJobs || []).find((j) => j.id === jobId);
    const all = [...((bestaand && bestaand.images) || []), ...imgs];
    setPhotoJobs((prev) => prev && prev.map((j) => (j.id !== jobId ? j
      : { ...j, images: all, preview: j.preview || imgs[0].preview, status: "pending", error: null })));
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
    setBottles((prev) => prev.map((x) => (x.id === b.id ? { ...x, ...cleanBottle(b) } : x)));
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
            {naamBewerken ? (
              <input autoFocus style={{ ...S.input, ...S.brandName, width: 190, padding: "2px 8px" }}
                defaultValue={appNaam} maxLength={28}
                onBlur={(e) => { bewaarNaam(e.target.value); setNaamBewerken(false); }}
                onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setNaamBewerken(false); }} />
            ) : (
              <span style={{ ...S.brandName, cursor: "pointer" }} onClick={() => setNaamBewerken(true)} title="Tik om de naam te wijzigen">{appNaam}</span>
            )}
            {savedAt && <span style={S.savedTag}><Check size={11} /> bewaard {savedAt.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" })}</span>}
          </div>
          <div style={S.actions}>
            <button style={S.btnPrimary} onClick={() => filePhoto.current.click()}><Camera size={15} /> Foto</button>
            <button style={S.btnPrimary} onClick={() => setEdit({ ...EMPTY })}><Plus size={15} /> Fles</button>
            <div style={{ position: "relative" }}>
              <button style={S.btnGhost} onClick={() => setMenuOpen((o) => !o)} aria-label="Meer"><MoreHorizontal size={16} /></button>
              {menuOpen && (
                <>
                  <div style={S.menuBackdrop} onPointerDown={() => setMenuOpen(false)} onClick={() => setMenuOpen(false)} />
                  <div style={S.menu}>
                    <button className="mi" style={S.menuItem} onClick={() => { setMenuOpen(false); setShowBackup(true); }}><Save size={15} /> Backup (kopieer)</button>
                    <button className="mi" style={S.menuItem} onClick={() => { setMenuOpen(false); setShowRestore(true); }}><Clipboard size={15} /> Herstel (plak)</button>
                    <button className="mi" style={S.menuItem} onClick={() => { setMenuOpen(false); doRestorePrevious(); }} disabled={!hasPrev}>
                      <ArrowUpDown size={15} /> Vorige versie terugzetten
                    </button>
                    <div style={S.menuSep} />
                    <button className="mi" style={S.menuItem} onClick={() => { setMenuOpen(false); fileImport.current.click(); }}><Upload size={15} /> Excel importeren</button>
                    <button className="mi" style={S.menuItem} onClick={() => { setMenuOpen(false); exportXlsx(kelder); }}><Download size={15} /> Excel exporteren</button>
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

        {/* Toevoegen staat rechtsboven, verkennen op een eigen rij: zo blijft het op
            een telefoon leesbaar en staat wat bij elkaar hoort ook bij elkaar. */}
        <div style={S.verkenRij}>
          <button style={S.verkenKnop} onClick={() => setShowSomm(true)}><MessageCircle size={15} /> Sommelier</button>
          <button style={S.verkenKnop} onClick={() => setShowLog(true)} title="Wat ik gedronken heb"><BookOpen size={15} /> Logboek</button>
          <button style={S.verkenKnop} onClick={() => setShowKaart(true)} title="Mijn wijnen op de kaart"><Globe size={15} /> Kaart</button>
        </div>

        {/* Vier gelijke vakjes op een raster; de knop om bedragen te verbergen
            staat er los boven, zodat hij geen opschrift meer opzij duwt. */}
        <div style={S.ledgerKop}>
          <span style={S.ledgerTitel}>{stats.flessen} flessen · {stats.wijnen} wijnen</span>
          <button style={S.geldKnop} onClick={wisselGeld} aria-label={toonGeld ? "Bedragen verbergen" : "Bedragen tonen"}>
            {toonGeld ? <EyeOff size={14} /> : <Eye size={14} />} {toonGeld ? "verbergen" : "waarde"}
          </button>
        </div>
        {toonGeld && (
          <div style={S.ledger}>
            <Stat label="Aankoop" value={eur(stats.cost)} />
            <Stat label="Kelderwaarde" value={eur(stats.value)} accent="gold" />
            <Stat
              breed
              label="Ongerealiseerd"
              value={stats.vgFlessen ? `${stats.gain >= 0 ? "+" : ""}${eur(stats.gain)}` : "—"}
              sub={stats.vgFlessen
                ? `${stats.gain >= 0 ? "+" : ""}${stats.pct.toFixed(1)}%${stats.volledig ? "" : ` · op ${stats.vgFlessen} van ${stats.flessen}`}`
                : "nog geen fles met aankoop én waarde"}
              accent={!stats.vgFlessen ? undefined : stats.gain >= 0 ? "green" : "red"} />
          </div>
        )}
      </header>

      {/* ---- toolbar ---- */}
      <div style={S.toolbar}>
        <div style={{ ...S.searchWrap, flex: "1 1 100%" }}>
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
        <select style={S.select} value={fTodo} onChange={(e) => setFTodo(e.target.value)}>
          <option value="">Alles</option>
          <option value="geenAankoop">Aankoop ontbreekt</option>
          <option value="geenWaarde">Waarde ontbreekt</option>
          <option value="nietOpgezocht">Nog niet opgezocht</option>
          <option value="geenNotitie">Geen proefnotitie</option>
          <option value="herproef">Klaar om te herproeven</option>
        </select>
        <select style={S.select} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="producer">Sorteer: naam</option>
          <option value="value">Sorteer: waarde</option>
          <option value="vintage">Sorteer: jaargang</option>
          <option value="drinkTo">Sorteer: drink tot</option>
        </select>
      </div>

      {/* ---- list ---- */}
      {loadFailed ? (
        <div style={{ ...S.emptyBig, gap: 14 }}>
          <AlertCircle size={40} strokeWidth={1} style={{ color: "var(--red)" }} />
          <h2 style={S.emptyTitle}>Je kelder kon niet gelezen worden</h2>
          <p style={{ ...S.emptyText, maxWidth: 460 }}>
            De opgeslagen gegevens zijn onleesbaar. Er is <strong style={{ color: "var(--ink)" }}>niets gewist</strong>:
            de app bewaart voorlopig niets, zodat je kelder niet overschreven wordt.
            Zet hieronder de vorige versie terug, of plak een backup.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", marginTop: 6 }}>
            <button style={S.btnPrimary} onClick={doRestorePrevious} disabled={!hasPrev}>
              <ArrowUpDown size={15} /> Vorige versie terugzetten
            </button>
            <button style={S.btnGhost} onClick={() => setShowRestore(true)}><Clipboard size={15} /> Herstel (plak backup)</button>
          </div>
          {!hasPrev && <p style={{ ...S.emptyText, fontSize: 13 }}>Er is geen vorige versie bewaard; gebruik je backup-tekst.</p>}
        </div>
      ) : !loaded ? (
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
      <input ref={filePhotoAdd} type="file" accept="image/*" multiple hidden onChange={onPhotoAddFiles} />

      {/* ---- modals ---- */}
      {detail && <DetailModal b={detail} scale={scale} onClose={() => setDetail(null)}
        onEdit={() => { setEdit(detail); setDetail(null); }}
        onEnrich={() => enrichDetail(detail)} onSave={updateBottle}
        onPatch={(patch) => patchBottle(detail.id, patch)}
        onProeven={() => setDrinkFles({ ...detail, _proeven: true })}
        onGedronken={() => setDrinkFles(detail)} />}
      {drinkFles && <DrinkModal b={drinkFles} nieuw={!!drinkFles._nieuw} alleenProeven={!!drinkFles._proeven}
        onBevestig={boekGedronken} onClose={() => setDrinkFles(null)} />}
      {showKaart && <KaartModal bottles={kelder} onKies={(b) => setDetail(b)} onClose={() => setShowKaart(false)} />}
      {showLog && <LogboekModal bottles={bottles} onKies={(b) => setDetail(b)} onWis={wisLogRegel}
        onElders={() => { setShowLog(false); setDrinkFles({ ...EMPTY, id: uid(), quantity: "1", _nieuw: true }); }}
        onClose={() => setShowLog(false)} />}
      {edit && <EditModal edit={edit} setEdit={setEdit} onSave={saveEdit}
        onMultiVintage={(e) => { setBulkInit({ producer: e.producer, name: e.name, region: e.region, country: e.country, color: e.color, grape: e.grape, location: e.location, supplier: e.supplier }); setEdit(null); setShowBulk(true); }} />}
      {importPending && <ImportModal rows={importPending} onApply={applyImport} onCancel={() => setImportPending(null)} />}
      {photoJobs && <PhotoModal jobs={photoJobs} setJobs={setPhotoJobs} onAdd={addPhotoResult} onAddPhoto={onAddPhotoToJob} onLookup={runJobLookup}
        onMultiVintage={(d) => {
          setBulkInit({ producer: d.producer, name: d.name, region: d.region, country: d.country, color: d.color, grape: d.grape, location: d.location, supplier: d.supplier });
          setPhotoJobs(null); setShowBulk(true);
        }}
        onClose={() => setPhotoJobs(null)} />}
      {dupPrompt && <DupModal dp={dupPrompt} onResolve={resolveDup} />}
      {showBulk && <BulkModal initial={bulkInit} onAdd={addBulk} onClose={() => setShowBulk(false)} />}
      {showSomm && <SommelierModal bottles={kelder} alles={bottles} thread={sommThread} setThread={setSommThread} onClose={() => setShowSomm(false)} />}
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
function Stat({ label, value, sub, accent, breed }) {
  const col = accent === "gold" ? "var(--gold)" : accent === "green" ? "var(--green)" : accent === "red" ? "var(--red)" : "var(--ink)";
  return (
    <div style={{ ...S.stat, ...(breed ? { gridColumn: "1 / -1" } : null) }}>
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
  // wijn bovenaan in het vet, producent eronder
  const sub = [b.producer, b.region].filter(Boolean).join(" · ");
  return (
    <div style={S.row} onClick={onOpen} className="row">
      <div style={{ ...S.colorDot, background: dot, alignSelf: "flex-start", marginTop: sc(6) }} title={b.color} />
      <div style={S.rowMain}>
        <div style={S.rowLine}>
          <span style={{ ...S.producer, fontSize: sc(15), flex: 1, minWidth: 0 }}>{b.name || b.producer || "—"}</span>
          <span style={S.rowLineRight}>
            {b.vintage && <span style={{ ...S.vintage, fontSize: sc(14) }}>{b.vintage}</span>}
            {formaatKort(b.volumeMl) && <span style={{ ...S.qtyPill, fontSize: sc(11), color: "var(--gold)" }}>{formaatKort(b.volumeMl)}</span>}
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
        <div style={{ ...S.loc, fontSize: sc(11), marginTop: sc(4), display: "flex", gap: 10, flexWrap: "wrap" }}>
          {b.location && <span>📍 {b.location}</span>}
          {money(b.purchasePrice) > 0
            ? <span>aankoop {eur(money(b.purchasePrice))}</span>
            : <span style={{ color: "var(--amber)" }}>aankoop niet ingevuld</span>}
        </div>
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
function BottleFields({ v, on, boven }) {
  const fld = (k, label, type = "text", w) => (
    <label key={k} style={{ ...S.field, flex: w || 1 }}>
      <span style={S.fieldLabel}>{label}</span>
      <input style={S.input} type={type} value={v[k] ?? ""} onChange={(e) => on(k, e.target.value)} inputMode={type === "number" ? "decimal" : undefined} />
    </label>
  );
  return (
    <div style={S.form}>
      <div style={S.formRow}>{fld("producer", "Producent")}{fld("name", "Wijn / cuvée")}</div>
      {boven}
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
      <label style={S.field}>
        <span style={S.fieldLabel}>Formaat</span>
        <select style={S.input} value={num(v.volumeMl) || 750} onChange={(e) => on("volumeMl", parseInt(e.target.value))}>
          {FORMATEN.map((f) => <option key={f.ml} value={f.ml}>{f.label}</option>)}
        </select>
      </label>
      <div style={S.formRow}>{fld("grape", "Druif")}{fld("score", "Score", "number", 0.5)}</div>
      <div style={S.formRow}>{fld("region", "Streek")}{fld("country", "Land")}</div>
      <div style={S.formRow}>{fld("location", "Locatie in kelder")}{fld("supplier", "Leverancier")}</div>
      <div style={S.formRow}>{fld("purchasePrice", "Aankoop €/fles", "number")}{fld("retailValue", "Retail €/fles, incl. btw", "number")}</div>
      <label style={S.field}>
        <span style={S.fieldLabel}>Mijn waarde €/fles</span>
        <input style={S.input} type="number" inputMode="decimal" value={v.ownValue ?? ""} onChange={(e) => on("ownValue", e.target.value)}
          placeholder={money(v.retailValue) > 0 ? `leeg = retail (${eur(money(v.retailValue))})` : "leeg = retail"} />
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
  const [kiezen, setKiezen] = useState(false);
  return (
    <Overlay onClose={() => setEdit(null)}>
      <div style={S.modalHead}>
        <h3 style={S.modalTitle}>{edit.id ? "Fles bewerken" : "Nieuwe fles"}</h3>
        <button style={S.iconBtn} onClick={() => setEdit(null)}><X size={18} /></button>
      </div>
      {kiezen && (
        <KiesWijnModal start={wineTerm(edit)}
          onKies={(w) => {
            setEdit({ ...edit, ...wisWijnGegevens(w) });
            setKiezen(false);
          }}
          onClose={() => setKiezen(false)} />
      )}
      <button style={{ ...S.btnGhost, width: "100%", marginBottom: 10 }}
        onClick={() => setKiezen(true)} disabled={!canMulti}>
        <Search size={15} /> Zoek de juiste wijn op
      </button>
      <BottleFields v={edit} on={set} boven={onMultiVintage && (
        <button style={{ ...S.btnGhost, width: "100%", justifyContent: "center" }}
          onClick={() => onMultiVintage(edit)} disabled={!canMulti}>
          <Layers size={15} /> Meerdere jaargangen van deze wijn
        </button>
      )} />
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
function PhotoModal({ jobs, setJobs, onAdd, onAddPhoto, onLookup, onMultiVintage, onClose }) {
  const [kiesVoor, setKiesVoor] = useState(null);
  const setData = (id, k, v) => setJobs((prev) => prev.map((j) => j.id === id ? { ...j, data: { ...j.data, ...fieldPatch(k, v) } } : j));

  // De gekozen wijn overschrijft wat de etiketlezing ervan maakte, en daarna
  // halen we prijs, drinkvenster en recensies op VOOR DIE wijn.
  const neemKeuze = async (jobId, w) => {
    setKiesVoor(null);
    let draft = null;
    setJobs((prev) => prev.map((j) => {
      if (j.id !== jobId) return j;
      draft = { ...(j.data || {}), ...wisWijnGegevens(w) };
      return { ...j, status: "enriching", error: null, data: draft };
    }));
    if (draft && onLookup) {
      try { await onLookup(jobId, draft); }
      catch (e) { setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, error: e.message } : j)); }
    }
  };


  return (
    <Overlay onClose={onClose} wide>
      {kiesVoor && (() => {
        const job = jobs.find((j) => j.id === kiesVoor);
        return (
          <KiesWijnModal start={job && job.data ? wineTerm(job.data) : ""}
            onKies={(w) => neemKeuze(kiesVoor, w)} onClose={() => setKiesVoor(null)} />
        );
      })()}
      <div style={S.modalHead}>
        <h3 style={S.modalTitle}>Foto-analyse</h3>
        <button style={S.iconBtn} onClick={onClose}><X size={18} /></button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxHeight: "calc(var(--vvh, 100vh) - 190px)", overflowY: "auto" }}>
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
                {!busy(job) && onMultiVintage && (job.data?.producer || job.data?.name) && (
                  <button style={{ ...S.btnGhost, marginTop: 8 }} onClick={() => onMultiVintage(job.data)}>
                    <Layers size={15} /> Meerdere jaargangen van deze wijn
                  </button>
                )}
                {!busy(job) && (
                  <button style={{ ...S.btnGhost, marginTop: 8, width: "100%" }} onClick={() => setKiesVoor(job.id)}>
                    <Search size={15} /> Niet juist? Kies de wijn zelf
                  </button>
                )}
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
function useZichtbareHoogte() {
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv || typeof document === "undefined") return;
    const zet = () => {
      const el = document.documentElement;
      el.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
      el.style.setProperty("--vvtop", `${Math.round(vv.offsetTop)}px`);
    };
    zet();
    vv.addEventListener("resize", zet);
    vv.addEventListener("scroll", zet);
    return () => { vv.removeEventListener("resize", zet); vv.removeEventListener("scroll", zet); };
  }, []);
}

function Overlay({ children, onClose, small, wide, full }) {
  const box = full
    ? { ...S.modal, ...S.modalFull }
    : { ...S.modal, maxWidth: small ? 440 : wide ? 720 : 620 };
  const buiten = (e) => { if (e.target === e.currentTarget) onClose(); };
  return (
    <div
      style={{
        ...S.overlay,
        paddingTop: `calc(env(safe-area-inset-top) + ${full ? 8 : 16}px)`,
        paddingBottom: `calc(env(safe-area-inset-bottom) + ${full ? 8 : 16}px)`,
        paddingLeft: full ? 8 : 16, paddingRight: full ? 8 : 16,
      }}
      onPointerDown={buiten} onClick={buiten}>
      <div className="modalcard" style={box}>
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
  const leegRij = () => ({ vintage: "", quantity: "1", volumeMl: 750, purchasePrice: "", supplier: "" });
  const [rows, setRows] = useState([leegRij(), leegRij(), leegRij()]);
  const [busy, setBusy] = useState(false);
  const [metOpzoeken, setMetOpzoeken] = useState(true);
  const set = (k, v) => setShared({ ...shared, [k]: v });
  const setRow = (i, k, v) => setRows(rows.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const addRow = () => setRows([...rows, leegRij()]);
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
        De prijs, het drinkvenster en de recensies worden per jaargang apart opgezocht.
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
          <div key={i} style={S.bulkRij}>
            <div style={S.bulkKop}>
              <span>Jaargang {i + 1}</span>
              <button style={S.iconBtn} onClick={() => rmRow(i)} disabled={rows.length <= 1}><Trash2 size={15} /></button>
            </div>
            {/* elk veld houdt zijn eigen opschrift: zo kan er niets over elkaar
                vallen, hoe smal het scherm ook is */}
            <div style={S.bulkVelden}>
              <label style={{ ...S.field, flex: "1 1 96px", minWidth: 0 }}>
                <span style={S.fieldLabel}>Jaargang</span>
                <input style={S.input} placeholder="bv. 2018" value={r.vintage}
                  onChange={(e) => setRow(i, "vintage", e.target.value)} inputMode="numeric" />
              </label>
              <label style={{ ...S.field, flex: "1 1 120px", minWidth: 0 }}>
                <span style={S.fieldLabel}>Formaat</span>
                <select style={S.input} value={num(r.volumeMl) || 750} onChange={(e) => setRow(i, "volumeMl", parseInt(e.target.value))}>
                  {FORMATEN.map((f) => <option key={f.ml} value={f.ml}>{f.label}</option>)}
                </select>
              </label>
              <div style={{ ...S.field, flex: "0 0 auto" }}>
                <span style={S.fieldLabel}>Aantal</span>
                <QtyStepper value={r.quantity} onChange={(v) => setRow(i, "quantity", v)} />
              </div>
              <label style={{ ...S.field, flex: "1 1 110px", minWidth: 0 }}>
                <span style={S.fieldLabel}>Aankoop €</span>
                <input style={S.input} type="number" inputMode="decimal" value={r.purchasePrice}
                  placeholder={i > 0 ? (rows[0].purchasePrice || "") : ""}
                  onChange={(e) => setRow(i, "purchasePrice", e.target.value)} />
              </label>
              <label style={{ ...S.field, flex: "2 1 150px", minWidth: 0 }}>
                <span style={S.fieldLabel}>Waar gekocht</span>
                <input style={S.input} value={r.supplier}
                  placeholder={i > 0 ? (rows[0].supplier || shared.supplier || "zelfde als hierboven") : (shared.supplier || "leverancier")}
                  onChange={(e) => setRow(i, "supplier", e.target.value)} />
              </label>
            </div>
          </div>
        ))}
        <button style={{ ...S.btnGhost, alignSelf: "flex-start" }} onClick={addRow}><Plus size={15} /> Jaargang toevoegen</button>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 14, cursor: "pointer", fontSize: 14, color: "var(--ink2)" }}>
        <input type="checkbox" checked={metOpzoeken} onChange={(e) => setMetOpzoeken(e.target.checked)}
          style={{ width: 18, height: 18, accentColor: "var(--wine-bright)" }} />
        <span>Meteen prijs, drinkvenster en recensies opzoeken per jaargang
          {filled.length ? <span style={{ color: "var(--ink-dim)" }}> — ongeveer {filled.length} cent</span> : null}
        </span>
      </label>
      <div style={S.modalFoot}>
        <button style={S.btnGhost} onClick={onClose}>Annuleren</button>
        <button style={S.btnPrimary} onClick={() => onAdd(shared, filled, metOpzoeken)} disabled={!filled.length || (!shared.producer && !shared.name)}>
          <Check size={15} /> {filled.length ? `${filled.length} jaargang${filled.length > 1 ? "en" : ""} · ${total} fles${total === 1 ? "" : "sen"} toevoegen` : "Vul eerst een jaargang in"}
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
function SommelierModal({ bottles, alles, thread, setThread, onClose }) {
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
      const a = await askSommelier({ bottles, alles, question, history: thread });
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

// ---------- fles uit de kelder ----------
function KeuzeChips({ waarden, gekozen, onWissel }) {
  return (
    <div style={S.chipKeuzeRij}>
      {waarden.map((w) => {
        const aan = gekozen.includes(w);
        return (
          <button key={w} type="button" onClick={() => onWissel(w)}
            style={{ ...S.chipKeuze, ...(aan ? S.chipKeuzeAan : null) }}>
            {aan ? "✓ " : ""}{w}
          </button>
        );
      })}
    </div>
  );
}

// alleenProeven = het draaiboek zonder een fles af te boeken: je noteert wat je
// proefde, de kelder blijft ongemoeid.
function DrinkModal({ b, nieuw, alleenProeven, onBevestig, onClose }) {
  const maxAantal = nieuw ? 12 : Math.max(1, num(b.quantity) || 1);
  const vandaag = new Date().toISOString().slice(0, 10);
  const [reden, setReden] = useState("gedronken");
  const [aantal, setAantal] = useState(1);
  const [datum, setDatum] = useState(vandaag);
  const [opbrengst, setOpbrengst] = useState("");
  const [herproef, setHerproef] = useState("");
  const [antw, setAntw] = useState({});
  // enkel bij een fles van elders: die staat nog niet in de kelder
  const [wijn, setWijn] = useState({ producer: b.producer || "", name: b.name || "", vintage: b.vintage || "", color: b.color || "rood" });
  const [kostte, setKostte] = useState("");
  const setW = (k, v) => setWijn((w) => ({ ...w, [k]: v }));
  const set = (k, v) => setAntw((a) => ({ ...a, [k]: v }));
  const wissel = (k, w) => setAntw((a) => {
    const lijst = Array.isArray(a[k]) ? a[k] : [];
    return { ...a, [k]: lijst.includes(w) ? lijst.filter((x) => x !== w) : [...lijst, w] };
  });
  const waarde = nieuw ? money(kostte) : effVal(b).v;
  const gedronken = nieuw || alleenProeven || reden === "gedronken";
  const redenInfo = WEG_REDENEN.find((r) => r.k === reden) || WEG_REDENEN[0];

  return (
    <Overlay onClose={onClose} full>
      <div style={S.modalHead}>
        <div style={{ minWidth: 0 }}>
          <h3 style={S.modalTitle}>{nieuw ? "Elders gedronken" : alleenProeven ? "Proefnotitie" : "Fles uit de kelder"}</h3>
          <div style={{ ...S.rowSub, marginTop: 3 }}>
            {nieuw
              ? "Een fles die niet in je kelder lag — op restaurant, bij vrienden, op een proeverij."
              : [b.producer, b.name, b.vintage].filter(Boolean).join(" · ")}
          </div>
        </div>
        <button style={S.iconBtn} onClick={onClose}><X size={18} /></button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", ...S.form }}>
        {alleenProeven ? null : nieuw ? (
          <>
            <div style={S.formRow}>
              <label style={{ ...S.field, flex: 1 }}>
                <span style={S.fieldLabel}>Producent</span>
                <input style={S.input} value={wijn.producer} onChange={(e) => setW("producer", e.target.value)} />
              </label>
              <label style={{ ...S.field, flex: 1 }}>
                <span style={S.fieldLabel}>Wijn / cuvée</span>
                <input style={S.input} value={wijn.name} onChange={(e) => setW("name", e.target.value)} />
              </label>
            </div>
            <div style={S.formRow}>
              <label style={{ ...S.field, flex: "0 0 100px" }}>
                <span style={S.fieldLabel}>Jaargang</span>
                <input style={S.input} inputMode="numeric" value={wijn.vintage} onChange={(e) => setW("vintage", e.target.value)} />
              </label>
              <label style={{ ...S.field, flex: 1 }}>
                <span style={S.fieldLabel}>Kleur</span>
                <select style={S.input} value={wijn.color} onChange={(e) => setW("color", e.target.value)}>
                  {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label style={{ ...S.field, flex: "1 1 120px" }}>
                <span style={S.fieldLabel}>Wat kostte hij €</span>
                <input style={S.input} type="number" inputMode="decimal" value={kostte}
                  placeholder="per fles" onChange={(e) => setKostte(e.target.value)} />
              </label>
            </div>
          </>
        ) : (
          <div style={S.field}>
            <span style={S.fieldLabel}>Wat is ermee gebeurd</span>
            <KeuzeChips waarden={WEG_REDENEN.map((r) => r.label)} gekozen={[redenInfo.label]}
              onWissel={(l) => setReden((WEG_REDENEN.find((r) => r.label === l) || WEG_REDENEN[0]).k)} />
          </div>
        )}

        <div style={S.formRow}>
          <div style={{ ...S.field, flex: "0 0 auto", display: alleenProeven ? "none" : undefined }}>
            <span style={S.fieldLabel}>Hoeveel flessen</span>
            <QtyStepper value={aantal} onChange={(v) => setAantal(Math.min(maxAantal, Math.max(1, parseInt(v) || 1)))} big />
          </div>
          <label style={{ ...S.field, flex: "1 1 150px" }}>
            <span style={S.fieldLabel}>Wanneer</span>
            <input style={S.input} type="date" value={datum} onChange={(e) => setDatum(e.target.value)} />
          </label>
          {!nieuw && reden === "verkocht" && (
            <label style={{ ...S.field, flex: "1 1 130px" }}>
              <span style={S.fieldLabel}>Opbrengst per fles €</span>
              <input style={S.input} type="number" inputMode="decimal" value={opbrengst}
                placeholder={waarde > 0 ? String(Math.round(waarde)) : ""} onChange={(e) => setOpbrengst(e.target.value)} />
            </label>
          )}
        </div>
        <div style={{ ...S.mapCaption, marginTop: -4, display: alleenProeven ? "none" : undefined }}>
          {nieuw
            ? (waarde > 0 ? `Samen ${eur(waarde * aantal)} · telt mee in wat je gedronken hebt` : "Telt mee in wat je gedronken hebt")
            : `Er blijven er ${Math.max(0, maxAantal - aantal)} over${waarde > 0 ? ` · samen ${eur(waarde * aantal)}` : ""}${!gedronken ? " · telt niet mee in wat je gedronken hebt" : ""}`}
        </div>

        {gedronken && DRINK_VRAGEN.map((v) => (
          <div key={v.k} style={S.field}>
            <span style={S.fieldLabel}>{v.label}</span>
            {v.chips ? (
              <KeuzeChips waarden={v.chips} gekozen={Array.isArray(antw[v.k]) ? antw[v.k] : []}
                onWissel={(w) => wissel(v.k, w)} />
            ) : v.keuzes ? (
              <select style={S.input} value={antw[v.k] || ""} onChange={(e) => set(v.k, e.target.value)}>
                {v.keuzes.map((k) => <option key={k} value={k}>{k || "—"}</option>)}
              </select>
            ) : v.groot ? (
              <textarea style={{ ...S.input, minHeight: 92, resize: "vertical", lineHeight: 1.5 }} rows={3}
                placeholder={v.hint} value={antw[v.k] || ""} onChange={(e) => set(v.k, e.target.value)} />
            ) : (
              <input style={S.input} type={v.getal ? "number" : "text"} inputMode={v.getal ? "decimal" : undefined}
                placeholder={v.hint} value={antw[v.k] || ""} onChange={(e) => set(v.k, e.target.value)} />
            )}
          </div>
        ))}

        {gedronken && (
          <label style={S.field}>
            <span style={S.fieldLabel}>En nu? Wanneer opnieuw proeven</span>
            <select style={S.input} value={herproef} onChange={(e) => setHerproef(e.target.value)}>
              <option value="">niet van toepassing</option>
              <optgroup label="Mijn oordeel nu">
                {RIJPHEID.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}
              </optgroup>
              <optgroup label="Opnieuw proeven over">
                {[1, 2, 3, 5, 10].map((j) => <option key={j} value={`j${j}`}>{j} jaar ({NOW + j})</option>)}
              </optgroup>
            </select>
          </label>
        )}
      </div>

      <div style={S.modalFoot}>
        <button style={S.btnGhost} onClick={onClose}>Annuleren</button>
        <button style={S.btnPrimary}
          disabled={nieuw && !wijn.producer && !wijn.name}
          onClick={() => onBevestig({ reden: nieuw ? "gedronken" : reden, aantal, datum, herproef, opbrengst, antw, wijn, kostte, nieuw, alleenProeven })}>
          <Check size={15} /> {alleenProeven
            ? "Proefnotitie bewaren"
            : `${aantal} fles${aantal > 1 ? "sen" : ""} ${nieuw ? "in het logboek" : redenInfo.werkwoord}`}
        </button>
      </div>
    </Overlay>
  );
}


// ---------- de juiste wijn kiezen ----------
// Bij "Vini Franchetti Contrada G" vindt de catalogus niets, en bij "Chambertin"
// vindt ze er vijf. Beide keren kan de app het niet zelf weten. Daarom tonen we
// wat er gevonden werd en kies JIJ. Wat je kiest, is daarna zeker juist.
async function zoekWijnen(term) {
  const q = String(term || "").trim();
  if (!q) return [];
  const res = await fetchSearch({ wine: { term: q }, max: 1 });
  const gezien = new Set();
  const uit = [];
  for (const o of (res.offers || [])) {
    if (!o.producer && !o.name) continue;
    const sleutel = `${norm(o.producer)}|${norm(o.name)}`;
    if (gezien.has(sleutel)) continue;
    gezien.add(sleutel);
    uit.push({
      producer: o.producer || "", name: o.name || "",
      region: o.region || "", country: o.country || "",
      image: o.image || "", jaargangen: [],
    });
  }
  // per wijn bijhouden welke jaargangen er te zien waren; dat helpt herkennen
  for (const o of (res.offers || [])) {
    const w = uit.find((x) => norm(x.producer) === norm(o.producer) && norm(x.name) === norm(o.name));
    if (w && o.vintage && !w.jaargangen.includes(String(o.vintage))) w.jaargangen.push(String(o.vintage));
  }
  return uit.slice(0, 12);
}

// Alles wat over DE WIJN gaat en dus bij de vorige, foute keuze hoorde. Wat van
// de gebruiker zelf komt (aantal, aankoopprijs, proefnotities, locatie) blijft.
function wisWijnGegevens(w) {
  return {
    producer: w.producer || "", name: w.name || "",
    region: w.region || "", country: w.country || "",
    imageUrl: w.image || "",
    grape: "", description: "", reviews: "", score: "",
    retailValue: "", priceNote: "", priceUrl: "", priceManual: false,
    drinkFrom: "", drinkTo: "",
    lat: "", lng: "", placeName: "",
    verifyNote: "", enriched: false,
  };
}

function KiesWijnModal({ start, onKies, onClose }) {
  const [term, setTerm] = useState(String(start || "").trim());
  const [bezig, setBezig] = useState(false);
  const [lijst, setLijst] = useState(null);
  const [fout, setFout] = useState("");

  const zoek = async (t) => {
    const q = String(t ?? term).trim();
    if (!q || bezig) return;
    setBezig(true); setFout(""); setLijst(null);
    try {
      setLijst(await zoekWijnen(q));
    } catch (e) {
      setFout(e.message || "Zoeken lukte niet.");
    } finally { setBezig(false); }
  };

  // meteen zoeken met wat er al bij de fles staat
  useEffect(() => { if (String(start || "").trim()) zoek(String(start).trim()); }, []);

  return (
    <Overlay onClose={onClose} full>
      <div style={S.modalHead}>
        <div style={{ minWidth: 0 }}>
          <h3 style={S.modalTitle}>Welke wijn is het?</h3>
          <div style={{ ...S.rowSub, marginTop: 3 }}>Kies de juiste; prijs, foto en recensies volgen die keuze.</div>
        </div>
        <button style={S.iconBtn} onClick={onClose}><X size={18} /></button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input style={{ ...S.input, flex: 1 }} value={term} autoFocus
          placeholder="bv. Passopisciaro Contrada Guardiola"
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") zoek(); }} />
        <button style={S.btnPrimary} onClick={() => zoek()} disabled={bezig || !term.trim()}>
          {bezig ? <Loader2 className="spin" size={15} /> : <Search size={15} />} Zoek
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {bezig && <div style={{ ...S.mapPlaceholder, fontSize: 14 }}><Loader2 className="spin" size={16} /> Zoeken…</div>}
        {fout && <div style={{ ...S.jobError, fontSize: 14 }}><AlertCircle size={15} /> {fout}</div>}
        {!bezig && lijst && !lijst.length && (
          <div style={{ ...S.mapPlaceholder, fontSize: 14, display: "block", lineHeight: 1.5 }}>
            Niets gevonden voor "{term}". Probeer de naam van het domein zoals hij op de voorkant staat,
            zonder de vermelding van de bottelaar. Bij een Etna-wijn van Franchetti werkt bijvoorbeeld
            "Passopisciaro Contrada Guardiola" wel, en "Vini Franchetti" niet.
          </div>
        )}
        {!bezig && lijst && lijst.map((w, i) => (
          <button key={i} className="mi" style={S.kiesRij} onClick={() => onKies(w)}>
            {w.image
              ? <img src={w.image} alt="" style={S.kiesFoto} onError={(e) => { e.target.style.visibility = "hidden"; }} />
              : <div style={S.kiesFoto} />}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ color: "var(--ink)", fontSize: 15, fontWeight: 600 }}>{w.name || "(zonder naam)"}</div>
              <div style={{ ...S.rowSub, marginTop: 2 }}>{w.producer}</div>
              <div style={{ ...S.rowSub, marginTop: 2, color: "var(--ink-dim)" }}>
                {[w.region, w.country].filter(Boolean).join(", ")}
                {w.jaargangen.length ? ` · jaargangen ${w.jaargangen.sort().join(", ")}` : ""}
              </div>
            </div>
          </button>
        ))}
      </div>
    </Overlay>
  );
}

// ---------- logboek over alle wijnen heen ----------
// Alle regels uit alle flessen, nieuw naar oud, met de tellingen die de app zelf
// maakt. Wie een fles aantikt, springt naar de detailkaart.
function logRegels(bottles) {
  const rijen = [];
  for (const b of bottles || []) {
    for (const e of (Array.isArray(b.drinkLog) ? b.drinkLog : [])) rijen.push({ ...e, b, bron: e });
  }
  rijen.sort((x, y) => String(y.d).localeCompare(String(x.d)));
  return rijen;
}

const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const maandKop = (d) => {
  const m = parseInt(String(d).slice(5, 7));
  return `${MAANDEN[m - 1] || ""} ${String(d).slice(0, 4)}`;
};

function LogboekModal({ bottles, onKies, onElders, onWis, onClose }) {
  const [soort, setSoort] = useState("gedronken");
  const alle = useMemo(() => logRegels(bottles), [bottles]);
  const rijen = alle.filter((e) => (soort === "alles" ? true : soort === "gedronken"
    ? (e.type || "gedronken") === "gedronken"
    : (e.type || "gedronken") !== "gedronken"));
  const nu = new Date().toISOString().slice(0, 10);
  const gedr = alle.filter((e) => (e.type || "gedronken") === "gedronken");
  const tel = (vanaf) => {
    const r = gedr.filter((x) => String(x.d) >= vanaf);
    return { n: r.reduce((t, x) => t + (num(x.n) || 1), 0), v: r.reduce((t, x) => t + (num(x.v) || 0) * (num(x.n) || 1), 0) };
  };
  const maand = tel(nu.slice(0, 8) + "01"), jaar = tel(nu.slice(0, 4) + "-01-01"), ooit = tel("0000");

  let vorigeKop = "";
  return (
    <Overlay onClose={onClose} full>
      <div style={S.modalHead}>
        <div style={{ minWidth: 0 }}>
          <h3 style={S.modalTitle}>Drinklogboek</h3>
          <div style={{ ...S.rowSub, marginTop: 3 }}>Alles wat je noteerde, nieuw naar oud</div>
        </div>
        <button style={S.iconBtn} onClick={onClose}><X size={18} /></button>
      </div>

      <div style={S.logTellers}>
        <ValCell label="Deze maand" sc={(x) => x} value={`${maand.n}×`} sub={maand.v > 0 ? eur(maand.v) : ""} />
        <ValCell label="Dit jaar" sc={(x) => x} value={`${jaar.n}×`} sub={jaar.v > 0 ? eur(jaar.v) : ""} />
        <ValCell label="In totaal" sc={(x) => x} value={`${ooit.n}×`} sub={ooit.v > 0 ? eur(ooit.v) : ""} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
        <KeuzeChips waarden={["gedronken", "weg uit de kelder", "alles"]}
          gekozen={[soort === "weg" ? "weg uit de kelder" : soort]}
          onWissel={(w) => setSoort(w === "weg uit de kelder" ? "weg" : w)} />
        <button style={{ ...S.btnGhost, marginLeft: "auto" }} onClick={onElders}>
          <Plus size={15} /> Elders gedronken
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {!rijen.length && (
          <div style={{ ...S.mapPlaceholder, fontSize: 14 }}>
            Nog niets genoteerd. Vink een fles af met "Fles weg", of noteer er een die je elders dronk.
          </div>
        )}
        {rijen.map((e, i) => {
          const kop = maandKop(e.d);
          const nieuweKop = kop !== vorigeKop;
          vorigeKop = kop;
          const zin = drinkZin(e);
          return (
            <div key={i}>
              {nieuweKop && <div style={{ ...S.sectionLabel, marginTop: i ? 18 : 0 }}>{kop}</div>}
              <div style={S.logRij}>
                <button className="mi" style={S.logKnop} onClick={() => { onKies(e.b); onClose(); }}>
                  <div style={{ color: "var(--ink)", fontSize: 15 }}>
                    {(num(e.n) || 1)}× {[e.b.producer, e.b.name].filter(Boolean).join(" · ") || "wijn"}
                    {e.b.vintage ? ` ${e.b.vintage}` : ""}
                  </div>
                  <div style={{ ...S.rowSub, marginTop: 2 }}>
                    {e.d}
                    {(e.type || "gedronken") !== "gedronken" ? ` · ${logSoort(e)}` : ""}
                    {e.b.buitenKelder ? " · elders" : ""}
                    {num(e.v) > 0 ? ` · ${eur(num(e.v) * (num(e.n) || 1))}` : ""}
                    {num(e.opbrengst) > 0 ? ` · opbrengst ${eur(num(e.opbrengst) * (num(e.n) || 1))}` : ""}
                  </div>
                  {zin && <div style={{ ...S.rowSub, marginTop: 3, color: "var(--ink-dim)" }}>{zin.slice(0, 220)}</div>}
                </button>
                <button style={S.iconBtn} title="Deze regel terugdraaien"
                  onClick={() => onWis(e.b, e.bron)}><Trash2 size={14} /></button>
              </div>
            </div>
          );
        })}
      </div>
    </Overlay>
  );
}

// ---------- kaart van de hele kelder ----------
// De stijl van Leaflet zit als tekst in de bundel; we zetten ze een keer in de
// pagina wanneer de kaart voor het eerst opengaat.
let leafletCssGezet = false;
function zetLeafletCss() {
  if (leafletCssGezet || typeof document === "undefined") return;
  const el = document.createElement("style");
  el.textContent = leafletCss;
  document.head.appendChild(el);
  leafletCssGezet = true;
}

// Alle flessen van dezelfde producent horen op ÉÉN pin: het is hetzelfde domein,
// dus dezelfde plek. De opzoeking geeft per jaargang wel eens een iets andere
// streeknaam terug ("Toscane" tegenover "Brunello di Montalcino"), en dan kwamen
// dezelfde wijnen verspreid over de kaart te staan. We nemen daarom de mediaan van
// wat we per producent weten; één uitschieter kan de pin dan niet verslepen.
function mediaan(getallen) {
  const g = [...getallen].sort((a, b) => a - b);
  const m = Math.floor(g.length / 2);
  return g.length % 2 ? g[m] : (g[m - 1] + g[m]) / 2;
}

function kaartPunten(bottles) {
  const groepen = new Map();
  for (const b of bottles) {
    const lat = num(b.lat), lng = num(b.lng);
    if (!lat || !lng) continue;
    if ((num(b.quantity) || 0) <= 0) continue;
    const maker = norm(b.producer || b.name);
    const k = maker || `${lat.toFixed(2)},${lng.toFixed(2)}`;
    if (!groepen.has(k)) groepen.set(k, { flessen: [], lats: [], lngs: [], namen: [] });
    const g = groepen.get(k);
    g.flessen.push(b);
    g.lats.push(lat); g.lngs.push(lng);
    if (b.placeName) g.namen.push(b.placeName);
  }
  return [...groepen.values()].map((g) => ({
    lat: mediaan(g.lats),
    lng: mediaan(g.lngs),
    // de langste plaatsnaam is meestal de meest volledige
    plaats: g.namen.sort((a, b) => b.length - a.length)[0]
      || [g.flessen[0].region, g.flessen[0].country].filter(Boolean).join(", "),
    flessen: g.flessen,
  }));
}

function KaartModal({ bottles, onClose, onKies }) {
  const doos = useRef(null);
  const [sel, setSel] = useState(null);
  const punten = useMemo(() => kaartPunten(bottles), [bottles]);
  const zonder = bottles.filter((b) => (num(b.quantity) || 0) > 0 && !(num(b.lat) && num(b.lng))).length;

  useEffect(() => {
    zetLeafletCss();
    if (!doos.current) return;
    const map = L.map(doos.current, { zoomControl: true, attributionControl: true })
      .setView([46.5, 4], 4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 17, attribution: "© OpenStreetMap",
    }).addTo(map);

    const laag = [];
    for (const p of punten) {
      const n = p.flessen.reduce((s, b) => s + (num(b.quantity) || 0), 0);
      const m = L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div class="kelderpin">${n}</div>`,
          iconSize: [30, 30], iconAnchor: [15, 15],
        }),
        title: p.plaats,
      }).addTo(map);
      m.on("click", () => setSel(p));
      laag.push(m);
    }
    if (laag.length) {
      const g = L.featureGroup(laag);
      map.fitBounds(g.getBounds().pad(0.25), { maxZoom: 9 });
    }
    // de kaart meet zichzelf pas juist als het venster echt getekend is
    const t = setTimeout(() => map.invalidateSize(), 120);
    return () => { clearTimeout(t); map.remove(); };
  }, [punten]);

  const totaal = punten.reduce((s, p) => s + p.flessen.reduce((x, b) => x + (num(b.quantity) || 0), 0), 0);

  return (
    <Overlay onClose={onClose} full>
      <div style={S.modalHead}>
        <div style={{ minWidth: 0 }}>
          <h3 style={S.modalTitle}>Mijn wijnen op de kaart</h3>
          <div style={{ ...S.rowSub, marginTop: 3 }}>
            {totaal} fles{totaal === 1 ? "" : "sen"} op {punten.length} plek{punten.length === 1 ? "" : "ken"}
            {zonder ? ` · ${zonder} zonder locatie (tik op Vernieuwen bij die fles)` : ""}
          </div>
        </div>
        <button style={S.iconBtn} onClick={onClose}><X size={18} /></button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <div ref={doos} style={S.kaart} />
        {sel && (
          <div style={S.kaartPaneel}>
            <div style={{ ...S.sectionLabel, marginBottom: 6 }}>{sel.plaats || "Deze plek"}</div>
            {sel.flessen.map((b) => (
              <button key={b.id} className="mi" style={{ ...S.menuItem, fontSize: 15 }}
                onClick={() => { onKies(b); onClose(); }}>
                <Wine size={15} style={{ color: "var(--wine-bright)", flexShrink: 0 }} />
                <span style={{ minWidth: 0 }}>
                  {[b.producer, b.name].filter(Boolean).join(" · ")}{b.vintage ? ` ${b.vintage}` : ""}
                  <span style={{ color: "var(--ink-dim)" }}> · {num(b.quantity) || 0}×</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {!punten.length && (
          <div style={{ ...S.mapPlaceholder, fontSize: 14 }}>
            Nog geen enkele fles heeft een locatie. Open een fles en tik op 'Vernieuwen'.
          </div>
        )}
      </div>
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
function Feit({ label, waarde, sc, laatste }) {
  if (!waarde) return null;
  return (
    <div style={{ ...S.feitRij, ...(laatste ? { borderBottom: "none" } : null) }}>
      <span style={{ ...S.feitLabel, fontSize: sc(11) }}>{label}</span>
      <span style={{ ...S.feitWaarde, fontSize: sc(14) }}>{waarde}</span>
    </div>
  );
}

function Vak({ titel, sc, children, rand }) {
  return (
    <section style={{ ...S.vak, ...(rand ? S.vakRand : null) }}>
      {titel && <h4 style={{ ...S.sectionLabel, fontSize: sc(11), marginBottom: 10 }}>{titel}</h4>}
      {children}
    </section>
  );
}

function DetailModal({ b, scale, onClose, onEdit, onEnrich, onSave, onPatch, onGedronken, onProeven }) {
  const sc = (px) => Math.round(px * scale);
  const st = drinkStatus(b);
  const ev = effVal(b);
  const mat = maturity(b);
  const log = Array.isArray(b.drinkLog) ? b.drinkLog : [];
  const lat = num(b.lat), lng = num(b.lng);
  const hasCoords = lat !== 0 && lng !== 0;
  const osmLink = hasCoords ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=9/${lat}/${lng}` : null;
  const dot = { rood: "#7B1E2B", wit: "#D9C97A", "rosé": "#E1A0A6", mousserend: "#E7D9A0", versterkt: "#8A4B24", oranje: "#C77D2E" }[b.color] || "#7B1E2B";

  return (
    <Overlay onClose={onClose} full>
      {/* De kop en de knoppenbalk blijven staan; enkel het middenstuk schuift.
          Zo staat "Bewerken" altijd binnen handbereik. */}
      <div style={S.modalHead}>
        <div style={{ minWidth: 0 }}>
          <div style={S.rowTop}>
            <span style={{ ...S.colorDot, background: dot, width: 9, height: 9 }} />
            <h3 style={{ ...S.modalTitle, fontSize: sc(20) }}>{b.name || b.producer || "Wijn"}</h3>
            {b.vintage && <span style={{ ...S.vintage, fontSize: sc(15) }}>{b.vintage}</span>}
          </div>
          {b.producer && b.name && norm(b.producer) !== norm(b.name) && (
            <div style={{ ...S.rowSub, fontSize: sc(13), marginTop: 3 }}>{b.producer}</div>
          )}
        </div>
        <button style={S.iconBtn} onClick={onClose}><X size={18} /></button>
      </div>

      <div style={S.detailBody}>
        {b.imageUrl && (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <img src={b.imageUrl} alt="etiket" style={S.etiket}
              onError={(e) => { e.target.style.display = "none"; }} />
          </div>
        )}
        {b.verifyNote && (
          <div style={{ ...S.waarschuwing, fontSize: sc(13) }}>
            <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{b.verifyNote}</span>
          </div>
        )}

        {/* korte kenmerken als gelijke labels; lange waarden als feitenrijen,
            zodat er geen enkele reuzenchip meer over een rij valt */}
        <div style={S.chips}>
          <span style={{ ...S.chip, fontSize: sc(12) }}>{b.color}</span>
          {formaatKort(b.volumeMl) && <span style={{ ...S.chip, fontSize: sc(12), color: "var(--gold)", borderColor: "var(--gold-dim)" }}>{formaatLabel(b.volumeMl)}</span>}
          {b.score && <span style={{ ...S.chip, fontSize: sc(12), color: "var(--gold)", borderColor: "var(--gold)" }}>{b.score}</span>}
          <span style={{ ...S.chip, fontSize: sc(12), color: st.color, borderColor: st.color }}>{st.label}</span>
          {b.buitenKelder && <span style={{ ...S.chip, fontSize: sc(12), color: "var(--gold)", borderColor: "var(--gold-dim)" }}>elders gedronken</span>}
        </div>

        {(b.grape || b.region || b.country || b.location || b.supplier) && (
          <Vak sc={sc} rand>
            <Feit label="Druif" waarde={b.grape} sc={sc} />
            <Feit label="Streek" waarde={[b.region, b.country].filter(Boolean).join(", ")} sc={sc} />
            <Feit label="In kelder" waarde={b.location} sc={sc} />
            <Feit label="Gekocht bij" waarde={b.supplier} sc={sc} laatste />
          </Vak>
        )}

        {(b.drinkFrom || b.drinkTo) && (
          <Vak titel="Drinkvenster" sc={sc}>
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
          </Vak>
        )}

        <Vak titel="Waar gemaakt" sc={sc}>
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
            <div style={{ ...S.mapPlaceholder, fontSize: sc(13) }}>Tik onderaan op 'Vernieuwen' voor locatie, recensies en actuele prijs.</div>
          )}
        </Vak>

        <Vak titel="Beschrijving" sc={sc}>
          {b._loading && !b.description ? (
            <div style={{ ...S.mapPlaceholder, fontSize: sc(13) }}><Loader2 className="spin" size={16} /> Info ophalen…</div>
          ) : (
            <p style={{ ...S.bodyText, fontSize: sc(14) }}>{b.description || "Tik onderaan op 'Vernieuwen' voor een beschrijving van deze jaargang."}</p>
          )}
        </Vak>

        <Vak titel="Recente recensies" sc={sc}>
          <p style={{ ...S.bodyText, fontSize: sc(14) }}>{b.reviews || (b._loading ? "…" : "Nog niet opgezocht.")}</p>
        </Vak>

        {b._error && <div style={{ ...S.jobError, fontSize: sc(13) }}><AlertCircle size={15} /> {b._error}</div>}

        <Vak titel="Waarde per fles" sc={sc}>
          <div style={S.valGrid}>
            <ValCell label="Aankoop" sc={sc}
              bewerk={<DirectVeld waarde={b.purchasePrice} getal placeholder="—" sc={sc}
                onKlaar={(v) => onPatch && onPatch({ purchasePrice: v })} />} />
            <ValCell label="Retail" sc={sc} sub={b.priceManual ? "zelf ingevuld · incl. btw" : "incl. btw"}
              bewerk={<DirectVeld waarde={b.retailValue} getal placeholder="—" sc={sc}
                onKlaar={(v) => onPatch && onPatch(fieldPatch("retailValue", v))} />} />
            <ValCell label="Mijn waarde" sc={sc}
              sub={ev.fallback ? `leeg = retail (${eur(ev.v)})` : ""}
              bewerk={<DirectVeld waarde={b.ownValue} getal placeholder="—" sc={sc}
                onKlaar={(v) => onPatch && onPatch({ ownValue: v })} />} />
          </div>
          <div style={{ ...S.mapCaption, fontSize: sc(12), marginTop: 10 }}>
            {b.buitenKelder
              ? "Deze fles lag niet in je kelder; ze staat er voor het logboek."
              : `${b.quantity || 1}× in kelder · totaal ${eur(ev.v * (num(b.quantity) || 1))}${ev.fallback ? " (op retail)" : ""}`}
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
        </Vak>

        <Vak titel="Mijn proefnotities" sc={sc}>
          <DirectVeld waarde={b.tasteNotes} onKlaar={(v) => onPatch && onPatch({ tasteNotes: v })}
            meerregelig placeholder="Kleur, neus, smaak, evolutie… (wordt vanzelf bewaard)" sc={sc} />
          {onProeven && (
            <button style={{ ...S.btnGhost, marginTop: 10, width: "100%" }} onClick={onProeven}>
              <Check size={15} /> Proeven met het draaiboek
            </button>
          )}
        </Vak>

        {b.notes && (
          <Vak titel="Notities" sc={sc}>
            <p style={{ ...S.bodyText, fontSize: sc(14) }}>{b.notes}</p>
          </Vak>
        )}

        {(log.length > 0 || num(b.herproefOp) > 0) && (
          <Vak titel="Logboek" sc={sc}>
            {num(b.herproefOp) > 0 && (
              <p style={{ ...S.bodyText, fontSize: sc(13), color: num(b.herproefOp) <= NOW ? "var(--gold)" : "var(--ink-dim)" }}>
                {num(b.herproefOp) <= NOW ? `Klaar om opnieuw te proeven (sinds ${b.herproefOp}).` : `Opnieuw proeven vanaf ${b.herproefOp}.`}
              </p>
            )}
            {log.slice().reverse().map((e, i) => (
              <div key={i} style={{ ...S.bodyText, fontSize: sc(13), marginTop: 10 }}>
                <span style={{ color: "var(--ink)" }}>
                  {e.d} · {logSoort(e)} · {num(e.n) || 1} fles{(num(e.n) || 1) > 1 ? "sen" : ""}
                </span>
                {num(e.v) > 0 && <span style={{ color: "var(--ink-dim)" }}> · {eur(num(e.v) * (num(e.n) || 1))}</span>}
                {num(e.opbrengst) > 0 && <span style={{ color: "var(--gold)" }}> · opbrengst {eur(num(e.opbrengst) * (num(e.n) || 1))}</span>}
                {e.rijpheid && <div style={{ color: "var(--gold)" }}>{e.rijpheid}</div>}
                {DRINK_VRAGEN.map((v) => {
                  const w = Array.isArray(e[v.k]) ? e[v.k].join(", ") : e[v.k];
                  return w ? <div key={v.k} style={{ color: "var(--ink-dim)" }}>{v.label}: {w}</div> : null;
                })}
              </div>
            ))}
          </Vak>
        )}

        <WineChat b={b} sc={sc} />
      </div>

      {/* drie knoppen die de breedte delen: geen afgebroken rij meer */}
      <div style={S.detailFoot}>
        <button style={{ ...S.voetKnop, ...(num(b.quantity) > 0 ? null : { opacity: 0.4 }) }}
          onClick={onGedronken} disabled={!onGedronken || !(num(b.quantity) > 0)}>
          <Wine size={15} /> Fles weg
        </button>
        <button style={S.voetKnop} onClick={onEnrich} disabled={b._loading}>
          {b._loading ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />} Vernieuwen
        </button>
        <button style={{ ...S.voetKnop, ...S.voetKnopPrimair }} onClick={onEdit}><Pencil size={15} /> Bewerken</button>
      </div>
    </Overlay>
  );
}
// ---------- vraag de sommelier over deze ene fles ----------
const WIJN_TIPS = [
  "Vertel over de historiek van deze wijnbouwer",
  "Waar past deze wijn bij aan tafel?",
  "Hoe lang kan ik deze fles nog bewaren?",
];
function WineChat({ b, sc }) {
  const [thread, setThread] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const send = async (text) => {
    const vraag = String(text ?? q).trim();
    if (!vraag || busy) return;
    setQ(""); setErr(""); setBusy(true);
    try {
      const a = await askWineQuestion({ b, question: vraag, history: thread });
      setThread((t) => [...t, { q: vraag, a }]);
    } catch (e) {
      setErr(e.message || "Er ging iets mis.");
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ ...S.sectionLabel, fontSize: sc(11) }}>Vraag de sommelier over deze wijn</div>
      {thread.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 12 }}>
          {thread.map((t, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ ...S.chatQ, fontSize: sc(15), maxWidth: "92%" }}>{t.q}</div>
              <div style={{ ...S.chatA, fontSize: sc(15), maxWidth: "100%" }}>{t.a}</div>
            </div>
          ))}
        </div>
      )}
      {!thread.length && !busy && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {WIJN_TIPS.map((t) => (
            <button key={t} className="mi" style={{ ...S.chatTip, fontSize: sc(14), padding: "8px 13px" }} onClick={() => send(t)}>{t}</button>
          ))}
        </div>
      )}
      {busy && <div style={{ ...S.jobPending, padding: "6px 0" }}><Loader2 className="spin" size={16} /> De sommelier zoekt het op…</div>}
      {err && <div style={{ ...S.jobError, padding: "6px 0" }}><AlertCircle size={15} /> {err}</div>}
      {/* veld en knop onder elkaar en over de volle breedte: naast elkaar werd
          het veld te smal en stond de knop scheef */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <textarea
          style={{ ...S.input, width: "100%", minHeight: 74, maxHeight: 180, resize: "vertical", lineHeight: 1.5 }}
          rows={3}
          placeholder={thread.length ? "Nog een vraag over deze fles…" : "Bv. wat maakt deze wijn bijzonder?"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button style={{ ...S.btnPrimary, height: 44, width: "100%" }} onClick={() => send()} disabled={busy || !q.trim()}>
          {busy ? <Loader2 className="spin" size={15} /> : <Send size={15} />} Vraag het de sommelier
        </button>
      </div>
    </div>
  );
}

function ValCell({ label, value, sub, muted, sc, bewerk }) {
  return (
    <div style={S.valCell}>
      <div style={{ ...S.valCellLabel, fontSize: sc(11), minHeight: sc(28) }}>{label}</div>
      {bewerk || (
        <div style={{ ...S.valCellValue, fontSize: sc(17), color: muted ? "var(--ink-dim)" : "var(--ink)", fontStyle: muted ? "italic" : "normal" }}>{value}</div>
      )}
      {sub && <div style={{ ...S.valCellSub, fontSize: sc(10) }}>{sub}</div>}
    </div>
  );
}

// Veld dat rechtstreeks op de kaart staat en zichzelf bewaart zodra je weggaat of
// even stopt met typen. Geen opslaan-knop, geen omweg via Bewerken.
function DirectVeld({ waarde, onKlaar, meerregelig, getal, placeholder, sc }) {
  const [tekst, setTekst] = useState(String(waarde ?? ""));
  const [bewaard, setBewaard] = useState(false);
  const laatste = useRef(String(waarde ?? ""));
  const timer = useRef(null);
  // volgt een wijziging die van buiten komt (bv. een opzoeking)
  useEffect(() => {
    const nieuw = String(waarde ?? "");
    if (nieuw !== laatste.current) { laatste.current = nieuw; setTekst(nieuw); }
  }, [waarde]);
  // via refs, zodat het opruimen bij het sluiten nog met de actuele waarden werkt
  const nu = useRef({ tekst: String(waarde ?? ""), onKlaar });
  nu.current = { tekst, onKlaar };
  const bewaar = (v) => {
    if (v === laatste.current) return;
    laatste.current = v;
    nu.current.onKlaar && nu.current.onKlaar(v);
    setBewaard(true);
    setTimeout(() => setBewaard(false), 1600);
  };
  const wijzig = (v) => {
    setTekst(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => bewaar(v), 900);   // even stoppen met typen = bewaren
  };
  // Sluit je de kaart terwijl er nog een wijziging openstaat, dan moet die alsnog
  // bewaard worden. Enkel de timer opruimen liet je laatste zin verloren gaan.
  useEffect(() => () => { clearTimeout(timer.current); bewaar(nu.current.tekst); }, []);
  const stijl = { ...S.input, fontSize: sc(16), padding: getal ? "6px 8px" : "10px 12px" };
  return (
    <div style={{ position: "relative" }}>
      {meerregelig ? (
        <textarea style={{ ...stijl, minHeight: 92, resize: "vertical", lineHeight: 1.5 }} rows={3}
          value={tekst} placeholder={placeholder}
          onChange={(e) => wijzig(e.target.value)} onBlur={() => { clearTimeout(timer.current); bewaar(tekst); }} />
      ) : (
        <input style={{ ...stijl, fontFamily: "'JetBrains Mono',monospace" }} type={getal ? "number" : "text"}
          inputMode={getal ? "decimal" : undefined} value={tekst} placeholder={placeholder}
          onChange={(e) => wijzig(e.target.value)} onBlur={() => { clearTimeout(timer.current); bewaar(tekst); }} />
      )}
      {bewaard && <span style={S.bewaardTag}><Check size={11} /> bewaard</span>}
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
.kelderpin { display:flex; align-items:center; justify-content:center; width:30px; height:30px;
  border-radius:50%; background:#7B1E2B; color:#F6EFE6; border:2px solid #E7D9A0;
  font-size:12.5px; font-weight:700; box-shadow:0 2px 8px rgba(0,0,0,.5); }
.leaflet-container { background:#12100E; font-family:inherit; }
.leaflet-popup-content-wrapper, .leaflet-control-attribution { font-size:11px; }
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
  menuBackdrop: { position: "fixed", inset: 0, zIndex: 40, cursor: "pointer" },
  menu: { position: "absolute", right: 0, top: 44, zIndex: 41, background: "var(--bg2)", border: "1px solid var(--line2)", borderRadius: 12, padding: 6, minWidth: 210, boxShadow: "0 16px 40px rgba(0,0,0,.5)", display: "flex", flexDirection: "column", gap: 2 },
  menuItem: { display: "flex", alignItems: "center", gap: 9, background: "transparent", border: "none", color: "var(--ink)", padding: "10px 12px", borderRadius: 8, fontSize: 13.5, cursor: "pointer", textAlign: "left", width: "100%" },
  menuSep: { height: 1, background: "var(--line)", margin: "4px 6px" },
  actions: { display: "flex", gap: 8, flexWrap: "wrap" },
  ledgerKop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, paddingTop: 14 },
  ledgerTitel: { fontFamily: "'Spectral',serif", fontSize: 17, color: "var(--ink)", letterSpacing: 0.2 },
  ledger: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 9, padding: "12px 0 14px" },
  stat: { minWidth: 0, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 13px", display: "flex", flexDirection: "column" },
  statLabel: { fontSize: 10.5, textTransform: "uppercase", letterSpacing: 1.2, color: "var(--ink-dim)", marginBottom: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  statValue: { fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 500, whiteSpace: "nowrap", letterSpacing: -0.3 },
  statSub: { fontFamily: "'JetBrains Mono',monospace", fontSize: 12, marginTop: 2 },

  toolbar: { display: "flex", gap: 8, padding: "16px 22px", flexWrap: "wrap", alignItems: "center" },
  searchWrap: { display: "flex", alignItems: "center", gap: 8, background: "var(--bg2)", border: "1px solid var(--line)", borderRadius: 10, padding: "0 13px", flex: "1 1 260px", height: 40 },
  search: { border: "none", background: "transparent", color: "var(--ink)", flex: 1, fontSize: 16 },
  select: { flex: "1 1 150px", minWidth: 0, background: "var(--bg2)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--ink2)", height: 40, padding: "0 12px", fontSize: 16, cursor: "pointer" },

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

  btnPrimary: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 0, background: "linear-gradient(180deg, var(--wine-bright), var(--wine))", border: "1px solid var(--wine-bright)", color: "#fff", padding: "0 15px", height: 38, borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 1px 2px rgba(0,0,0,.3)" },
  btnGhost: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 0, background: "var(--bg2)", border: "1px solid var(--line)", color: "var(--ink2)", padding: "0 15px", height: 38, borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: "pointer" },
  btnLink: { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: "var(--gold)", fontSize: 13, cursor: "pointer" },

  overlay: { cursor: "pointer", position: "fixed", top: "var(--vvtop, 0px)", left: 0, right: 0, height: "var(--vvh, 100%)", background: "rgba(6,4,3,.74)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center", padding: 16, zIndex: 50 },
  modal: { cursor: "auto", width: "100%", background: "linear-gradient(180deg, #201B17, #1A1613)", border: "1px solid var(--line2)", borderRadius: 16, padding: 22, maxHeight: "100%", overflowY: "auto", boxShadow: "0 30px 80px rgba(0,0,0,.6)" },
  modalFull: {
    maxWidth: 940, height: "100%", maxHeight: "100%",
    overflow: "hidden", display: "flex", flexDirection: "column",
    padding: "18px 18px 14px",
  },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 18 },
  modalTitle: { fontFamily: "'Spectral',serif", fontSize: 21, fontWeight: 600, margin: 0, letterSpacing: 0.2 },
  form: { display: "flex", flexDirection: "column", gap: 13 },
  formRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  field: { display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 130 },
  fieldLabel: { fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--ink-dim)" },
  input: { background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 9, color: "var(--ink)", padding: "10px 12px", fontSize: 16, width: "100%" },
  modalFoot: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20, flexWrap: "wrap" },

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
  etiket: { maxWidth: 150, maxHeight: 210, objectFit: "contain", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--line)", padding: 6 },
  geldKnop: { display: "inline-flex", alignItems: "center", gap: 5, background: "transparent", border: "1px solid var(--line)", color: "var(--ink-dim)", padding: "4px 10px", borderRadius: 20, fontSize: 11.5, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 },
  bewaardTag: { position: "absolute", right: 6, top: -16, fontSize: 10, color: "var(--green)", display: "inline-flex", alignItems: "center", gap: 3 },
  bulkRij: { display: "flex", flexDirection: "column", gap: 6, paddingBottom: 12, borderBottom: "1px solid var(--bg3)" },
  bulkKop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, color: "var(--gold-dim)", fontWeight: 600 },
  bulkVelden: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" },
  chatScroll: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 18, overflowY: "auto", padding: "2px 2px 4px" },
  chatIntro: { background: "var(--bg)", border: "1px dashed var(--line2)", borderRadius: 12, padding: "16px 16px 18px" },
  chatTip: { background: "var(--bg2)", border: "1px solid var(--line)", color: "var(--ink2)", borderRadius: 20, padding: "10px 16px", fontSize: 16, cursor: "pointer", textAlign: "left", lineHeight: 1.45 },
  chatQ: { alignSelf: "flex-end", maxWidth: "88%", background: "linear-gradient(180deg, var(--wine-bright), var(--wine))", color: "#fff", borderRadius: "14px 14px 4px 14px", padding: "11px 15px", fontSize: 16, lineHeight: 1.5 },
  chatA: { alignSelf: "flex-start", maxWidth: "94%", background: "var(--bg)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: "14px 14px 14px 4px", padding: "14px 17px", fontSize: 16, lineHeight: 1.7, whiteSpace: "pre-wrap" },
  chatBar: { display: "flex", gap: 8, alignItems: "flex-end", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)", flexShrink: 0 },

  chipKeuzeRij: { display: "flex", flexWrap: "wrap", gap: 6 },
  chipKeuze: { background: "var(--bg)", border: "1px solid var(--line)", color: "var(--ink2)", padding: "7px 11px", borderRadius: 999, fontSize: 13.5, cursor: "pointer", lineHeight: 1.2 },
  chipKeuzeAan: { background: "rgba(123,30,43,.35)", borderColor: "var(--wine-bright)", color: "var(--ink)", fontWeight: 600 },
  chips: { display: "flex", flexWrap: "wrap", gap: 7, alignItems: "center" },
  chip: { display: "inline-flex", alignItems: "center", height: 28, fontSize: 12, border: "1px solid var(--line2)", color: "var(--ink2)", padding: "0 12px", borderRadius: 20, background: "var(--bg2)", textTransform: "capitalize", letterSpacing: 0.2, whiteSpace: "nowrap" },
  sectionLabel: { fontSize: 10.5, textTransform: "uppercase", letterSpacing: 1.4, color: "var(--gold-dim)", marginBottom: 8, fontWeight: 600 },
  bottleImg: { width: 78, height: 130, objectFit: "cover", borderRadius: 10, border: "1px solid var(--line2)", background: "var(--bg)", flexShrink: 0 },
  map: { width: "100%", height: 210, border: "1px solid var(--line2)", borderRadius: 12, background: "var(--bg)", display: "block", objectFit: "cover", cursor: "pointer" },
  mapFoot: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" },
  mapPanel: { display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "var(--bg)", border: "1px solid var(--line2)", borderRadius: 12, textDecoration: "none", cursor: "pointer" },
  mapLink: { display: "inline-flex", alignItems: "center", gap: 4, color: "var(--gold)", fontSize: 12, textDecoration: "none", whiteSpace: "nowrap" },
  mapCaption: { fontSize: 12, color: "var(--ink-dim)" },
  // Detailkaart: kop en knoppenbalk staan vast, alleen het midden schuift.
  detailBody: { flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, paddingRight: 2 },
  detailFoot: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" },
  voetKnop: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 0, height: 44, padding: "0 8px", borderRadius: 11, background: "var(--bg2)", border: "1px solid var(--line)", color: "var(--ink2)", fontSize: 13.5, fontWeight: 500, cursor: "pointer" },
  voetKnopPrimair: { background: "linear-gradient(180deg, var(--wine-bright), var(--wine))", borderColor: "var(--wine-bright)", color: "#fff", fontWeight: 600 },

  // Eén vorm voor elk blok op de kaart, zodat alles dezelfde ritme houdt.
  vak: { display: "flex", flexDirection: "column" },
  vakRand: { background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 12, padding: "4px 13px" },
  feitRij: { display: "flex", gap: 12, alignItems: "baseline", padding: "9px 0", borderBottom: "1px solid var(--bg3)" },
  feitLabel: { flex: "0 0 88px", textTransform: "uppercase", letterSpacing: 1, color: "var(--ink-dim)", fontWeight: 600 },
  feitWaarde: { flex: 1, minWidth: 0, color: "var(--ink)", lineHeight: 1.45 },
  waarschuwing: { display: "flex", gap: 8, alignItems: "flex-start", color: "var(--amber)", padding: "10px 13px", background: "rgba(210,160,73,.08)", border: "1px solid rgba(210,160,73,.3)", borderRadius: 10 },

  verkenRij: { display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" },
  verkenKnop: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, flex: "1 1 108px", minWidth: 0, background: "var(--bg2)", border: "1px solid var(--line)", color: "var(--ink2)", height: 40, borderRadius: 10, fontSize: 13.5, fontWeight: 500, cursor: "pointer" },
  kiesRij: { display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid var(--bg3)", padding: "12px 4px", cursor: "pointer", color: "var(--ink)" },
  kiesFoto: { width: 46, height: 62, objectFit: "contain", flexShrink: 0, background: "var(--bg)", borderRadius: 6 },
  logTellers: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9 },
  logRij: { display: "flex", alignItems: "flex-start", gap: 8, width: "100%", borderBottom: "1px solid var(--bg3)", padding: "11px 4px" },
  logKnop: { flex: 1, minWidth: 0, textAlign: "left", background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--ink)" },
  kaart: { flex: 1, minHeight: 240, borderRadius: 12, overflow: "hidden", border: "1px solid var(--line2)", background: "#12100E" },
  kaartPaneel: { maxHeight: "34vh", overflowY: "auto", background: "var(--bg)", border: "1px solid var(--line2)", borderRadius: 12, padding: "12px 10px", flexShrink: 0 },
  mapPlaceholder: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-dim)", background: "var(--bg)", border: "1px dashed var(--line2)", borderRadius: 12, padding: "20px 15px" },
  bodyText: { fontSize: 14, lineHeight: 1.65, color: "var(--ink2)", margin: 0 },
  valGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9 },
  valCell: { background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 12, padding: "11px 13px", minWidth: 0, display: "flex", flexDirection: "column" },
  valCellLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--ink-dim)", marginBottom: 4, lineHeight: 1.25 },
  valCellValue: { fontFamily: "'JetBrains Mono',monospace", fontSize: 17, fontWeight: 500, whiteSpace: "nowrap" },
  valCellSub: { fontSize: 10, color: "var(--ink-dim)", marginTop: "auto", paddingTop: 3, lineHeight: 1.3 },

  toast: { position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "var(--bg3)", border: "1px solid var(--line)", color: "var(--ink)", padding: "10px 18px", borderRadius: 10, fontSize: 13, zIndex: 60, boxShadow: "0 8px 30px rgba(0,0,0,.4)" },
};


// ---- PWA mount ----
import { createRoot } from "react-dom/client";
const rootEl = document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<App />);
