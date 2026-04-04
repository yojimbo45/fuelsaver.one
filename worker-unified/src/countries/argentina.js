import { filterByDistance } from '../lib/geo.js';
import { json } from '../lib/response.js';
import { getStations, putStations } from '../lib/kv.js';
import { assignLogos } from '../lib/brandfetch.js';

const COUNTRY = 'AR';
const CSV_URL =
  'http://datos.energia.gob.ar/dataset/1c181390-5045-475e-94dc-410429be4b17/resource/80ac25de-a44a-4445-9215-090cf55cfda5/download/precios-en-surtidor-resolucin-3142016.csv';

// Map producto names (from CSV) to our standard fuel keys
// Must match frontend IDs in countries.js
const PRODUCT_MAP = {
  'Gas Oil Grado 2': 'diesel',
  'Gas Oil Grado 3': 'diesel_premium',
  'GNC': 'gnc',
};

// Normalize CSV brand strings to clean display names
const BRAND_NORMALIZE = {
  'ypf': 'YPF',
  'shell c.a.p.s.a.': 'Shell',
  'axion': 'Axion Energy',
  'blanca': null,                // independent/unbranded
  'puma': 'Puma',
  'dapsa s.a.': 'DAPSA',
  'gulf': 'Gulf',
  'refinor': 'Refinor',
  'voy': 'VOY',
  'oil combustibles s.a.': 'Oil Combustibles',
  'sin empresa bandera': null,   // unbranded
};

// Brand → website domain for Brandfetch logo resolution
const BRAND_DOMAINS = {
  'YPF': 'ypf.com',
  'Shell': 'shell.com',
  'Axion Energy': 'axionenergy.com',
  'Puma': 'pumaenergy.com',
  'DAPSA': 'dapsa.com.ar',
  'Gulf': 'gulfoil.com',
  'Refinor': 'refinor.com.ar',
  'VOY': 'voyconenergia.com',
};

function normalizeBrand(raw) {
  if (!raw) return null;
  const key = raw.toLowerCase().trim();
  if (key in BRAND_NORMALIZE) return BRAND_NORMALIZE[key];
  // Fallback: title-case
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

const KEEP_UPPER = new Set(['S.A.', 'S.R.L.', 'SA', 'SRL', 'SAS', 'YPF', 'GNC', 'SCC', 'S.A']);
const KEEP_LOWER = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e']);

function titleCase(str) {
  if (!str) return '';
  return str
    .split(/\s+/)
    .map((word, i) => {
      const upper = word.toUpperCase();
      if (KEEP_UPPER.has(upper)) return upper;
      if (i > 0 && KEEP_LOWER.has(word.toLowerCase())) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ')
    .trim();
}

function matchProduct(producto) {
  if (PRODUCT_MAP[producto]) return PRODUCT_MAP[producto];
  const lower = producto.toLowerCase();
  if (lower.includes('súper') || lower.includes('super')) return 'nafta_super';
  if (lower.includes('premium')) return 'nafta_premium';
  return null;
}

function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export async function refresh(env) {
  const res = await fetch(CSV_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Argentina CSV ${res.status}: ${await res.text()}`);

  let text = await res.text();
  // Strip BOM if present
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const lines = text.split('\n');
  if (lines.length < 2) throw new Error('Argentina CSV: no data rows');

  // Parse header to find column indices
  const header = splitCSVLine(lines[0]);
  const col = {};
  for (let i = 0; i < header.length; i++) {
    col[header[i].trim()] = i;
  }

  // Required columns
  const iEmpresa = col['idempresa'];
  const iProducto = col['producto'];
  const iPrecio = col['precio'];
  const iFecha = col['fecha_vigencia'];
  const iEmpresaNombre = col['empresa'];
  const iBandera = col['empresabandera'];
  const iDireccion = col['direccion'];
  const iLocalidad = col['localidad'];
  const iProvincia = col['provincia'];
  const iLat = col['latitud'];
  const iLng = col['longitud'];
  const iHorario = col['tipohorario'];

  if (iEmpresa == null || iProducto == null || iPrecio == null) {
    throw new Error(`Argentina CSV: missing required columns. Header: ${lines[0]}`);
  }

  // Group rows by station, keeping latest price per product
  const stationMap = new Map();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = splitCSVLine(line);
    const stationId = cols[iEmpresa]?.trim();
    if (!stationId) continue;

    const producto = cols[iProducto]?.trim();
    const fuelKey = matchProduct(producto);
    if (!fuelKey) continue;

    const precio = parseFloat(cols[iPrecio]?.trim());
    if (isNaN(precio) || precio <= 0) continue;

    const lat = parseFloat(cols[iLat]?.trim());
    const lng = parseFloat(cols[iLng]?.trim());
    if (isNaN(lat) || isNaN(lng)) continue;

    const fechaVigencia = cols[iFecha]?.trim() || '';
    const horario = cols[iHorario]?.trim() || '';

    if (!stationMap.has(stationId)) {
      const rawBrand = cols[iBandera]?.trim() || '';
      const brand = normalizeBrand(rawBrand) || 'Station';
      const rawEmpresa = cols[iEmpresaNombre]?.trim() || '';
      const name = titleCase(rawEmpresa) || brand;

      stationMap.set(stationId, {
        id: stationId,
        brand,
        name,
        address: cols[iDireccion]?.trim() || '',
        city: cols[iLocalidad]?.trim() || '',
        lat,
        lng,
        country: COUNTRY,
        logo: null,
        prices: {},
        _priceDate: {},
        updatedAt: null,
      });
    }

    const station = stationMap.get(stationId);
    const prevDate = station._priceDate[fuelKey] || '';

    // Keep the most recent price; prefer Diurno over Nocturno for same date
    if (
      fechaVigencia > prevDate ||
      (fechaVigencia === prevDate && horario === 'Diurno')
    ) {
      station.prices[fuelKey] = { price: precio };
      station._priceDate[fuelKey] = fechaVigencia;
      if (!station.updatedAt || fechaVigencia > station.updatedAt) {
        station.updatedAt = fechaVigencia;
      }
    }
  }

  // Clean up internal fields and collect valid stations
  const stations = [];
  for (const s of stationMap.values()) {
    delete s._priceDate;
    if (Object.keys(s.prices).length > 0) {
      stations.push(s);
    }
  }

  const logoCount = await assignLogos(stations, BRAND_DOMAINS, env, 'AR');
  console.log(`[AR] Parsed ${lines.length - 1} CSV rows, ${stations.length} stations, ${logoCount} logos`);
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
