/**
 * Hungary — benzinkutarak.hu (station-level prices by county).
 *
 * Tier A: bulk-cached via cron. Queries all 20 regions (19 counties + Budapest),
 * three fuel types, then merges and deduplicates.
 */

import { filterByDistance } from '../lib/geo.js';
import { json } from '../lib/response.js';
import { getStations, putStations } from '../lib/kv.js';

const COUNTRY = 'HU';
const API_URL = 'https://www.benzinkutarak.hu/index.php';

const COUNTIES = [
  'Budapest', 'Baranya', 'Bács-Kiskun', 'Békés', 'Borsod-Abaúj-Zemplén',
  'Csongrád-Csanád', 'Fejér', 'Győr-Moson-Sopron', 'Hajdú-Bihar',
  'Heves', 'Jász-Nagykun-Szolnok', 'Komárom-Esztergom', 'Nógrád',
  'Pest', 'Somogy', 'Szabolcs-Szatmár-Bereg', 'Tolna',
  'Vas', 'Veszprém', 'Zala',
];

const BRANDS_QUERY = [
  'MOL', 'OMV', 'Shell', 'Auchan', 'AVIA', 'Dallas', 'Orlen',
  'Envi', 'OIL', 'MPetrol', 'MolPartner', 'ALDI',
];

const FUEL_TYPES = [
  { param: 'Benzina_Regular', key: 'e5' },
  { param: 'Motorina_Regular', key: 'diesel' },
  { param: 'GPL', key: 'lpg' },
];

const BRAND_NORMALIZE = {
  mol: 'MOL',
  omv: 'OMV',
  shell: 'Shell',
  auchan: 'Auchan',
  avia: 'AVIA',
  orlen: 'Orlen',
  aldi: 'ALDI',
};

function normalizeBrand(raw) {
  if (!raw) return 'Station';
  const lower = raw.toLowerCase().trim();
  return BRAND_NORMALIZE[lower] || raw.trim();
}

function buildFormBody(county, fuelParam) {
  const params = new URLSearchParams();
  params.append('nume_locatie', county);
  params.append('carburant', fuelParam);
  params.append('locatie', 'Judet');
  for (const brand of BRANDS_QUERY) {
    params.append('retele[]', brand);
  }
  return params.toString();
}

function parseStationsFromHTML(html) {
  const match = html.match(/var\s+rezultate\s*=\s*JSON\.parse\('(.+?)'\)/);
  if (!match) return [];
  try {
    const raw = match[1].replace(/\\'/g, "'").replace(/\\"/g, '"');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data;
  } catch {
    return [];
  }
}

async function fetchCounty(county, fuelParam) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: buildFormBody(county, fuelParam),
  });
  if (!res.ok) return [];
  const html = await res.text();
  return parseStationsFromHTML(html);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Refresh (cron) ─────────────────────────────────────────────────

export async function refresh(env) {
  const stationMap = new Map(); // key: "lat,lng" → station object

  for (const fuel of FUEL_TYPES) {
    // Process counties in batches of 5
    for (let i = 0; i < COUNTIES.length; i += 5) {
      const batch = COUNTIES.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map((county) => fetchCounty(county, fuel.param))
      );

      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        for (const entry of result.value) {
          // entry = [brand, lat, lng, city, address, price]
          const [rawBrand, lat, lng, city, address, price] = entry;
          const numLat = parseFloat(lat);
          const numLng = parseFloat(lng);
          const numPrice = parseFloat(price);
          if (isNaN(numLat) || isNaN(numLng)) continue;

          const key = `${numLat},${numLng}`;
          if (!stationMap.has(key)) {
            stationMap.set(key, {
              id: `HU-${numLat}-${numLng}`,
              brand: normalizeBrand(rawBrand),
              address: address || '',
              city: city || '',
              lat: numLat,
              lng: numLng,
              country: COUNTRY,
              prices: {},
              updatedAt: new Date().toISOString(),
            });
          }

          const station = stationMap.get(key);
          if (!isNaN(numPrice) && numPrice > 0) {
            station.prices[fuel.key] = numPrice;
          }
        }
      }

      // Small delay between batches to avoid overwhelming the source
      if (i + 5 < COUNTIES.length) await delay(500);
    }
  }

  // Filter out stations with no prices
  const stations = [...stationMap.values()].filter(
    (s) => Object.keys(s.prices).length > 0
  );

  console.log(`[HU] Refreshed ${stations.length} stations from ${stationMap.size} total`);
  await putStations(COUNTRY, stations, env);
}

// ── Query handler ──────────────────────────────────────────────────

export async function handleQuery(url, env) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radiusKm = parseFloat(url.searchParams.get('radius') || '15');

  const allStations = await getStations(COUNTRY, env);
  if (!allStations) return json({ error: 'Data not yet cached, try again later' }, 503);

  const filtered = filterByDistance(allStations, lat, lng, radiusKm);
  return json({ stations: filtered, count: filtered.length });
}
