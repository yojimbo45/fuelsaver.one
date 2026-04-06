/**
 * Tankerkoenig — DE, HR, LU, PT, SI.
 *
 * Real-time fuel prices via the Tankerkoenig Creative Commons API.
 * Country code is passed as the 3rd argument to handleQuery.
 *
 * Tier B: proxy + grid-cache pattern.
 * Supports spread mode: makes multiple parallel API calls across the viewport.
 */

import { filterByDistance, filterSpread, gridCell } from '../lib/geo.js';
import { json } from '../lib/response.js';
import { getGridCache, putGridCache } from '../lib/kv.js';

const API_BASE = 'https://creativecommons.tankerkoenig.de/json/list.php';

function normalizeStation(s, cc) {
  const prices = {};
  if (s.e5 != null) prices.e5 = s.e5;
  if (s.e10 != null) prices.e10 = s.e10;
  if (s.diesel != null) prices.diesel = s.diesel;

  return {
    id: `${cc}-${s.id}`,
    brand: s.brand || '',
    address: `${s.street || ''} ${s.houseNumber || ''}`.trim(),
    city: `${s.postCode || ''} ${s.place || ''}`.trim(),
    lat: s.lat,
    lng: s.lng,
    prices,
    updatedAt: null,
    isOpen: s.isOpen,
    is24h: s.wholeDay,
  };
}

async function fetchGridCell(grid, cc, env) {
  const cacheKey = `cache:${cc}:${grid.lat}:${grid.lng}`;

  const cached = await getGridCache(cacheKey, env);
  if (cached) return cached;

  try {
    const apiUrl = `${API_BASE}?lat=${grid.lat}&lng=${grid.lng}&rad=25&sort=dist&type=all&apikey=${env.TANKERKOENIG_KEY}`;
    const res = await fetch(apiUrl);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.ok) return [];

    const stations = (data.stations || []).map((s) => normalizeStation(s, cc));
    await putGridCache(cacheKey, stations, env, 300);
    return stations;
  } catch {
    return [];
  }
}

export async function handleQuery(url, env, countryCode) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radiusKm = parseFloat(url.searchParams.get('radius') || '15');
  const spread = url.searchParams.get('spread') === 'true';

  if (!env.TANKERKOENIG_KEY) {
    return json({ error: 'Tankerkoenig API key not configured' }, 503);
  }

  const cc = countryCode.toUpperCase();

  // Spread mode: sample multiple grid cells across the viewport
  if (spread && radiusKm > 25) {
    const dLat = radiusKm / 111;
    const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

    // Space grid points ~80km apart to stay within API rate limits
    const step = 0.7; // ~78km
    const points = [];
    for (let la = lat - dLat; la <= lat + dLat; la += step) {
      for (let ln = lng - dLng; ln <= lng + dLng; ln += step) {
        points.push(gridCell(la, ln));
      }
    }
    // Always include center cell
    points.unshift(gridCell(lat, lng));

    // Dedupe, sort by distance to center (so center cells are fetched first if rate-limited)
    const uniquePoints = [...new Map(points.map(p => [`${p.lat}:${p.lng}`, p])).values()]
      .sort((a, b) => (Math.abs(a.lat - lat) + Math.abs(a.lng - lng)) - (Math.abs(b.lat - lat) + Math.abs(b.lng - lng)))
      .slice(0, 9);

    // Fetch grid cells: first 5 in parallel, then next batch
    const allStations = [];
    for (let i = 0; i < uniquePoints.length; i += 5) {
      const batch = uniquePoints.slice(i, i + 5);
      const results = await Promise.all(batch.map(g => fetchGridCell(g, cc, env)));
      allStations.push(...results.flat());
    }

    // Deduplicate by station ID
    const seen = new Set();
    const deduped = allStations.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

    const filtered = filterSpread(deduped, lat, lng, radiusKm);
    return json({ stations: filtered, count: filtered.length });
  }

  // Normal mode: single grid cell fetch
  const grid = gridCell(lat, lng);
  const cacheKey = `cache:${cc}:${grid.lat}:${grid.lng}`;

  const cached = await getGridCache(cacheKey, env);
  if (cached) {
    const filtered = filterByDistance(cached, lat, lng, radiusKm);
    return json({ stations: filtered, count: filtered.length });
  }

  const apiUrl = `${API_BASE}?lat=${grid.lat}&lng=${grid.lng}&rad=25&sort=dist&type=all&apikey=${env.TANKERKOENIG_KEY}`;
  const res = await fetch(apiUrl);
  const data = await res.json();

  if (!data.ok) {
    throw new Error(`Tankerkoenig API error: ${data.message || 'unknown'}`);
  }

  const stations = (data.stations || []).map((s) => normalizeStation(s, cc));
  await putGridCache(cacheKey, stations, env, 300);

  const filtered = filterByDistance(stations, lat, lng, radiusKm);
  return json({ stations: filtered, count: filtered.length });
}
