import { filterByDistance } from '../lib/geo.js';
import { json } from '../lib/response.js';
import { getStations, putStations } from '../lib/kv.js';
import { assignLogos } from '../lib/brandfetch.js';

const COUNTRY = 'MX';
const PLACES_URL = 'https://publicacionexterna.azurewebsites.net/publicaciones/places';
const PRICES_URL = 'https://publicacionexterna.azurewebsites.net/publicaciones/prices';

// Brand normalization: raw station name keywords → clean brand
const BRAND_NORMALIZE = {
  pemex: 'Pemex',
  bp: 'BP',
  shell: 'Shell',
  mobil: 'Mobil',
  total: 'TotalEnergies',
  totalenergies: 'TotalEnergies',
  'oxxo gas': 'Oxxo Gas',
  oxxo: 'Oxxo Gas',
  g500: 'G500',
  'g-500': 'G500',
  arco: 'Arco',
  chevron: 'Chevron',
  gulf: 'Gulf',
  repsol: 'Repsol',
  exxon: 'Mobil',
  texaco: 'Texaco',
  marathon: 'Marathon',
  valero: 'Valero',
  '76': '76',
  orsan: 'Orsan',
  hidrosina: 'Hidrosina',
  lodemo: 'Lodemo',
  'full gas': 'Full Gas',
  redco: 'Redco',
  rendichicas: 'Rendichicas',
};

function normalizeBrand(name) {
  if (!name) return 'Station';
  const lower = name.toLowerCase().trim();
  // Try exact match first
  if (BRAND_NORMALIZE[lower]) return BRAND_NORMALIZE[lower];
  // Try keyword match
  for (const [key, brand] of Object.entries(BRAND_NORMALIZE)) {
    if (lower.includes(key)) return brand;
  }
  return name.trim();
}

// Brand → website domain for Brandfetch logo resolution
const BRAND_DOMAINS = {
  'Pemex': 'pemex.com',
  'BP': 'bp.com',
  'Shell': 'shell.com',
  'Mobil': 'exxonmobil.com',
  'TotalEnergies': 'totalenergies.com',
  'Oxxo Gas': 'oxxo.com',
  'G500': 'g500.mx',
  'Arco': 'arco.com',
  'Chevron': 'chevron.com',
  'Gulf': 'gulfoil.com',
  'Repsol': 'repsol.com',
  'Texaco': 'texaco.com',
  'Marathon': 'marathonpetroleum.com',
  'Valero': 'valero.com',
  '76': '76.com',
  'Hidrosina': 'hidrosina.com.mx',
  'Rendichicas': 'rendichicas.com.mx',
};

function parseXMLField(xml, tag) {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`);
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function parsePlaces(xml) {
  const map = new Map();
  const placeRegex = /<place\s+place_id="(\d+)">([\s\S]*?)<\/place>/g;
  let match;

  while ((match = placeRegex.exec(xml)) !== null) {
    const placeId = match[1];
    const content = match[2];
    const lng = parseFloat(parseXMLField(content, 'x'));
    const lat = parseFloat(parseXMLField(content, 'y'));
    if (isNaN(lat) || isNaN(lng)) continue;

    // Skip obviously wrong coordinates (outside Mexico bounding box)
    if (lat < 14 || lat > 33 || lng < -118 || lng > -86) continue;

    const name = parseXMLField(content, 'name');
    const brand = normalizeBrand(name);

    map.set(placeId, {
      id: placeId,
      brand,
      name: name || brand,
      address: '',
      city: '',
      lat,
      lng,
      country: COUNTRY,
      prices: {},
      updatedAt: null,
    });
  }

  return map;
}

function parsePrices(xml, stationMap) {
  const placeRegex = /<place\s+place_id="(\d+)">([\s\S]*?)<\/place>/g;
  const priceRegex = /<gas_price\s+type="([^"]+)">([^<]+)<\/gas_price>/g;
  let match;

  while ((match = placeRegex.exec(xml)) !== null) {
    const placeId = match[1];
    const content = match[2];
    const station = stationMap.get(placeId);
    if (!station) continue;

    let priceMatch;
    priceRegex.lastIndex = 0;
    while ((priceMatch = priceRegex.exec(content)) !== null) {
      const type = priceMatch[1]; // regular, premium, diesel
      const price = parseFloat(priceMatch[2]);
      if (!isNaN(price) && price > 0) {
        station.prices[type] = { price };
      }
    }
  }
}

export async function refresh(env) {
  const [placesRes, pricesRes] = await Promise.all([
    fetch(PLACES_URL),
    fetch(PRICES_URL),
  ]);

  if (!placesRes.ok) throw new Error(`Mexico Places API ${placesRes.status}: ${await placesRes.text()}`);
  if (!pricesRes.ok) throw new Error(`Mexico Prices API ${pricesRes.status}: ${await pricesRes.text()}`);

  const [placesXml, pricesXml] = await Promise.all([
    placesRes.text(),
    pricesRes.text(),
  ]);

  const stationMap = parsePlaces(placesXml);
  parsePrices(pricesXml, stationMap);

  // Only keep stations that have at least one price
  const stations = [];
  for (const s of stationMap.values()) {
    if (Object.keys(s.prices).length > 0) {
      stations.push(s);
    }
  }

  const logoCount = await assignLogos(stations, BRAND_DOMAINS, env, 'MX');
  console.log(`[MX] Fetched ${stationMap.size} places, ${stations.length} with prices, ${logoCount} logos`);
  await putStations(COUNTRY, stations, env);
}

export async function handleQuery(url, env) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radiusKm = parseFloat(url.searchParams.get('radius') || '15');

  const allStations = await getStations(COUNTRY, env);
  if (!allStations) return json({ error: 'Data not yet cached, try again later' }, 503);

  const filtered = filterByDistance(allStations, lat, lng, radiusKm);
  return json({ stations: filtered, count: filtered.length });
}
