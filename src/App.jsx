import { useState, useCallback, useEffect } from 'react';
import './App.css';
import { COUNTRIES, DEFAULT_COUNTRY } from './services/countries';
import { useStations } from './hooks/useStations';
import { useTripRoute } from './hooks/useTripRoute';
import { detectCountryFromCoords } from './utils/geo';
import { navigateTo } from './utils/url';
import Header from './components/Header';
import SearchBar from './components/SearchBar';
import SavingsBanner from './components/SavingsBanner';
import StationList from './components/StationList';
import FuelMap from './components/FuelMap';
import TripSidebar from './components/trip/TripSidebar';
import TripMap from './components/trip/TripMap';
import LabelStyleToggle from './components/LabelStyleToggle';

const DEFAULT_TITLE = 'FuelSaver — Compare Fuel Prices in 34 Countries | Find Cheapest Gas Stations';
const DEFAULT_DESC = 'Compare real-time fuel prices across 34 countries including France, Germany, Spain, UK, Italy, Australia, India, Brazil, and more. Find the cheapest gas stations near you and save money on every fill-up.';

function getInitialPage() {
  return window.location.hash.startsWith('#/trip') ? 'trip' : 'home';
}

function App() {
  const [page, setPage] = useState(getInitialPage);
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [fuelType, setFuelType] = useState(COUNTRIES[DEFAULT_COUNTRY].defaultFuel);
  const [highlightedStation, setHighlightedStation] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const { stations, loading, error, searchCenter, search } = useStations();
  const trip = useTripRoute();
  const [tripHighlightedStation, setTripHighlightedStation] = useState(null);
  const [labelStyle, setLabelStyle] = useState(() => localStorage.getItem('labelStyle') || 'classic');

  const handleLabelStyleChange = useCallback((style) => {
    setLabelStyle(style);
    localStorage.setItem('labelStyle', style);
  }, []);

  // Handle browser back/forward
  useEffect(() => {
    const onHashChange = () => {
      setPage(window.location.hash.startsWith('#/trip') ? 'trip' : 'home');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleNavigate = useCallback((target) => {
    navigateTo(target === 'trip' ? '#/trip' : '#/');
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
            <aside className="sidebar">
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
            </div>
          </>
        ) : (
          <>
            <aside className="sidebar">
              <TripSidebar
                origin={trip.origin}
                setOrigin={trip.setOrigin}
                destination={trip.destination}
                setDestination={trip.setDestination}
                waypoints={trip.waypoints}
                addWaypoint={trip.addWaypoint}
                removeWaypoint={trip.removeWaypoint}
                updateWaypoint={trip.updateWaypoint}
                consumption={trip.consumption}
                setConsumption={trip.setConsumption}
                tankCapacity={trip.tankCapacity}
                setTankCapacity={trip.setTankCapacity}
                fuelType={trip.fuelType}
                setFuelType={trip.setFuelType}
                countryData={trip.countryData}
                tripCost={trip.tripCost}
                loading={trip.loading}
                error={trip.error}
                recommendedStations={trip.recommendedStations}
                stationsLoading={trip.stationsLoading}
                calculate={trip.calculate}
                invertRoute={trip.invertRoute}
                onStationClick={setTripHighlightedStation}
              />
            </aside>
            <div className="map-wrapper">
              <LabelStyleToggle value={labelStyle} onChange={handleLabelStyleChange} />
              <TripMap
                route={trip.route}
                origin={trip.origin}
                destination={trip.destination}
                waypoints={trip.waypoints}
                recommendedStations={trip.recommendedStations}
                highlightedStation={tripHighlightedStation}
                labelStyle={labelStyle}
              />
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default App;
