/**
 * Norway — Drivstoffapp V2 API (backend.drivstoffapp.no).
 *
 * Free public API, no auth required.
 * POST /stations/search returns fuel stations with prices and coordinates.
 *
 * Tier B: proxy + grid-cache pattern.
 * Country code: NO
 */

import { filterByDistance, gridCell } from '../lib/geo.js';
import { json } from '../lib/response.js';
import { getGridCache, putGridCache } from '../lib/kv.js';

const COUNTRY = 'NO';
const API_URL = 'https://backend.drivstoffapp.no/stations/search';

// Extract brand name from logo URL filename
// e.g. "https://.../.../uno_x_ppf9f3vu9b.png" → "Uno-X"
const LOGO_BRAND_MAP = {
  circle_k: 'Circle K',
  circle_k_automat: 'Circle K',
  uno_x: 'Uno-X',
  esso: 'Esso',
  esso_express: 'Esso',
  shell: 'Shell',
  st_1: 'St1',
  automat_1: 'Automat 1',
  best: 'Best',
  yx: 'YX',
  coop: 'Coop',
  bunker_oil: 'Bunker Oil',
};

function extractBrand(logoUrl, stationName) {
  if (logoUrl) {
    // Get filename without extension: "uno_x_ppf9f3vu9b.png" → "uno_x_ppf9f3vu9b"
    const filename = logoUrl.split('/').pop()?.split('.')[0] || '';
    // Try matching progressively shorter prefixes
    for (const [prefix, brand] of Object.entries(LOGO_BRAND_MAP)) {
      if (filename.startsWith(prefix)) return brand;
    }
  }
  // Fallback: use station name
  return stationName || 'Station';
}

async function fetchStations(lat, lng, radiusKm) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; FuelSaver/1.0)',
    },
    body: JSON.stringify({
      latitude: lat,
      longitude: lng,
      radius_km: Math.min(radiusKm, 50),
      station_type: 'fuel',
      sort_by_fuel: 'distance',
    }),
  });

  if (!res.ok) return [];
  const data = await res.json();
  const raw = data.fuel_stations || [];

  return raw.map((s) => {
    const loc = s.location || {};
    if (!loc.latitude || !loc.longitude) return null;

    const prices = {};
    const p = s.prices || {};
    if (p.gasoline_95_price != null && p.gasoline_95_price > 0 && p.gasoline_95_price < 50) {
      prices.gasoline_95 = p.gasoline_95_price;
    }
    if (p.diesel_price != null && p.diesel_price > 0 && p.diesel_price < 50) {
      prices.diesel = p.diesel_price;
    }

    const brand = extractBrand(s.logo || s.station_link, s.station_name || s.name);

    return {
      id: `NO-${s.id}`,
      brand,
      name: s.station_name || s.name || brand,
      address: s.street || loc.address || '',
      city: s.city || '',
      lat: loc.latitude,
      lng: loc.longitude,
      country: COUNTRY,
      prices,
      updatedAt: p.last_updated || s.updated || null,
    };
  }).filter(Boolean);
}

export async function handleQuery(url, env) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radiusKm = parseFloat(url.searchParams.get('radius') || '15');

  const grid = gridCell(lat, lng);
  const cacheKey = `cache:${COUNTRY}:${grid.lat}:${grid.lng}`;

  const cached = await getGridCache(cacheKey, env);
  if (cached) {
    const filtered = filterByDistance(cached, lat, lng, radiusKm);
    return json({ stations: filtered, count: filtered.length });
  }

  // Fetch with larger radius to fill grid cell, then cache
  const stations = await fetchStations(grid.lat, grid.lng, 25);
  await putGridCache(cacheKey, stations, env, 600);

  const filtered = filterByDistance(stations, lat, lng, radiusKm);
  return json({ stations: filtered, count: filtered.length });
}
