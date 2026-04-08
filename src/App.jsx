import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import './App.css';
import { COUNTRIES, DEFAULT_COUNTRY } from './services/countries';
import { useStations } from './hooks/useStations';
import { detectCountryFromCoords } from './utils/geo';
import { navigateTo } from './utils/url';
import Header from './components/Header';
import SearchBar from './components/SearchBar';
import SavingsBanner from './components/SavingsBanner';
import StationList from './components/StationList';
import LabelStyleToggle from './components/LabelStyleToggle';

const FuelMap = lazy(() => import('./components/FuelMap'));

const TripPage = lazy(() => import('./components/trip/TripPage'));
const SourcesPage = lazy(() => import('./components/sources/SourcesPage'));

const DEFAULT_TITLE = 'FuelSaver — Compare Fuel Prices in 34 Countries | Find Cheapest Gas Stations';
const DEFAULT_DESC = 'Compare real-time fuel prices across 34 countries including France, Germany, Spain, UK, Italy, Australia, India, Brazil, and more. Find the cheapest gas stations near you and save money on every fill-up.';

function getInitialPage() {
  const path = window.location.pathname;
  if (path.startsWith('/trip')) return 'trip';
  if (path.startsWith('/sources')) return 'sources';
  return 'home';
}

function App() {
  const [page, setPage] = useState(getInitialPage);
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [fuelType, setFuelType] = useState(COUNTRIES[DEFAULT_COUNTRY].defaultFuel);
  const [highlightedStation, setHighlightedStation] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const { stations, loading, error, searchCenter, search } = useStations();
  const [labelStyle, setLabelStyle] = useState(() => localStorage.getItem('labelStyle') || 'classic');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleLabelStyleChange = useCallback((style) => {
    setLabelStyle(style);
    localStorage.setItem('labelStyle', style);
  }, []);

  // Handle browser back/forward
  useEffect(() => {
    const onPopState = () => {
      setPage(getInitialPage());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleNavigate = useCallback((target) => {
    const paths = { trip: '/trip', sources: '/sources' };
    navigateTo(paths[target] || '/');
    setPage(target);
  }, []);

  // Dynamic document.title and meta description for SEO
  useEffect(() => {
    if (page === 'trip') {
      document.title = 'Trip Cost Calculator — FuelSaver';
      document.querySelector('meta[name="description"]')?.setAttribute('content',
        'Calculate the fuel cost of your road trip. Enter origin, destination, and vehicle consumption to estimate your travel expenses.'
      );
      return;
    }

    if (page === 'sources') {
      document.title = 'Data Sources — FuelSaver';
      document.querySelector('meta[name="description"]')?.setAttribute('content',
        'FuelSaver data sources: official government APIs and verified databases used for real-time fuel prices across 43 countries.'
      );
      return;
    }

    const countryName = COUNTRIES[country]?.name || '';
    const fuelLabel = COUNTRIES[country]?.fuelTypes.find(f => f.id === fuelType)?.label || '';

    if (searchQuery && countryName) {
      document.title = `Fuel Prices in ${searchQuery} (${countryName}) — ${fuelLabel} | FuelSaver`;
      document.querySelector('meta[name="description"]')?.setAttribute('content',
        `Compare ${fuelLabel} prices at gas stations in ${searchQuery}, ${countryName}. Find the cheapest fuel near you with real-time prices on FuelSaver.`
      );
    } else {
      document.title = DEFAULT_TITLE;
      document.querySelector('meta[name="description"]')?.setAttribute('content', DEFAULT_DESC);
    }
  }, [page, searchQuery, country, fuelType]);

  // On mount, restore cached GPS location if no URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('lat') || params.get('lng')) return; // shared link takes priority

    const cached = localStorage.getItem('lastGpsLocation');
    if (!cached) return;

    try {
      const { lat, lng } = JSON.parse(cached);
      const detected = detectCountryFromCoords(lat, lng);
      if (detected && COUNTRIES[detected]) {
        setCountry(detected);
        const fuel = COUNTRIES[detected].defaultFuel;
        setFuelType(fuel);
        search({ query: '', country: detected, radiusKm: 30, fuelType: fuel, lat, lng });
      }
    } catch { /* ignore corrupt data */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const countryData = COUNTRIES[country];

  const handleCountryDetected = useCallback((code) => {
    setCountry(code);
    setFuelType(COUNTRIES[code].defaultFuel);
  }, []);

  const handleSearch = useCallback(({ query, radiusKm, fuelType: ft, lat, lng, country: detectedCountry, skipFly }) => {
    setFuelType(ft);
    setSearchQuery(query || '');
    if (detectedCountry) {
      setCountry(detectedCountry);
    }
    search({ query, country: detectedCountry || country, radiusKm, fuelType: ft, lat, lng, skipFly });
  }, [country, search]);

  const [hoveredStation, setHoveredStation] = useState(null);

  const handleStationClick = useCallback((station) => {
    if (!station) return;
    setHighlightedStation(station);
  }, []);

  const handleStationHover = useCallback((station) => {
    setHoveredStation(station);
  }, []);

  const handleLocate = useCallback(({ lat, lng }) => {
    localStorage.setItem('lastGpsLocation', JSON.stringify({ lat, lng }));
    search({ query: '', country, radiusKm: 30, fuelType, lat, lng });
  }, [country, fuelType, search]);

  const handleMapMove = useCallback(({ lat, lng, radiusKm }) => {
    const detected = detectCountryFromCoords(lat, lng);
    const targetCountry = detected && COUNTRIES[detected] ? detected : country;

    if (targetCountry !== country) {
      setCountry(targetCountry);
      setFuelType(COUNTRIES[targetCountry].defaultFuel);
      search({ query: '', country: targetCountry, radiusKm, fuelType: COUNTRIES[targetCountry].defaultFuel, lat, lng, skipFly: true });
    } else {
      search({ query: '', country: targetCountry, radiusKm, fuelType, lat, lng, skipFly: true });
    }
  }, [country, fuelType, search]);

  const handleFuelChange = useCallback((newFuel) => {
    setFuelType(newFuel);
    if (searchCenter) {
      search({ query: '', country, radiusKm: 30, fuelType: newFuel, lat: searchCenter.lat, lng: searchCenter.lng, skipFly: true });
    }
  }, [country, searchCenter, search]);

  return (
    <>
      <Header page={page} onNavigate={handleNavigate} />
      <div className="main-layout">
        {page === 'home' ? (
          <>
            <aside className={`sidebar${sidebarOpen ? '' : ' sidebar-collapsed'}`}>
              <button className="sidebar-handle" onClick={() => setSidebarOpen(o => !o)}>
                <span className="sidebar-handle-bar" />
                <span className="sidebar-handle-label">
                  {stations.length > 0 ? `${stations.length} stations` : 'Stations'}
                </span>
                <svg className={`sidebar-handle-chevron${sidebarOpen ? '' : ' flipped'}`} viewBox="0 0 12 8" width="12" height="8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 1l5 5 5-5"/></svg>
              </button>
              <SearchBar onSearch={handleSearch} onCountryDetected={handleCountryDetected} activeFuelType={fuelType} />
              <SavingsBanner
                stations={stations}
                fuelType={fuelType}
                currency={countryData.currency}
                decimals={countryData.decimals}
              />
              <StationList
                stations={stations}
                fuelType={fuelType}
                currency={countryData.currency}
                decimals={countryData.decimals}
                countryCode={country}
                loading={loading}
                error={error}
                onStationClick={handleStationClick}
                onStationHover={handleStationHover}
                onFuelChange={handleFuelChange}
              />
            </aside>
            <div className="map-wrapper">
              <LabelStyleToggle value={labelStyle} onChange={handleLabelStyleChange} />
              <Suspense fallback={<div className="map-container" style={{ background: '#e8e0d8' }} />}>
                <FuelMap
                  center={countryData.center}
                  zoom={countryData.zoom}
                  stations={stations}
                  fuelType={fuelType}
                  currency={countryData.currency}
                  decimals={countryData.decimals}
                  countryCode={country}
                  searchCenter={searchCenter}
                  highlightedStation={highlightedStation}
                  hoveredStation={hoveredStation}
                  onLocate={handleLocate}
                  onMapMove={handleMapMove}
                  labelStyle={labelStyle}
                />
              </Suspense>
            </div>
          </>
        ) : page === 'sources' ? (
          <Suspense fallback={<div className="trip-loading">Loading...</div>}>
            <SourcesPage />
          </Suspense>
        ) : (
          <Suspense fallback={<div className="trip-loading">Loading trip planner...</div>}>
            <TripPage
              sidebarOpen={sidebarOpen}
              setSidebarOpen={setSidebarOpen}
              labelStyle={labelStyle}
              onLabelStyleChange={handleLabelStyleChange}
            />
          </Suspense>
        )}
      </div>
    </>
  );
}

export default App;
