import { filterByDistance, gridCell } from '../lib/geo.js';
import { json } from '../lib/response.js';
import { getGridCache, putGridCache } from '../lib/kv.js';
import { queryOverpass } from '../lib/overpass.js';

const COUNTRY = 'ZA';

// Government-regulated prices (ZAR/L), two zones
const PRICES_INLAND = {
  ULP95: { price: 22.36 },
  ULP93: { price: 21.96 },
  diesel_50: { price: 19.38 },
  diesel_500: { price: 19.17 },
};

const PRICES_COASTAL = {
  ULP95: { price: 21.62 },
  ULP93: { price: 21.22 },
  diesel_50: { price: 18.64 },
  diesel_500: { price: 18.43 },
};

function isInland(lat, lng) {
  return lat > -28 && lat < -23 && lng > 25 && lng < 32;
}

const BRAND_MAP = {
  engen: 'Engen', shell: 'Shell', bp: 'BP', caltex: 'Caltex',
  total: 'TotalEnergies', totalenergies: 'TotalEnergies', sasol: 'Sasol',
};

function mapElements(elements) {
  return elements.map((el) => {
    const elLat = el.lat || el.center?.lat;
    const elLng = el.lon || el.center?.lon;
    if (!elLat || !elLng) return null;

    const tags = el.tags || {};
    const brand = (tags.brand || tags.name || 'Station').trim();
    const prices = isInland(elLat, elLng) ? PRICES_INLAND : PRICES_COASTAL;

    return {
      id: `ZA-${el.id}`,
      brand: BRAND_MAP[brand.toLowerCase()] || brand,
      name: tags.name || brand,
      address: [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' '),
      city: tags['addr:city'] || tags['addr:suburb'] || '',
      lat: elLat,
      lng: elLng,
      country: COUNTRY,
      prices,
      updatedAt: null,
    };
  }).filter(Boolean);
}

export async function handleQuery(url, env) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radiusKm = parseFloat(url.searchParams.get('radius') || '15');

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
      console.error('[ZA] Overpass failed:', e.message);
      stations = [];
    }
  }

  const filtered = filterByDistance(stations, lat, lng, radiusKm);
  return json({ stations: filtered, count: filtered.length });
}
