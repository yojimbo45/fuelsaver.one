import { useState, useCallback } from 'react';
import { fetchStations } from '../services/fuelApi';
import { geocodeAddress } from '../services/geocoding';

export function useStations() {
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchCenter, setSearchCenter] = useState(null);

  const search = useCallback(async ({ query, country, radiusKm, fuelType, lat, lng, skipFly }) => {
    setLoading(true);
    setError(null);

    try {
      let centerLat = lat;
      let centerLng = lng;
      let detectedCountry = country;

      // If no coords provided, geocode the query and detect country
      if (centerLat == null || centerLng == null) {
        const geo = await geocodeAddress(query);
        centerLat = geo.lat;
        centerLng = geo.lng;
        if (!detectedCountry && geo.countryCode) {
          detectedCountry = geo.countryCode;
        }
      }

      if (!detectedCountry) {
        throw new Error('Could not determine country for this location. Please try a more specific search.');
      }

      setSearchCenter({ lat: centerLat, lng: centerLng, skipFly: !!skipFly });

      const results = await fetchStations(detectedCountry, centerLat, centerLng, radiusKm, fuelType);
      setStations(results);

      if (results.length === 0) {
        setError('No stations found in this area. Try a larger radius.');
      }
    } catch (err) {
      console.error('Search error:', err);
      const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError' || err.message?.includes('aborted');
      setError(isTimeout ? 'Request timed out. Please try again.' : err.message);
      setStations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return { stations, loading, error, searchCenter, search };
}
