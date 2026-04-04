/**
 * Sweden — Henrik Hjelm API (bensinpriser) + Overpass hybrid.
 *
 * Locations from Overpass (per grid cell), prices from henrikhjelm.se API.
 * Matched by brand + normalized city name.
 *
 * Tier B: proxy + grid-cache pattern.
 * Country code: SE
 */

import { filterByDistance, gridCell } from '../lib/geo.js';
import { json } from '../lib/response.js';
import { getGridCache, putGridCache } from '../lib/kv.js';
import { queryOverpass } from '../lib/overpass.js';

const COUNTRY = 'SE';
const PRICE_API = 'https://henrikhjelm.se/api/getdata.php';

// Map Swedish county to the API county slug based on lat/lng
const COUNTY_GRID = [
  { name: 'norrbottens-lan', minLat: 65, maxLat: 70, minLng: 15, maxLng: 25 },
  { name: 'vasterbottens-lan', minLat: 63.5, maxLat: 65.5, minLng: 14, maxLng: 22 },
  { name: 'jamtlands-lan', minLat: 62, maxLat: 66, minLng: 12, maxLng: 17 },
  { name: 'vasternorrlands-lan', minLat: 62, maxLat: 64, minLng: 16, maxLng: 20 },
  { name: 'gavleborgs-lan', minLat: 60.5, maxLat: 62.5, minLng: 14, maxLng: 18 },
  { name: 'dalarnas-lan', minLat: 60, maxLat: 62.5, minLng: 12, maxLng: 16 },
  { name: 'varmlands-lan', minLat: 59, maxLat: 61, minLng: 11.5, maxLng: 14 },
  { name: 'orebro-lan', minLat: 58.5, maxLat: 60, minLng: 14, maxLng: 16 },
  { name: 'vastmanlands-lan', minLat: 59, maxLat: 60.5, minLng: 15.5, maxLng: 17 },
  { name: 'uppsala-lan', minLat: 59.5, maxLat: 61, minLng: 17, maxLng: 19 },
  { name: 'stockholms-lan', minLat: 58.5, maxLat: 60, minLng: 17.5, maxLng: 19.5 },
  { name: 'sodermanlands-lan', minLat: 58.5, maxLat: 59.5, minLng: 15.5, maxLng: 17.5 },
  { name: 'ostergotlands-lan', minLat: 58, maxLat: 59, minLng: 14.5, maxLng: 17 },
  { name: 'jonkopings-lan', minLat: 57, maxLat: 58, minLng: 13, maxLng: 16 },
  { name: 'kronobergs-lan', minLat: 56.5, maxLat: 57.5, minLng: 13.5, maxLng: 16 },
  { name: 'kalmar-lan', minLat: 56, maxLat: 58, minLng: 15, maxLng: 17 },
  { name: 'gotlands-lan', minLat: 57, maxLat: 58.5, minLng: 18, maxLng: 19.5 },
  { name: 'blekinge-lan', minLat: 56, maxLat: 56.5, minLng: 14.5, maxLng: 16.5 },
  { name: 'skane-lan', minLat: 55, maxLat: 56.5, minLng: 12.5, maxLng: 15 },
  { name: 'hallands-lan', minLat: 56.5, maxLat: 57.5, minLng: 12, maxLng: 13.5 },
  { name: 'vastra-gotalands-lan', minLat: 57, maxLat: 59.5, minLng: 11, maxLng: 14.5 },
];

function getCountyForCoords(lat, lng) {
  for (const c of COUNTY_GRID) {
    if (lat >= c.minLat && lat <= c.maxLat && lng >= c.minLng && lng <= c.maxLng) {
      return c.name;
    }
  }
  // Default: closest major county
  return 'stockholms-lan';
}

const BRAND_MAP = {
  'circle k': 'Circle K', circlek: 'Circle K',
  okq8: 'OKQ8', preem: 'Preem', shell: 'Shell',
  st1: 'St1', tanka: 'Tanka', ingo: 'Ingo',
  qstar: 'Qstar', 'q-star': 'Qstar', gulf: 'Gulf',
};

function normalizeBrand(raw) {
  if (!raw) return '';
  const lower = raw.toLowerCase().trim();
  return BRAND_MAP[lower] || raw.trim();
}

function normalizeCity(city) {
  return (city || '').toLowerCase()
    .replace(/[åä]/g, 'a').replace(/ö/g, 'o')
    .replace(/[^a-z0-9]/g, '');
}

// Fetch prices for the county containing these coordinates
async function fetchPrices(lat, lng) {
  const county = getCountyForCoords(lat, lng);
  const res = await fetch(`${PRICE_API}?lan=${county}`);
  if (!res.ok) return new Map();
  const data = await res.json();

  // Parse into: Map<"brand|cityPrefix" → { 95: price, diesel: price, ... }>
  // The key format is: county_Brand_CityAddress__fuelType
  // CityAddress starts with city name (no separator), e.g. "GoteborgTorslanda_Nordhagsvagen_26"
  const priceMap = new Map();
  for (const [key, val] of Object.entries(data)) {
    if (!val || val === '0') continue;
    const price = parseFloat(val);
    if (isNaN(price) || price <= 0) continue;

    const fuelSplit = key.split('__');
    if (fuelSplit.length !== 2) continue;
    const [stationPart, fuelType] = fuelSplit;

    const parts = stationPart.split('_');
    if (parts.length < 3) continue;
    const brand = normalizeBrand(parts[1]);
    // The city+address is everything after brand, joined back
    const cityAddr = normalizeCity(parts.slice(2).join(''));

    // Store with full cityAddr for prefix matching later
    const matchKey = `${brand.toLowerCase()}|${cityAddr}`;
    if (!priceMap.has(matchKey)) priceMap.set(matchKey, {});

    const fuelMap = { '95': '95', '98': '98', diesel: 'diesel', etanol: 'etanol' };
    const mapped = fuelMap[fuelType];
    if (mapped) {
      const entry = priceMap.get(matchKey);
      if (!entry[mapped] || price < entry[mapped]) {
        entry[mapped] = price;
      }
    }
  }
  return priceMap;
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

  // Fetch locations + prices in parallel
  const [elements, priceMap] = await Promise.all([
    queryOverpass(grid.lat, grid.lng, Math.min(radiusKm * 1000, 25000)),
    fetchPrices(grid.lat, grid.lng),
  ]);

  const stations = elements.map((el) => {
    const elLat = el.lat || el.center?.lat;
    const elLng = el.lon || el.center?.lon;
    if (!elLat || !elLng) return null;

    const tags = el.tags || {};
    const brand = normalizeBrand(tags.brand || tags.name || '');
    const city = tags['addr:city'] || tags['addr:suburb'] || '';
    const address = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');

    // Try to match with price data using brand + city prefix matching
    const brandLower = brand.toLowerCase();
    const cityNorm = normalizeCity(city);
    let prices = {};
    if (cityNorm) {
      for (const [mk, mp] of priceMap) {
        const [mkBrand, mkCityAddr] = mk.split('|');
        if (mkBrand === brandLower && mkCityAddr.startsWith(cityNorm)) {
          prices = mp;
          break;
        }
      }
    }

    return {
      id: `SE-${el.id}`,
      brand: brand || 'Station',
      name: tags.name || brand || 'Station',
      address,
      city,
      lat: elLat,
      lng: elLng,
      country: COUNTRY,
      prices,
      updatedAt: null,
    };
  }).filter(Boolean);

  await putGridCache(cacheKey, stations, env, 600);
  const filtered = filterByDistance(stations, lat, lng, radiusKm);
  return json({ stations: filtered, count: filtered.length });
}
