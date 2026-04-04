/**
 * Czech Republic — ceskybenzin.cz (crowdsourced fuel prices).
 *
 * Tier A: bulk-cached via cron. Station data is embedded in map pages
 * as a `var ceny = {...}` JS object, one page per fuel type.
 *
 * Country code: CZ
 */

import { filterByDistance } from '../lib/geo.js';
import { json } from '../lib/response.js';
import { getStations, putStations } from '../lib/kv.js';

const COUNTRY = 'CZ';
const BASE_URL = 'https://www.ceskybenzin.cz/mapa.php';

const FUEL_TYPES = [
  { param: 'typ_palivo=1', key: 'natural95' },
  { param: 'typ_palivo=3', key: 'diesel' },
  { param: 'typ_palivo=5', key: 'lpg' },
];

const BRAND_NORMALIZE = {
  mol: 'MOL',
  omv: 'OMV',
  shell: 'Shell',
  orlen: 'Orlen',
  eni: 'Eni',
  'euro oil': 'EuroOil',
};

function normalizeBrand(raw) {
  if (!raw) return 'Station';
  const key = raw.toLowerCase().trim();
  return BRAND_NORMALIZE[key] || raw.trim();
}

/** Parse DD.MM.YYYY → ISO string, or null. */
function parseDate(str) {
  if (!str) return null;
  const m = str.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Extract `var ceny = {...};` from HTML and JSON.parse it. */
function extractCeny(html) {
  const m = html.match(/var\s+ceny\s*=\s*(\{[\s\S]*?\});/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

// ─── Refresh: fetch all fuel pages, merge, store in KV ────────────
export async function refresh(env) {
  const responses = await Promise.all(
    FUEL_TYPES.map(({ param }) =>
      fetch(`${BASE_URL}?${param}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FuelSaver/1.0)' },
      })
    )
  );

  const stationMap = new Map();

  for (let i = 0; i < FUEL_TYPES.length; i++) {
    const res = responses[i];
    const { key } = FUEL_TYPES[i];
    if (!res.ok) {
      console.error(`[CZ] Failed to fetch ${key}: ${res.status}`);
      continue;
    }

    const html = await res.text();
    const ceny = extractCeny(html);
    if (!ceny) {
      console.error(`[CZ] Could not extract ceny for ${key}`);
      continue;
    }

    for (const [stationId, s] of Object.entries(ceny)) {
      const lat = parseFloat(s.x);
      const lng = parseFloat(s.y);
      if (isNaN(lat) || isNaN(lng)) continue;

      if (!stationMap.has(stationId)) {
        stationMap.set(stationId, {
          id: `CZ-${stationId}`,
          brand: normalizeBrand(s.nazev),
          name: s.nazev || '',
          address: '',
          city: '',
          lat,
          lng,
          country: COUNTRY,
          prices: {},
          updatedAt: parseDate(s.z_dne),
        });
      }

      const station = stationMap.get(stationId);
      const price = parseFloat(s.cena);
      if (!isNaN(price) && price > 0) {
        station.prices[key] = price;
      }

      // Keep most recent date
      const date = parseDate(s.z_dne);
      if (date && (!station.updatedAt || date > station.updatedAt)) {
        station.updatedAt = date;
      }
    }
  }

  // Filter out stations with no prices
  const stations = Array.from(stationMap.values()).filter(
    (s) => Object.keys(s.prices).length > 0
  );

  await putStations(COUNTRY, stations, env);
  console.log(`[CZ] Refreshed ${stations.length} stations`);
}

// ─── Query handler (Tier A pattern) ────────────────────────────────
export async function handleQuery(url, env) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radiusKm = parseFloat(url.searchParams.get('radius') || '15');

  const allStations = await getStations(COUNTRY, env);
  if (!allStations) return json({ error: 'Data not yet cached, try again later' }, 503);

  const filtered = filterByDistance(allStations, lat, lng, radiusKm);
  return json({ stations: filtered, count: filtered.length });
}
