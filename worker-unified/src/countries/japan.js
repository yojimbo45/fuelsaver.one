/**
 * Japan — gogo.gs API (stations + prices).
 *
 * Tier B: proxy + grid-cache pattern.
 * gogo.gs is Japan's largest crowdsourced gas price site (~25K stations).
 * API is free, no key required — uses a public application ID.
 */

import { filterByDistance, gridCell } from '../lib/geo.js';
import { json } from '../lib/response.js';
import { getGridCache, putGridCache } from '../lib/kv.js';

const COUNTRY = 'JP';
const API_BASE = 'https://gogo.gs/api/shop/search/around.json';
const APID = '724a4fc444487d33817d868aa1b5b5cb';

// gogo.gs ss_maker codes → brand names
const MAKER_MAP = {
  '3': 'ENEOS',
  '4': 'Shell',
  '8': 'apollostation',
  '21': 'Solato',
  '22': 'Cosmo',
  '24': 'Kygnus',
  '25': 'ENEOS',
  '26': 'ENEOS',
};

function parseStation(s) {
  const lat = parseFloat(s.lat);
  const lng = parseFloat(s.lon);
  if (isNaN(lat) || isNaN(lng)) return null;

  const prices = {};
  if (s.price_n_r != null && s.price_n_r > 0) prices.regular = parseFloat(s.price_n_r);
  if (s.price_n_h != null && s.price_n_h > 0) prices.premium = parseFloat(s.price_n_h);
  if (s.price_n_k != null && s.price_n_k > 0) prices.diesel = parseFloat(s.price_n_k);

  if (Object.keys(prices).length === 0) return null;

  return {
    id: `JP-${s.ss_id}`,
    brand: MAKER_MAP[String(s.ss_maker)] || '',
    name: s.ss_name || '',
    address: s.ss_address || '',
    city: '',
    lat,
    lng,
    country: COUNTRY,
    prices,
    updatedAt: s.price_n_r_date || null,
  };
}

export async function handleQuery(url, env) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radiusKm = parseFloat(url.searchParams.get('radius') || '15');

  const grid = gridCell(lat, lng);
  const cacheKey = `cache:${COUNTRY}:${grid.lat}:${grid.lng}`;

  let stations = await getGridCache(cacheKey, env);
  if (!stations || !stations.length) {
    // Build bounding box around grid cell (~11km per 0.1°)
    const delta = 0.08;
    const params = new URLSearchParams({
      apid: APID,
      lat: String(grid.lat),
      lon: String(grid.lng),
      min_lat: String(grid.lat - delta),
      max_lat: String(grid.lat + delta),
      min_lon: String(grid.lng - delta),
      max_lon: String(grid.lng + delta),
      price: 'regular',
      price_type: 'cash',
      limit: '100',
    });

    const res = await fetch(`${API_BASE}?${params}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'ja,en;q=0.9',
        Referer: 'https://gogo.gs/',
      },
    });
    if (!res.ok) {
      return json({ error: `gogo.gs API returned ${res.status}` }, 502);
    }

    const data = await res.json();
    const list = data?.Result || [];

    stations = list.map(parseStation).filter(Boolean);
    if (stations.length) await putGridCache(cacheKey, stations, env, 600);
  }

  const filtered = filterByDistance(stations, lat, lng, radiusKm);
  return json({ stations: filtered, count: filtered.length });
}
