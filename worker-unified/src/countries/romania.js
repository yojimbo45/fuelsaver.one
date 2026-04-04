/**
 * Romania — PretCarburant.ro scraper.
 *
 * Single page load contains all ~1,408 stations as a JS array (const allStatii = [...]).
 * Prices in RON per litre.
 *
 * Tier A: bulk-cache with cron refresh.
 * Country code: RO
 */

import { filterByDistance } from '../lib/geo.js';
import { json } from '../lib/response.js';
import { getStations, putStations } from '../lib/kv.js';

const COUNTRY = 'RO';
const SOURCE_URL = 'https://pretcarburant.ro/en/map';

const BRAND_NORMALIZE = {
  petrom: 'Petrom',
  lukoil: 'Lukoil',
  mol: 'MOL',
  rompetrol: 'Rompetrol',
  omv: 'OMV',
  socar: 'Socar',
  gazprom: 'Gazprom',
};

const FUEL_MAP = {
  benzina_standard: 'benzina95',
  benzina_premium: 'benzina_premium',
  motorina_standard: 'diesel',
  motorina_premium: 'diesel_premium',
  gpl: 'gpl',
};

function normalizeBrand(raw) {
  if (!raw) return 'Station';
  const key = raw.toLowerCase().trim();
  return BRAND_NORMALIZE[key] || raw.trim();
}

// ─── Cron: fetch page, extract JSON, normalise, store in KV ────────
export async function refresh(env) {
  const res = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FuelSaver/1.0)' },
  });
  if (!res.ok) throw new Error(`PretCarburant.ro returned ${res.status}`);

  const html = await res.text();
  const match = html.match(/const allStatii\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error('Could not extract allStatii from PretCarburant.ro');

  const raw = JSON.parse(match[1]);
  const now = new Date().toISOString();

  const stations = raw
    .map((s, i) => {
      const lat = parseFloat(s.lat);
      const lng = parseFloat(s.lng);
      if (isNaN(lat) || isNaN(lng)) return null;

      const prices = {};
      if (s.p) {
        for (const [src, dest] of Object.entries(FUEL_MAP)) {
          const val = s.p[src];
          if (val != null && val > 0) prices[dest] = val;
        }
      }
      if (Object.keys(prices).length === 0) return null;

      return {
        id: `RO-${s.slug || i}`,
        brand: normalizeBrand(s.brand),
        address: s.adresa || '',
        city: s.oras || '',
        lat,
        lng,
        country: COUNTRY,
        prices,
        updatedAt: now,
      };
    })
    .filter(Boolean);

  await putStations(COUNTRY, stations, env);
  console.log(`[RO] Refreshed ${stations.length} stations from ${raw.length} raw`);
}

// ─── Query ──────────────────────────────────────────────────────────
export async function handleQuery(url, env) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radiusKm = parseFloat(url.searchParams.get('radius') || '15');

  const allStations = await getStations(COUNTRY, env);
  if (!allStations) return json({ error: 'Data not yet cached, try again later' }, 503);

  const filtered = filterByDistance(allStations, lat, lng, radiusKm);
  return json({ stations: filtered, count: filtered.length });
}
