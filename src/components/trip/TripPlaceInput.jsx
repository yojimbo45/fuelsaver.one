import { useState, useRef, useEffect, useCallback } from 'react';
import { autocompletePlaces } from '../../services/geocoding';
import { COUNTRIES } from '../../services/countries';

export default function TripPlaceInput({ value, placeholder, onSelect, onClear }) {
  const [query, setQuery] = useState(value?.text || '');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  // Sync external value changes (e.g. invert)
  useEffect(() => {
    setQuery(value?.text || '');
  }, [value]);

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

  const handleChange = useCallback((e) => {
    const val = e.target.value;
    setQuery(val);
    if (!val) {
      onClear?.();
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

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
  }, [onClear]);

  const handleSelect = useCallback((suggestion) => {
    setQuery(suggestion.text);
    setSuggestions([]);
    setShowSuggestions(false);
    onSelect({
      text: suggestion.text,
      lat: suggestion.lat,
      lng: suggestion.lng,
      countryCode: suggestion.countryCode,
    });
  }, [onSelect]);

  return (
    <div className="trip-place-input-wrapper" ref={wrapperRef}>
      <input
        className="trip-place-input"
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={handleChange}
        onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
      />
      {showSuggestions && (
        <ul className="autocomplete-list">
          {suggestions.map((s) => (
            <li
              key={s.id}
              className="autocomplete-item"
              onMouseDown={() => handleSelect(s)}
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
  );
}
