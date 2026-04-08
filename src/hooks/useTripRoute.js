import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { fetchRoute } from '../services/routing';
import { fetchStations } from '../services/fuelApi';
import { geocodeAddress } from '../services/geocoding';
import { COUNTRIES } from '../services/countries';
import { haversineDistance, detectCountryFromCoords } from '../utils/geo';

// Average fuel prices (per liter) by country + fuel type for cost estimation
const AVG_PRICES = {
  FR: { E10: 1.75, SP98: 1.85, Gazole: 1.65, SP95: 1.78, E85: 0.85, GPLc: 0.95 },
  DE: { e5: 1.75, e10: 1.70, diesel: 1.65 },
  ES: { G95E5: 1.55, G98E5: 1.70, GOA: 1.50, GLP: 0.90 },
  IT: { benzina: 1.80, gasolio: 1.70, gpl: 0.75, metano: 1.50 },
  UK: { E10: 139.9, E5: 144.9, B7: 144.9 },
  PT: { G95: 1.70, G98: 1.85, diesel: 1.60, GPLc: 0.80 },
  AT: { super: 1.55, diesel: 1.50 },
  BE: { E10: 1.70, SP98: 1.85, diesel: 1.75 },
  NL: { euro95: 2.10, diesel: 1.85 },
  CH: { unleaded95: 1.80, unleaded98: 1.90, diesel: 1.85 },
  LU: { E10: 1.50, SP98: 1.60, diesel: 1.45 },
  HR: { eurosuper95: 1.45, eurosuper100: 1.55, eurodizel: 1.45 },
  SI: { NMB95: 1.45, NMB100: 1.55, dizel: 1.45 },
  PL: { Pb95: 6.50, Pb98: 7.20, ON: 6.40, LPG: 2.80 },
  CZ: { natural95: 38.0, natural98: 42.0, diesel: 37.0 },
  HU: { E95: 600, diesel: 610 },
  RO: { standard: 7.0, premium: 7.5, motorina: 7.0, premiumDiesel: 7.3 },
  GR: { unleaded95: 1.80, unleaded100: 1.95, diesel: 1.65 },
  DK: { oktan95: 13.5, oktan95plus: 14.5, diesel: 12.5 },
  AU: { U91: 1.85, U95: 1.95, U98: 2.05, diesel: 1.90, E10: 1.80, LPG: 1.00 },
  KR: { gasoline: 1700, diesel: 1500, lpg: 1000 },
  BR: { gasolina: 5.80, etanol: 3.80, diesel: 5.50 },
  AR: { super: 800, premium: 900, diesel: 750 },
  CL: { gasoline93: 1100, gasoline95: 1200, gasoline97: 1300, diesel: 1000 },
  MX: { regular: 22.5, premium: 24.5, diesel: 23.5 },
  IN: { petrol: 105, diesel: 90 },
  NZ: { 91: 2.70, 95: 2.90, 98: 3.00, diesel: 2.10 },
  ZA: { unleaded93: 24.0, unleaded95: 24.5, diesel50: 22.5, diesel500: 22.0 },
  IE: { E10: 1.70, E5: 1.75, B7: 1.65 },
  JP: { regular: 175, premium: 186, diesel: 155 },
  TH: { gasohol91: 37, gasohol95: 38, gasoholE20: 35, diesel: 30, dieselB7: 30 },
  MY: { RON95: 2.05, RON97: 3.35, diesel: 2.15 },
  FI: { E10: 1.80, E98: 1.95, diesel: 1.75 },
};

/**
 * Sample points along a GeoJSON LineString at regular intervals.
 * Includes the start and samples every intervalKm.
 */
function sampleRoutePoints(geometry, intervalKm = 30) {
  const coords = geometry.coordinates;
  if (!coords || coords.length < 2) return [];

  const points = [];
  let accumulated = 0;
  let nextSample = 0; // start immediately from origin area

  // Add the first point
  points.push({ lat: coords[0][1], lng: coords[0][0], distanceFromStart: 0 });
  nextSample = intervalKm;

  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    const segDist = haversineDistance(lat1, lng1, lat2, lng2);
    accumulated += segDist;

    if (accumulated >= nextSample) {
      points.push({ lat: lat2, lng: lng2, distanceFromStart: accumulated });
      nextSample += intervalKm;
    }
  }

  // Always include the last point (destination area)
  const last = coords[coords.length - 1];
  const lastPt = points[points.length - 1];
  if (!lastPt || haversineDistance(lastPt.lat, lastPt.lng, last[1], last[0]) > 5) {
    points.push({ lat: last[1], lng: last[0], distanceFromStart: accumulated });
  }

  return points;
}

/**
 * Find the minimum distance from a point to the route polyline.
 */
function distanceToRoute(lat, lng, geometry) {
  const coords = geometry.coordinates;
  let minDist = Infinity;
  const step = Math.max(1, Math.floor(coords.length / 2000));
  for (let i = 0; i < coords.length; i += step) {
    const d = haversineDistance(lat, lng, coords[i][1], coords[i][0]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

// ── URL state helpers ──────────────────────────────────────────────

// Use " to " as separator — readable and unlikely in city names
function encodeTripPath(origin, destination) {
  if (!origin?.text || !destination?.text) return '/trip';
  const from = origin.text.replace(/ /g, '+');
  const to = destination.text.replace(/ /g, '+');
  return `/trip/${from}-to-${to}`;
}

function decodeTripFromPath() {
  const pathname = window.location.pathname;
  if (!pathname.startsWith('/trip/')) return null;

  const path = pathname.slice('/trip/'.length);
  const sepIdx = path.indexOf('-to-');
  if (sepIdx < 1) return null;

  const fromText = decodeURIComponent(path.slice(0, sepIdx).replace(/\+/g, ' '));
  const toText = decodeURIComponent(path.slice(sepIdx + 4).replace(/\+/g, ' '));

  if (!fromText || !toText) return null;

  return { fromText, toText };
}

// ── Hook ───────────────────────────────────────────────────────────

export function useTripRoute() {
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [waypoints, setWaypoints] = useState([]);
  const [consumption, setConsumption] = useState(7.0);
  const [tankCapacity, setTankCapacity] = useState(50);
  const [fuelType, setFuelType] = useState(null);
  const [route, setRoute] = useState(null);
  const [tripCost, setTripCost] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [recommendedStations, setRecommendedStations] = useState([]);
  const [stationsLoading, setStationsLoading] = useState(false);
  const restoredRef = useRef(false);

  const country = origin?.countryCode || null;
  const countryData = country ? COUNTRIES[country] : null;

  const effectiveFuelType = useMemo(() => {
    if (fuelType && countryData?.fuelTypes.some(f => f.id === fuelType)) return fuelType;
    return countryData?.defaultFuel || null;
  }, [fuelType, countryData]);

  // Restore trip from URL on mount
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const saved = decodeTripFromPath();
    if (!saved) return;

    (async () => {
      setLoading(true);
      try {
        const [fromGeo, toGeo] = await Promise.all([
          geocodeAddress(saved.fromText),
          geocodeAddress(saved.toText),
        ]);
        const o = { text: saved.fromText, lat: fromGeo.lat, lng: fromGeo.lng, countryCode: fromGeo.countryCode };
        const d = { text: saved.toText, lat: toGeo.lat, lng: toGeo.lng, countryCode: toGeo.countryCode };
        setOrigin(o);
        setDestination(d);

        const result = await fetchRoute([o, d]);
        setRoute(result);

        const cc = o.countryCode || null;
        const ccData = cc ? COUNTRIES[cc] : null;
        const fuel = ccData?.defaultFuel || null;
        if (fuel) setFuelType(fuel);

        const fuelNeeded = (result.distance / 100) * consumption;
        const fallbackPrice = AVG_PRICES[cc]?.[fuel] || 0;
        setTripCost({
          fuelNeeded,
          cost: fuelNeeded * fallbackPrice,
          pricePerUnit: fallbackPrice,
          distance: result.distance,
          duration: result.duration,
          stationCount: 0,
        });

        findStationsAlongRoute(result, fuel, result.distance, result.duration, consumption);
      } catch (err) {
        setError(err.message || 'Failed to restore trip');
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addWaypoint = useCallback(() => {
    setWaypoints(prev => [...prev, null]);
  }, []);

  const removeWaypoint = useCallback((index) => {
    setWaypoints(prev => prev.filter((_, i) => i !== index));
  }, []);

  const updateWaypoint = useCallback((index, place) => {
    setWaypoints(prev => {
      const next = [...prev];
      next[index] = place;
      return next;
    });
  }, []);

  const invertRoute = useCallback(() => {
    const prevOrigin = origin;
    const prevDest = destination;
    setOrigin(prevDest);
    setDestination(prevOrigin);
    setWaypoints(prev => [...prev].reverse());
  }, [origin, destination]);

  const findStationsAlongRoute = useCallback(async (routeResult, fuel, distanceKm, durationSec, consumptionVal) => {
    setStationsLoading(true);
    setRecommendedStations([]);

    try {
      // Adaptive intervals — radius must be ≥ interval/2 to ensure full route coverage
      const interval = distanceKm > 1000 ? 80 : distanceKm > 500 ? 60 : 40;
      const radius = Math.ceil(interval / 2) + 5;
      const samplePoints = sampleRoutePoints(routeResult.geometry, interval);

      const pointsByCountry = {};
      for (const pt of samplePoints) {
        const cc = detectCountryFromCoords(pt.lat, pt.lng);
        if (cc && COUNTRIES[cc]) {
          if (!pointsByCountry[cc]) pointsByCountry[cc] = [];
          pointsByCountry[cc].push(pt);
        }
      }

      const allStations = new Map();
      const allFetches = [];

      for (const [cc, points] of Object.entries(pointsByCountry)) {
        const countryFuelTypes = COUNTRIES[cc].fuelTypes.map(f => f.id);
        const countryFuel = countryFuelTypes.includes(fuel) ? fuel : COUNTRIES[cc].defaultFuel;

        for (const pt of points) {
          allFetches.push({ cc, pt, countryFuel });
        }
      }

      // Batch requests: max 8 concurrent to avoid timeouts
      const BATCH_SIZE = 8;
      for (let i = 0; i < allFetches.length; i += BATCH_SIZE) {
        const batch = allFetches.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(({ cc, pt, countryFuel }) =>
          fetchStations(cc, pt.lat, pt.lng, radius, countryFuel)
            .then(stations => {
              for (const s of stations) {
                if (!allStations.has(s.id)) {
                  allStations.set(s.id, { ...s, _country: cc, _countryFuel: countryFuel });
                }
              }
            })
            .catch(() => {})
        ));
      }

      const candidates = [];
      for (const station of allStations.values()) {
        const price = station.prices?.[station._countryFuel];
        if (price == null || price <= 0) continue;
        const routeDist = distanceToRoute(station.lat, station.lng, routeResult.geometry);
        if (routeDist > 8) continue;
        candidates.push({ ...station, price, routeDistance: routeDist, countryCode: station._country });
      }

      candidates.sort((a, b) => a.price - b.price);
      setRecommendedStations(candidates);

      if (candidates.length > 0) {
        const avgPrice = candidates.reduce((sum, s) => sum + s.price, 0) / candidates.length;
        const fuelNeeded = (distanceKm / 100) * consumptionVal;
        setTripCost(prev => ({
          ...prev,
          fuelNeeded,
          cost: fuelNeeded * avgPrice,
          pricePerUnit: avgPrice,
          stationCount: candidates.length,
        }));
      }
    } catch (err) {
      console.warn('Failed to find stations along route:', err);
    } finally {
      setStationsLoading(false);
    }
  }, []);

  const calculate = useCallback(async (overrideOrigin, overrideDestination, overrideWaypoints, overrideConsumption, overrideFuel) => {
    const o = overrideOrigin || origin;
    const d = overrideDestination || destination;
    const w = overrideWaypoints || waypoints;
    const c = overrideConsumption || consumption;

    if (!o?.lat || !d?.lat) {
      setError('Please select both origin and destination');
      return;
    }

    setLoading(true);
    setError(null);
    setRoute(null);
    setTripCost(null);
    setRecommendedStations([]);

    try {
      const points = [o, ...w.filter(wp => wp?.lat), d];
      const result = await fetchRoute(points);
      setRoute(result);

      const cc = o.countryCode || null;
      const ccData = cc ? COUNTRIES[cc] : null;
      const fuel = overrideFuel || (fuelType && ccData?.fuelTypes.some(f => f.id === fuelType) ? fuelType : ccData?.defaultFuel) || effectiveFuelType;

      const fuelNeeded = (result.distance / 100) * c;
      const fallbackPrice = AVG_PRICES[cc]?.[fuel] || 0;

      setTripCost({
        fuelNeeded,
        cost: fuelNeeded * fallbackPrice,
        pricePerUnit: fallbackPrice,
        distance: result.distance,
        duration: result.duration,
        stationCount: 0,
      });

      const newPath = encodeTripPath(o, d);
      window.history.replaceState(null, '', newPath + window.location.search);

      findStationsAlongRoute(result, fuel, result.distance, result.duration, c);
    } catch (err) {
      setError(err.message || 'Failed to calculate route');
    } finally {
      setLoading(false);
    }
  }, [origin, destination, waypoints, consumption, fuelType, effectiveFuelType, findStationsAlongRoute]);

  return {
    origin, setOrigin,
    destination, setDestination,
    waypoints, addWaypoint, removeWaypoint, updateWaypoint,
    consumption, setConsumption,
    tankCapacity, setTankCapacity,
    fuelType: effectiveFuelType, setFuelType,
    country, countryData,
    route, tripCost,
    loading, error,
    recommendedStations, stationsLoading,
    calculate, invertRoute,
  };
}
