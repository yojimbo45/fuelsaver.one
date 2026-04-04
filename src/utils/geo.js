/**
 * Haversine distance between two lat/lng points in km.
 */
export function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Format distance for display.
 */
export function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

/**
 * Detect country code from lat/lng using bounding boxes.
 * Returns our internal country code (e.g. 'FR', 'UK') or null.
 * Checked from smallest to largest to prefer specific matches.
 */
const COUNTRY_BOUNDS = [
  // Small countries first (more specific)
  { code: 'LU', latMin: 49.4, latMax: 50.2, lngMin: 5.7, lngMax: 6.6 },
  { code: 'SI', latMin: 45.4, latMax: 46.9, lngMin: 13.3, lngMax: 16.6 },
  { code: 'CH', latMin: 45.8, latMax: 47.8, lngMin: 5.9, lngMax: 10.5 },
  { code: 'AT', latMin: 46.3, latMax: 49.0, lngMin: 9.5, lngMax: 17.2 },
  { code: 'BE', latMin: 49.5, latMax: 51.5, lngMin: 2.5, lngMax: 6.4 },
  { code: 'NL', latMin: 50.7, latMax: 53.6, lngMin: 3.3, lngMax: 7.2 },
  { code: 'DK', latMin: 54.5, latMax: 57.8, lngMin: 8.0, lngMax: 12.7 },
  { code: 'HR', latMin: 42.3, latMax: 46.6, lngMin: 13.5, lngMax: 19.5 },
  { code: 'TR', latMin: 36.0, latMax: 42.1, lngMin: 26.0, lngMax: 44.9 },
  { code: 'GR', latMin: 34.8, latMax: 41.8, lngMin: 19.3, lngMax: 29.7 },
  { code: 'PT', latMin: 36.9, latMax: 42.2, lngMin: -9.5, lngMax: -6.2 },
  { code: 'IE', latMin: 51.4, latMax: 55.4, lngMin: -10.5, lngMax: -5.9 },
  { code: 'UK', latMin: 49.9, latMax: 60.9, lngMin: -8.6, lngMax: 1.8 },
  // Medium countries
  { code: 'DE', latMin: 47.2, latMax: 55.1, lngMin: 5.8, lngMax: 15.1 },
  { code: 'FR', latMin: 41.3, latMax: 51.1, lngMin: -5.2, lngMax: 9.6 },
  { code: 'ES', latMin: 35.9, latMax: 43.8, lngMin: -9.4, lngMax: 4.3 },
  { code: 'IT', latMin: 36.6, latMax: 47.1, lngMin: 6.6, lngMax: 18.5 },
  { code: 'KR', latMin: 33.1, latMax: 38.6, lngMin: 124.6, lngMax: 131.9 },
  { code: 'AE', latMin: 22.6, latMax: 26.1, lngMin: 51.5, lngMax: 56.4 },
  { code: 'MY', latMin: 0.8, latMax: 7.4, lngMin: 99.6, lngMax: 119.3 },
  { code: 'IN', latMin: 6.7, latMax: 35.5, lngMin: 68.1, lngMax: 97.4 },
  { code: 'NZ', latMin: -47.3, latMax: -34.4, lngMin: 166.4, lngMax: 178.6 },
  // Large countries
  { code: 'ZA', latMin: -34.8, latMax: -22.1, lngMin: 16.4, lngMax: 32.9 },
  { code: 'AU', latMin: -43.6, latMax: -10.7, lngMin: 113.2, lngMax: 153.6 },
  { code: 'CL', latMin: -55.9, latMax: -17.5, lngMin: -75.6, lngMax: -66.9 },
  { code: 'MX', latMin: 14.5, latMax: 32.7, lngMin: -118.4, lngMax: -86.7 },
  { code: 'AR', latMin: -55.1, latMax: -21.8, lngMin: -73.6, lngMax: -53.6 },
  { code: 'BR', latMin: -33.7, latMax: 5.3, lngMin: -73.9, lngMax: -34.8 },
  // New Asian countries
  { code: 'TH', latMin: 5.6, latMax: 20.5, lngMin: 97.3, lngMax: 105.6 },
  { code: 'JP', latMin: 24.0, latMax: 45.6, lngMin: 122.9, lngMax: 153.9 },
  { code: 'ID', latMin: -11.0, latMax: 6.1, lngMin: 95.0, lngMax: 141.0 },
  // New European countries
  { code: 'EE', latMin: 57.5, latMax: 59.7, lngMin: 21.7, lngMax: 28.2 },
  { code: 'LV', latMin: 55.7, latMax: 58.1, lngMin: 20.9, lngMax: 28.2 },
  { code: 'LT', latMin: 53.9, latMax: 56.5, lngMin: 20.9, lngMax: 26.8 },
  { code: 'PL', latMin: 49.0, latMax: 54.9, lngMin: 14.1, lngMax: 24.2 },
  { code: 'FI', latMin: 59.8, latMax: 70.1, lngMin: 19.7, lngMax: 31.6 },
  { code: 'SE', latMin: 55.3, latMax: 69.1, lngMin: 11.1, lngMax: 24.2 },
  { code: 'NO', latMin: 57.9, latMax: 71.2, lngMin: 4.5, lngMax: 31.1 },
  { code: 'RO', latMin: 43.6, latMax: 48.3, lngMin: 20.2, lngMax: 29.7 },
  { code: 'HU', latMin: 45.7, latMax: 48.6, lngMin: 16.1, lngMax: 22.9 },
  { code: 'CZ', latMin: 48.5, latMax: 51.1, lngMin: 12.1, lngMax: 18.9 },
];

export function detectCountryFromCoords(lat, lng) {
  for (const b of COUNTRY_BOUNDS) {
    if (lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax) {
      return b.code;
    }
  }
  return null;
}

