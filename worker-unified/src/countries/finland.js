/**
 * Finland — Neste station-search API + Overpass for non-Neste chains.
 *
 * Neste API: free, no auth, 660+ stations with coordinates (Neste only).
 * Overpass: all other chains (St1, Shell, ABC, Teboil, etc.) with locations.
 * No public price API available — stations shown without prices.
 *
 * Tier B: proxy + grid-cache pattern.
 * Country code: FI
 */

import { filterByDistance, gridCell } from '../lib/geo.js';
import { json } from '../lib/response.js';
import { getGridCache, putGridCache } from '../lib/kv.js';
import { queryOverpass } from '../lib/overpass.js';

const COUNTRY = 'FI';
const NESTE_API = 'https://asemat.neste.fi/api/station-search?country=FIN';

const BRAND_MAP = {
  neste: 'Neste', 'neste k': 'Neste', 'neste express': 'Neste',
  st1: 'St1', shell: 'Shell', teboil: 'Teboil',
  abc: 'ABC', seo: 'SEO',
};

function normalizeBrand(raw) {
  if (!raw) return 'Station';
  const lower = raw.toLowerCase().trim();
  for (const [k, v] of Object.entries(BRAND_MAP)) {
    if (lower.includes(k)) return v;
  }
  return raw.trim();
}

// Fetch Neste stations (has coordinates, no prices)
async function fetchNesteStations(lat, lng, radiusKm) {
  try {
    const res = await fetch(NESTE_API, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FuelSaver/1.0)' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data
      .filter((s) => s.hasFuels && s.location?.coordinates?.length === 2)
      .map((s) => {
        const [lng, lat] = s.location.coordinates;
        return {
          id: `FI-neste-${s.stationNumber}`,
          brand: 'Neste',
          name: s.stationName || 'Neste',
          address: s.address || '',
          city: s.municipality || '',
          lat,
          lng,
          country: COUNTRY,
          prices: {},
          updatedAt: null,
        };
      });
  } catch {
    return [];
  }
}

// Fetch other chains from Overpass
async function fetchOverpassStations(lat, lng, radiusM) {
  try {
    const elements = await queryOverpass(lat, lng, radiusM);
    return elements.map((el) => {
      const elLat = el.lat || el.center?.lat;
      const elLng = el.lon || el.center?.lon;
      if (!elLat || !elLng) return null;

      const tags = el.tags || {};
      const brand = normalizeBrand(tags.brand || tags.name || '');

      return {
        id: `FI-${el.id}`,
        brand,
        name: tags.name || brand,
        address: [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' '),
        city: tags['addr:city'] || '',
        lat: elLat,
        lng: elLng,
        country: COUNTRY,
        prices: {},
        updatedAt: null,
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

export async function handleQuery(url, env) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radiusKm = parseFloat(url.searchParams.get('radius') || '15');

  const grid = gridCell(lat, lng);
  const cacheKey = `cache:${COUNTRY}:${grid.lat}:${grid.lng}`;

  const cached = await getGridCache(cacheKey, env);
  if (cached && cached.length) {
    const filtered = filterByDistance(cached, lat, lng, radiusKm);
    return json({ stations: filtered, count: filtered.length });
  }

  // Fetch Neste + Overpass in parallel
  const [nesteAll, overpassStations] = await Promise.all([
    fetchNesteStations(grid.lat, grid.lng, radiusKm),
    fetchOverpassStations(grid.lat, grid.lng, Math.min(radiusKm * 1000, 25000)),
  ]);

  // Filter Neste stations by distance first (API returns all 660)
  const nesteNearby = filterByDistance(nesteAll, grid.lat, grid.lng, 25);

  // Merge: Overpass first, then add Neste stations not already present
  const seen = new Set();
  const stations = [];

  for (const s of overpassStations) {
    stations.push(s);
    // Track by approximate location to dedupe
    seen.add(`${s.lat.toFixed(3)},${s.lng.toFixed(3)}`);
  }

  for (const s of nesteNearby) {
    const key = `${s.lat.toFixed(3)},${s.lng.toFixed(3)}`;
    if (!seen.has(key)) {
      stations.push(s);
      seen.add(key);
    }
  }

  if (stations.length) await putGridCache(cacheKey, stations, env, 600);

  const filtered = filterByDistance(stations, lat, lng, radiusKm);
  return json({ stations: filtered, count: filtered.length });
}
