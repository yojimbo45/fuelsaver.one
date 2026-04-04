/**
 * Turkey — OPET REST API (province-level prices) + OpenStreetMap (stations).
 *
 * Tier A hybrid: prices refreshed via cron every 4 hours,
 * station locations from OSM Overpass (grid-cached on demand).
 *
 * OPET is Turkey's 2nd largest fuel distributor. Prices are EPDK-regulated
 * and nearly uniform across brands within a province, so OPET prices
 * serve as a good reference for all brands.
 */

import { filterByDistance, gridCell } from '../lib/geo.js';
import { json } from '../lib/response.js';
import { getGridCache, putGridCache } from '../lib/kv.js';
import { queryOverpass } from '../lib/overpass.js';

const COUNTRY = 'TR';

// ── OPET API ──────────────────────────────────────────────────────

const OPET_API = 'https://api.opet.com.tr/api/fuelprices';
const OPET_HEADERS = {
  Origin: 'https://www.opet.com.tr',
  Host: 'api.opet.com.tr',
  Channel: 'Web',
  'Accept-Language': 'tr-TR',
  Accept: 'application/json',
};

// Map OPET productName → fuel type ID
const FUEL_MAP = {
  'kurşunsuz 95': 'benzin95',
  'kursünsuz 95': 'benzin95',
  'kursunsuz 95': 'benzin95',
  'benzin 95': 'benzin95',
  'gasoil': 'motorin',
  'motorin': 'motorin',
  'euro diesel': 'motorin',
  'dizel': 'motorin',
  'lpg': 'lpg',
  'otogaz': 'lpg',
  'lpg (otogaz)': 'lpg',
};

// 10 key provinces covering Turkey's geography
const PROVINCE_CENTERS = [
  { code: '34', name: 'Istanbul', lat: 41.01, lng: 28.97 },
  { code: '06', name: 'Ankara', lat: 39.93, lng: 32.86 },
  { code: '35', name: 'Izmir', lat: 38.42, lng: 27.14 },
  { code: '07', name: 'Antalya', lat: 36.90, lng: 30.69 },
  { code: '16', name: 'Bursa', lat: 40.19, lng: 29.06 },
  { code: '01', name: 'Adana', lat: 37.00, lng: 35.33 },
  { code: '61', name: 'Trabzon', lat: 41.00, lng: 39.72 },
  { code: '21', name: 'Diyarbakir', lat: 37.91, lng: 40.22 },
  { code: '42', name: 'Konya', lat: 37.87, lng: 32.48 },
  { code: '55', name: 'Samsun', lat: 41.29, lng: 36.33 },
];

// Fallback prices (TRY/L, approximate) if OPET API is unreachable
const DEFAULT_PRICES = {
  benzin95: { price: 44.00 },
  motorin: { price: 45.50 },
  lpg: { price: 17.50 },
};

// ── Brand mapping ──────────────────────────────────────────────────

const BRAND_MAP = {
  'petrol ofisi': 'Petrol Ofisi', po: 'Petrol Ofisi',
  opet: 'Opet', 'opet fuchs': 'Opet',
  shell: 'Shell',
  bp: 'BP',
  aytemiz: 'Aytemiz',
  tp: 'TP', 'türkiye petrolleri': 'TP', 'turkiye petrolleri': 'TP',
  totalenergies: 'TotalEnergies', total: 'TotalEnergies',
  lukoil: 'Lukoil',
  alpet: 'Alpet',
  moil: 'Moil',
  sunpet: 'Sunpet',
  kadoil: 'Kadoil',
  'go petrol': 'GO Petrol',
  milangaz: 'Milangaz',
};

// ── Fetch OPET prices ─────────────────────────────────────────────

async function fetchProvincePrices(provinceCode) {
  const res = await fetch(
    `${OPET_API}/prices?ProvinceCode=${provinceCode}&IncludeAllProducts=true`,
    { headers: OPET_HEADERS, signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) return null;

  const data = await res.json();
  const prices = {};

  // data is typically an array of { productName, amount, ... }
  const items = Array.isArray(data) ? data : data.products || data.prices || [];
  for (const item of items) {
    const name = (item.productName || item.ProductName || item.name || '').toLowerCase().trim();
    const amount = parseFloat(item.amount || item.Amount || item.price || item.Price);
    if (isNaN(amount) || amount <= 0) continue;

    const fuelId = FUEL_MAP[name];
    if (fuelId) {
      prices[fuelId] = { price: Math.round(amount * 100) / 100 };
    }
  }

  return Object.keys(prices).length > 0 ? prices : null;
}

// ── Station mapping ────────────────────────────────────────────────

function mapElements(elements) {
  return elements.map((el) => {
    const elLat = el.lat || el.center?.lat;
    const elLng = el.lon || el.center?.lon;
    if (!elLat || !elLng) return null;

    const tags = el.tags || {};
    const rawBrand = (tags.brand || tags.operator || tags.name || 'Station').trim();
    const brand = BRAND_MAP[rawBrand.toLowerCase()] || rawBrand;

    return {
      id: `TR-${el.id}`,
      brand,
      name: tags.name || brand,
      address: [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' '),
      city: tags['addr:city'] || tags['addr:suburb'] || '',
      lat: elLat,
      lng: elLng,
      country: COUNTRY,
      prices: {},   // applied at query time
      updatedAt: null,
    };
  }).filter(Boolean);
}

// ── Province matching ──────────────────────────────────────────────

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestProvince(lat, lng, provinces) {
  let nearest = provinces[0];
  let minDist = Infinity;
  for (const p of provinces) {
    const d = haversine(lat, lng, p.lat, p.lng);
    if (d < minDist) {
      minDist = d;
      nearest = p;
    }
  }
  return nearest.code;
}

function applyPrices(stations, provinceData) {
  if (!provinceData || !provinceData.provinces) {
    return stations.map(s => ({ ...s, prices: DEFAULT_PRICES }));
  }

  const provinces = Object.values(provinceData.provinces);
  return stations.map((s) => {
    const code = findNearestProvince(s.lat, s.lng, provinces);
    const prov = provinceData.provinces[code];
    const prices = prov?.prices || DEFAULT_PRICES;
    return { ...s, prices };
  });
}

// ── Refresh (cron) ─────────────────────────────────────────────────

export async function refresh(env) {
  try {
    const results = await Promise.allSettled(
      PROVINCE_CENTERS.map(async (prov) => {
        const prices = await fetchProvincePrices(prov.code);
        return { ...prov, prices };
      })
    );

    const provinces = {};
    let successCount = 0;
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.prices) {
        const { code, name, lat, lng, prices } = r.value;
        provinces[code] = { code, name, lat, lng, prices };
        successCount++;
      }
    }

    if (successCount > 0) {
      const store = { provinces, updatedAt: new Date().toISOString() };
      await env.FUEL_KV.put('prices:TR', JSON.stringify(store));
      console.log(`[TR] Refreshed ${successCount}/${PROVINCE_CENTERS.length} province prices`);
    } else {
      console.warn('[TR] All province fetches failed — keeping cached data');
    }
  } catch (e) {
    console.error('[TR] Price refresh failed:', e);
  }
}

// ── Query handler ──────────────────────────────────────────────────

export async function handleQuery(url, env) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radiusKm = parseFloat(url.searchParams.get('radius') || '15');

  const provinceData = await env.FUEL_KV.get('prices:TR', { type: 'json' });

  const grid = gridCell(lat, lng);
  const cacheKey = `cache:${COUNTRY}:${grid.lat}:${grid.lng}`;

  let stations = await getGridCache(cacheKey, env);
  if (!stations) {
    try {
      const radiusM = Math.min(radiusKm * 1000, 25000);
      const elements = await queryOverpass(grid.lat, grid.lng, radiusM);
      stations = mapElements(elements);
      await putGridCache(cacheKey, stations, env, 3600);
    } catch (e) {
      console.error('[TR] Overpass failed:', e.message);
      stations = [];
    }
  }

  const priced = applyPrices(stations, provinceData);
  const filtered = filterByDistance(priced, lat, lng, radiusKm);
  return json({ stations: filtered, count: filtered.length });
}
