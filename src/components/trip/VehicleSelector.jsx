import { useState, useRef, useEffect, useCallback } from 'react';
import { searchVehicles } from '../../services/vehicleApi';

export default function VehicleSelector({ onSelect }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleChange = useCallback((e) => {
    const val = e.target.value;
    setQuery(val);

    clearTimeout(debounceRef.current);
    if (val.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const results = await searchVehicles(val);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
      setLoading(false);
    }, 300);
  }, []);

  const handleSelect = useCallback((vehicle) => {
    setQuery(`${vehicle.make} ${vehicle.model}`);
    setSuggestions([]);
    setShowSuggestions(false);
    onSelect?.(vehicle);
  }, [onSelect]);

  return (
    <div className="vehicle-search" ref={wrapperRef}>
      <input
        className="trip-place-input"
        type="text"
        placeholder="Find your car..."
        value={query}
        onChange={handleChange}
        onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
      />
      {loading && <span className="vehicle-search-spinner" />}
      {showSuggestions && (
        <ul className="autocomplete-list">
          {suggestions.map((v, i) => (
            <li
              key={`${v.make}-${v.model}-${i}`}
              className="autocomplete-item"
              onMouseDown={() => handleSelect(v)}
            >
              <span className="vehicle-suggestion-name">{v.make} {v.model}</span>
              <span className="vehicle-suggestion-meta">{v.consumption} L/100km</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
