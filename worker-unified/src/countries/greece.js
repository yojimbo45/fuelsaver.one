/**
 * Greece — fuelprices.gr (government fuel price observatory) + OpenStreetMap.
 *
 * Tier A: prefecture-level prices scraped from the official Fuel Price Observatory
 *         (Παρατηρητήριο Τιμών Υγρών Καυσίμων), refreshed via cron.
 *         Station locations from OSM Overpass (grid-cached).
 *
 * fuelprices.gr publishes daily min/avg/max prices per prefecture for all fuel types.
 * Stations are legally required to report prices. ~4,500 stations across 54 prefectures.
 * No API key needed.
 */

import { filterByDistance, gridCell, haversine } from '../lib/geo.js';
import { json } from '../lib/response.js';
import { getGridCache, putGridCache } from '../lib/kv.js';
import { queryOverpass } from '../lib/overpass.js';

const COUNTRY = 'GR';

// Fuel type codes on fuelprices.gr → our fuel IDs
const FUEL_CODES = [
  { prodclass: '1', id: 'unleaded_95' },
  { prodclass: '2', id: 'unleaded_100' },
  { prodclass: '4', id: 'diesel' },
  { prodclass: '6', id: 'lpg' },
];

const BRAND_MAP = {
  bp: 'BP', shell: 'Shell', eko: 'EKO', 'hellenic petroleum': 'EKO',
  aegean: 'Aegean', avin: 'Avin', revoil: 'Revoil',
  'jet oil': 'Jet Oil', silkgas: 'Silk Gas', cyclon: 'Cyclon',
  'coral': 'Coral', 'elin': 'Elin',
};

// 54 Greek prefectures with approximate center coordinates for nearest-match lookup.
// Prefecture names match exactly what fuelprices.gr returns (Greek uppercase).
const PREFECTURES = [
  { name: 'ΝΟΜΑΡΧΙΑ ΑΘΗΝΩΝ', lat: 37.98, lng: 23.73 },
  { name: 'ΝΟΜΑΡΧΙΑ ΠΕΙΡΑΙΩΣ', lat: 37.94, lng: 23.65 },
  { name: 'ΝΟΜΑΡΧΙΑ ΑΝΑΤΟΛΙΚΗΣ ΑΤΤΙΚΗΣ', lat: 38.00, lng: 23.86 },
  { name: 'ΝΟΜΑΡΧΙΑ ΔΥΤΙΚΗΣ ΑΤΤΙΚΗΣ', lat: 38.07, lng: 23.53 },
  { name: 'ΝΟΜΟΣ ΘΕΣΣΑΛΟΝΙΚΗΣ', lat: 40.63, lng: 22.94 },
  { name: 'ΝΟΜΟΣ ΑΧΑΪΑΣ', lat: 38.25, lng: 21.73 },
  { name: 'ΝΟΜΟΣ ΗΡΑΚΛΕΙΟΥ', lat: 35.34, lng: 25.13 },
  { name: 'ΝΟΜΟΣ ΛΑΡΙΣΗΣ', lat: 39.64, lng: 22.42 },
  { name: 'ΝΟΜΟΣ ΑΙΤΩΛΙΑΣ ΚΑΙ ΑΚΑΡΝΑΝΙΑΣ', lat: 38.68, lng: 21.38 },
  { name: 'ΝΟΜΟΣ ΕΥΒΟΙΑΣ', lat: 38.60, lng: 23.60 },
  { name: 'ΝΟΜΟΣ ΜΑΓΝΗΣΙΑΣ', lat: 39.36, lng: 22.94 },
  { name: 'ΝΟΜΟΣ ΣΕΡΡΩΝ', lat: 41.09, lng: 23.55 },
  { name: 'ΝΟΜΟΣ ΙΩΑΝΝΙΝΩΝ', lat: 39.66, lng: 20.85 },
  { name: 'ΝΟΜΟΣ ΚΟΡΙΝΘΙΑΣ', lat: 37.94, lng: 22.93 },
  { name: 'ΝΟΜΟΣ ΔΩΔΕΚΑΝΗΣΟΥ', lat: 36.43, lng: 28.22 },
  { name: 'ΝΟΜΟΣ ΜΕΣΣΗΝΙΑΣ', lat: 37.07, lng: 21.93 },
  { name: 'ΝΟΜΟΣ ΗΛΕΙΑΣ', lat: 37.68, lng: 21.50 },
  { name: 'ΝΟΜΟΣ ΚΟΖΑΝΗΣ', lat: 40.30, lng: 21.79 },
  { name: 'ΝΟΜΟΣ ΚΑΒΑΛΑΣ', lat: 41.00, lng: 24.42 },
  { name: 'ΝΟΜΟΣ ΠΕΛΛΗΣ', lat: 40.76, lng: 22.14 },
  { name: 'ΝΟΜΟΣ ΤΡΙΚΑΛΩΝ', lat: 39.56, lng: 21.77 },
  { name: 'ΝΟΜΟΣ ΒΟΙΩΤΙΑΣ', lat: 38.43, lng: 23.10 },
  { name: 'ΝΟΜΟΣ ΠΙΕΡΙΑΣ', lat: 40.27, lng: 22.49 },
  { name: 'ΝΟΜΟΣ ΚΑΡΔΙΤΣΗΣ', lat: 39.37, lng: 21.92 },
  { name: 'ΝΟΜΟΣ ΕΒΡΟΥ', lat: 41.15, lng: 26.07 },
  { name: 'ΝΟΜΟΣ ΦΘΙΩΤΙΔΟΣ', lat: 38.90, lng: 22.43 },
  { name: 'ΝΟΜΟΣ ΗΜΑΘΙΑΣ', lat: 40.59, lng: 22.20 },
  { name: 'ΝΟΜΟΣ ΡΟΔΟΠΗΣ', lat: 41.12, lng: 25.40 },
  { name: 'ΝΟΜΟΣ ΞΑΝΘΗΣ', lat: 41.13, lng: 24.89 },
  { name: 'ΝΟΜΟΣ ΔΡΑΜΑΣ', lat: 41.15, lng: 24.15 },
  { name: 'ΝΟΜΟΣ ΑΡΓΟΛΙΔΟΣ', lat: 37.63, lng: 22.76 },
  { name: 'ΝΟΜΟΣ ΧΑΛΚΙΔΙΚΗΣ', lat: 40.28, lng: 23.55 },
  { name: 'ΝΟΜΟΣ ΚΙΛΚΙΣ', lat: 41.10, lng: 22.49 },
  { name: 'ΝΟΜΟΣ ΑΡΤΗΣ', lat: 39.16, lng: 20.99 },
  { name: 'ΝΟΜΟΣ ΚΕΡΚΥΡΑΣ', lat: 39.62, lng: 19.92 },
  { name: 'ΝΟΜΟΣ ΛΑΚΩΝΙΑΣ', lat: 36.95, lng: 22.56 },
  { name: 'ΝΟΜΟΣ ΧΑΝΙΩΝ', lat: 35.51, lng: 24.02 },
  { name: 'ΝΟΜΟΣ ΡΕΘΥΜΝΗΣ', lat: 35.37, lng: 24.47 },
  { name: 'ΝΟΜΟΣ ΛΑΣΙΘΙΟΥ', lat: 35.18, lng: 25.73 },
  { name: 'ΝΟΜΟΣ ΑΡΚΑΔΙΑΣ', lat: 37.50, lng: 22.37 },
  { name: 'ΝΟΜΟΣ ΚΥΚΛΑΔΩΝ', lat: 37.09, lng: 25.15 },
  { name: 'ΝΟΜΟΣ ΛΕΣΒΟΥ', lat: 39.10, lng: 26.33 },
  { name: 'ΝΟΜΟΣ ΘΕΣΠΡΩΤΙΑΣ', lat: 39.48, lng: 20.36 },
  { name: 'ΝΟΜΟΣ ΠΡΕΒΕΖΗΣ', lat: 38.95, lng: 20.75 },
  { name: 'ΝΟΜΟΣ ΚΑΣΤΟΡΙΑΣ', lat: 40.52, lng: 21.30 },
  { name: 'ΝΟΜΟΣ ΦΛΩΡΙΝΗΣ', lat: 40.78, lng: 21.41 },
  { name: 'ΝΟΜΟΣ ΓΡΕΒΕΝΩΝ', lat: 40.08, lng: 21.43 },
  { name: 'ΝΟΜΟΣ ΦΩΚΙΔΟΣ', lat: 38.53, lng: 22.38 },
  { name: 'ΝΟΜΟΣ ΕΥΡΥΤΑΝΙΑΣ', lat: 38.90, lng: 21.80 },
  { name: 'ΝΟΜΟΣ ΣΑΜΟΥ', lat: 37.75, lng: 26.97 },
  { name: 'ΝΟΜΟΣ ΧΙΟΥ', lat: 38.37, lng: 26.14 },
  { name: 'ΝΟΜΟΣ ΖΑΚΥΝΘΟΥ', lat: 37.78, lng: 20.90 },
  { name: 'ΝΟΜΟΣ ΚΕΦΑΛΛΗΝΙΑΣ', lat: 38.18, lng: 20.49 },
  { name: 'ΝΟΜΟΣ ΛΕΥΚΑΔΟΣ', lat: 38.83, lng: 20.71 },
];

// ── Scrape fuelprices.gr ───────────────────────────────────────────

async function scrapePrices(prodclass) {
  const url = `https://www.fuelprices.gr/price_stats_ng.view?prodclass=${prodclass}&nofdays=1&order_by=4`;
  const res = await fetch(url);
  if (!res.ok) return {};

  // Response is windows-1253 encoded — read as bytes and decode
  const buf = await res.arrayBuffer();
  const html = new TextDecoder('windows-1253').decode(buf);

  // Parse rows: each prefecture row has [Name, Count, Min, Avg, Max]
  const prices = {};
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const cells = [];
    let td;
    while ((td = tdRegex.exec(match[1])) !== null) {
      cells.push(td[1].replace(/<[^>]+>/g, '').trim());
    }
    if (cells.length >= 5) {
      const avg = cells[3];
      if (/^\d,\d{3}$/.test(avg)) {
        const name = cells[0];
        prices[name] = parseFloat(avg.replace(',', '.'));
      }
    }
  }
  return prices;
}

// Find nearest prefecture for a lat/lng
function findPrefecture(lat, lng) {
  let best = PREFECTURES[0];
  let bestDist = Infinity;
  for (const p of PREFECTURES) {
    const d = haversine(lat, lng, p.lat, p.lng);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best.name;
}

// ── Station mapping ────────────────────────────────────────────────

function mapElements(elements) {
  return elements.map((el) => {
    const elLat = el.lat || el.center?.lat;
    const elLng = el.lon || el.center?.lon;
    if (!elLat || !elLng) return null;

    const tags = el.tags || {};
    const brand = (tags.brand || tags.name || 'Station').trim();

    return {
      id: `GR-${el.id}`,
      brand: BRAND_MAP[brand.toLowerCase()] || brand,
      name: tags.name || brand,
      address: [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' '),
      city: tags['addr:city'] || tags['addr:suburb'] || '',
      lat: elLat,
      lng: elLng,
      country: COUNTRY,
      prices: {},
      updatedAt: null,
    };
  }).filter(Boolean);
}

function applyPrices(stations, prefecturePrices) {
  return stations.map((s) => {
    const pref = findPrefecture(s.lat, s.lng);
    const prices = {};
    for (const fuel of FUEL_CODES) {
      const prefPrices = prefecturePrices[fuel.id];
      if (prefPrices && prefPrices[pref] != null) {
        prices[fuel.id] = prefPrices[pref];
      }
    }
    return { ...s, prices };
  });
}

// ── Refresh (cron) ─────────────────────────────────────────────────

export async function refresh(env) {
  try {
    // Scrape all fuel types in parallel
    const results = await Promise.all(
      FUEL_CODES.map(async ({ prodclass, id }) => {
        const prices = await scrapePrices(prodclass);
        return { id, prices };
      })
    );

    // Build store: { unleaded_95: { "ΝΟΜΟΣ ΑΤΤΙΚΗΣ": 2.064, ... }, diesel: { ... } }
    const store = {};
    for (const { id, prices } of results) {
      if (Object.keys(prices).length > 0) {
        store[id] = prices;
      }
    }

    await env.FUEL_KV.put('prices:GR', JSON.stringify(store));
    console.log(`[GR] Refreshed prices for ${Object.keys(store).length} fuel types, ${Object.values(store)[0] ? Object.keys(Object.values(store)[0]).length : 0} prefectures`);
  } catch (e) {
    console.error('[GR] Price refresh failed:', e);
  }
}

// ── Query handler ──────────────────────────────────────────────────

export async function handleQuery(url, env) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radiusKm = parseFloat(url.searchParams.get('radius') || '15');

  const prefecturePrices = await env.FUEL_KV.get('prices:GR', { type: 'json' }) || {};

  const grid = gridCell(lat, lng);
  const cacheKey = `cache:${COUNTRY}:${grid.lat}:${grid.lng}`;

  let stations = await getGridCache(cacheKey, env);
  if (!stations) {
    const radiusM = Math.min(radiusKm * 1000, 25000);
    const elements = await queryOverpass(grid.lat, grid.lng, radiusM);
    stations = mapElements(elements);
    await putGridCache(cacheKey, stations, env, 600);
  }

  const priced = applyPrices(stations, prefecturePrices);
  const filtered = filterByDistance(priced, lat, lng, radiusKm);
  return json({ stations: filtered, count: filtered.length });
}
