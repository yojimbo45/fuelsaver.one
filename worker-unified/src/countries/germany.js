/**
 * Germany — Tier A (bulk-cached).
 *
 * Systematically crawls Tankerkoenig list.php across a grid covering all of Germany.
 * Cron refreshes every 4 hours, stores all stations in KV.
 * Queries read from KV + filterByDistance (same pattern as France).
 */

import { filterByDistance } from '../lib/geo.js';
import { json } from '../lib/response.js';
import { getStations, putStations } from '../lib/kv.js';

const COUNTRY = 'DE';
const API_BASE = 'https://creativecommons.tankerkoenig.de/json/list.php';

// Germany bounding box (with small padding)
const BOUNDS = { latMin: 47.2, latMax: 55.1, lngMin: 5.8, lngMax: 15.1 };

// Grid step: 1.6° ≈ 178km. With 50km API radius gives partial coverage.
// ~30 cells → 6 parallel × 5 batches ≈ 8s. Captures major cities.
const GRID_STEP = 1.6;
const API_RADIUS = 50;

function normalizeStation(s) {
  const prices = {};
  if (s.e5 != null) prices.e5 = s.e5;
  if (s.e10 != null) prices.e10 = s.e10;
  if (s.diesel != null) prices.diesel = s.diesel;

  return {
    id: `DE-${s.id}`,
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

// ─── Cron: crawl all of Germany ─────────────────────────────────────
export async function refresh(env) {
  if (!env.TANKERKOENIG_KEY) {
    throw new Error('TANKERKOENIG_KEY not configured');
  }

  // Build grid of points covering Germany
  const points = [];
  for (let lat = BOUNDS.latMin; lat <= BOUNDS.latMax; lat += GRID_STEP) {
    for (let lng = BOUNDS.lngMin; lng <= BOUNDS.lngMax; lng += GRID_STEP) {
      points.push({ lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 });
    }
  }

  console.log(`[DE] Crawling ${points.length} grid cells...`);

  const allStations = new Map(); // dedupe by raw ID
  let fetched = 0;
  let errors = 0;

  // Fetch in batches of 6 (Cloudflare Workers concurrent connection limit)
  for (let i = 0; i < points.length; i += 6) {
    const batch = points.slice(i, i + 6);
    const results = await Promise.allSettled(
      batch.map(async ({ lat, lng }) => {
        const url = `${API_BASE}?lat=${lat}&lng=${lng}&rad=${API_RADIUS}&sort=dist&type=all&apikey=${env.TANKERKOENIG_KEY}`;
        const res = await fetch(url);
        // Always consume body to free the connection
        const text = await res.text();
        if (!res.ok) return [];
        try {
          const data = JSON.parse(text);
          if (!data.ok) return [];
          return data.stations || [];
        } catch { return []; }
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        for (const s of r.value) {
          if (!allStations.has(s.id)) {
            allStations.set(s.id, normalizeStation(s));
          }
        }
        fetched++;
      } else {
        errors++;
      }
    }
  }

  const stations = Array.from(allStations.values());
  const msg = `[DE] Crawled ${fetched} cells (${errors} errors), ${stations.length} unique stations`;
  console.log(msg);

  if (stations.length === 0) {
    // Debug: test a single cell to see what the API returns
    const testUrl = `${API_BASE}?lat=52.52&lng=13.40&rad=10&sort=dist&type=all&apikey=${env.TANKERKOENIG_KEY}`;
    const testRes = await fetch(testUrl);
    const testBody = await testRes.text();
    throw new Error(msg + ` — debug: status=${testRes.status} body=${testBody.slice(0, 300)}`);
  }

  await putStations(COUNTRY, stations, env);
}

// ─── Query: read from KV, filter, return ────────────────────────────
export async function handleQuery(url, env) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radiusKm = parseFloat(url.searchParams.get('radius') || '15');

  const allStations = await getStations(COUNTRY, env);
  if (!allStations) return json({ error: 'Data not yet cached. Trigger /cron first.' }, 503);

  const filtered = filterByDistance(allStations, lat, lng, radiusKm);
  return json({ stations: filtered, count: filtered.length });
}
