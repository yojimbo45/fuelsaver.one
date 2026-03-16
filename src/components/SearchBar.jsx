import { useState, useRef, useEffect, useCallback } from 'react';
import { COUNTRIES } from '../services/countries';
import { autocompletePlaces } from '../services/geocoding';

const RADIUS_OPTIONS = [1, 2, 5, 10, 15, 20, 30];

function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const r = Number(params.get('radius'));
  const lat = params.get('lat') ? Number(params.get('lat')) : null;
  const lng = params.get('lng') ? Number(params.get('lng')) : null;
  return {
    radius: RADIUS_OPTIONS.includes(r) ? r : null,
    fuel: params.get('fuel') || null,
    lat: lat != null && !isNaN(lat) ? lat : null,
    lng: lng != null && !isNaN(lng) ? lng : null,
    country: params.get('country') || null,
    q: params.get('q') || null,
  };
}

export default function SearchBar({ onSearch, onCountryDetected }) {
  const urlParams = useRef(getUrlParams());
  const [query, setQuery] = useState('');
  const [radius, setRadius] = useState(urlParams.current.radius || 5);
  const [detectedCountry, setDetectedCountry] = useState(null);
  const [fuelType, setFuelType] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedCoords, setSelectedCoords] = useState(null);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  const countryData = detectedCountry ? COUNTRIES[detectedCountry] : null;
  const fuelTypes = countryData?.fuelTypes || [];

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Restore search from URL params on mount (for shared links)
  useEffect(() => {
    const p = urlParams.current;
    if (p.lat != null && p.lng != null && p.country && COUNTRIES[p.country]) {
      const cc = p.country;
      const countryFuels = COUNTRIES[cc].fuelTypes.map((f) => f.id);
      const fuel = p.fuel && countryFuels.includes(p.fuel) ? p.fuel : COUNTRIES[cc].defaultFuel;
      const rad = p.radius || 5;

      setQuery(p.q || '');
      setSelectedCoords({ lat: p.lat, lng: p.lng });
      setDetectedCountry(cc);
      setFuelType(fuel);
      setRadius(rad);
      onCountryDetected?.(cc);
      onSearch({
        query: p.q || '',
        radiusKm: rad,
        fuelType: fuel,
        lat: p.lat,
        lng: p.lng,
        country: cc,
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInputChange = useCallback((e) => {
    const val = e.target.value;
    setQuery(val);
    setSelectedCoords(null);

    // Debounce autocomplete
    clearTimeout(debounceRef.current);
    if (val.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const results = await autocompletePlaces(val);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    }, 300);
  }, []);

  const handleSelectSuggestion = useCallback((suggestion) => {
    setQuery(suggestion.text);
    setSelectedCoords({ lat: suggestion.lat, lng: suggestion.lng });
    setSuggestions([]);
    setShowSuggestions(false);

    // Auto-detect country from suggestion
    if (suggestion.countryCode && COUNTRIES[suggestion.countryCode]) {
      const cc = suggestion.countryCode;
      setDetectedCountry(cc);
      // Use fuel from URL param if it's valid for this country, otherwise default
      const countryFuels = COUNTRIES[cc].fuelTypes.map((f) => f.id);
      const paramFuel = urlParams.current.fuel;
      setFuelType(paramFuel && countryFuels.includes(paramFuel) ? paramFuel : COUNTRIES[cc].defaultFuel);
      onCountryDetected?.(cc);
    }
  }, [onCountryDetected]);

  const triggerSearch = useCallback((fuel, rad) => {
    if (!detectedCountry) return;

    // Sync all search state to URL for sharing
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (selectedCoords?.lat != null) params.set('lat', selectedCoords.lat);
    if (selectedCoords?.lng != null) params.set('lng', selectedCoords.lng);
    params.set('country', detectedCountry);
    params.set('fuel', fuel);
    params.set('radius', rad);
    window.history.replaceState(null, '', `?${params.toString()}`);

    onSearch({
      query: query.trim(),
      radiusKm: rad,
      fuelType: fuel,
      lat: selectedCoords?.lat,
      lng: selectedCoords?.lng,
      country: detectedCountry,
    });
  }, [detectedCountry, query, selectedCoords, onSearch]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    if (!detectedCountry) return;
    setShowSuggestions(false);
    triggerSearch(fuelType, radius);
  };

  return (
    <form className="search-bar" onSubmit={handleSubmit}>
      <div className="search-row" ref={wrapperRef}>
        <div className="search-input-wrapper">
          <input
            className="search-input"
            type="text"
            placeholder="City, postal code, or address..."
            value={query}
            onChange={handleInputChange}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          />
          {showSuggestions && (
            <ul className="autocomplete-list">
              {suggestions.map((s) => (
                <li
                  key={s.id}
                  className="autocomplete-item"
                  onMouseDown={() => handleSelectSuggestion(s)}
                >
                  <svg className="autocomplete-icon" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                    <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd"/>
                  </svg>
                  <span>{s.text}</span>
                  {s.countryCode && COUNTRIES[s.countryCode] && (
                    <span className="autocomplete-flag">{COUNTRIES[s.countryCode].flag}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button className="search-btn" type="submit" disabled={!detectedCountry}>
          Search
        </button>
      </div>
      {fuelTypes.length > 0 && (
        <div className="filters-row">
          {countryData && (
            <span className="detected-country">{countryData.flag} {countryData.name}</span>
          )}
          <span className="filter-label">Fuel</span>
          <select
            className="filter-select"
            value={fuelType}
            onChange={(e) => {
              const newFuel = e.target.value;
              setFuelType(newFuel);
              if (selectedCoords && detectedCountry) {
                triggerSearch(newFuel, radius);
              }
            }}
          >
            {fuelTypes.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>

          <span className="filter-label">Radius</span>
          <select
            className="filter-select"
            value={radius}
            onChange={(e) => {
              const newRadius = Number(e.target.value);
              setRadius(newRadius);
              if (selectedCoords && detectedCountry) {
                triggerSearch(fuelType, newRadius);
              }
            }}
          >
            {RADIUS_OPTIONS.map((r) => (
              <option key={r} value={r}>{r} km</option>
            ))}
          </select>
        </div>
      )}
      {!detectedCountry && query.length > 0 && (
        <div className="filters-row">
          <span className="filter-hint">Select a location from suggestions to detect country</span>
        </div>
      )}
    </form>
  );
}
