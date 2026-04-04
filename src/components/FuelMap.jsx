import { useRef, useEffect, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { haversineDistance, detectCountryFromCoords } from '../utils/geo';
import { formatPrice, formatUpdated } from '../utils/format';
import { COUNTRIES } from '../services/countries';
import { getBrandLogoUrl } from '../utils/brandLogo';
import { getFuelColor } from '../utils/fuelColors';
import { getMapStyle } from '../utils/mapStyle';

export default function FuelMap({
  center,
  zoom,
  stations,
  fuelType,
  currency,
  decimals,
  countryCode,
  searchCenter,
  highlightedStation,
  hoveredStation,
  onLocate,
  onMapMove,
  labelStyle,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const hoverPopupRef = useRef(null);
  const clickPopupRef = useRef(null);
  const mapLoadedRef = useRef(false);
  const detailBuilderRef = useRef(null);
  const skipMoveRef = useRef(false);
  const moveDebounceRef = useRef(null);
  const lastSearchRef = useRef(null);
  const onMapMoveRef = useRef(onMapMove);
  onMapMoveRef.current = onMapMove;

  // Initialize map
  useEffect(() => {
    if (!containerRef.current) return;

    // Restore zoom from URL if present (for shared links)
    const urlZoom = Number(new URLSearchParams(window.location.search).get('zoom'));
    const initialZoom = urlZoom && urlZoom >= 1 && urlZoom <= 22 ? urlZoom : zoom;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getMapStyle(),
      center: center,
      zoom: initialZoom,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Geolocate button
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: false,
      showUserLocation: true,
    });
    map.addControl(geolocate, 'top-right');

    geolocate.on('geolocate', (e) => {
      if (onLocate && e.coords) {
        onLocate({ lat: e.coords.latitude, lng: e.coords.longitude });
      }
    });

    // Refresh button — re-searches the current viewport
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'map-refresh-btn';
    refreshBtn.title = 'Refresh stations in this area';
    refreshBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
    refreshBtn.addEventListener('click', () => {
      if (map.getZoom() < 9) return;
      const c = map.getCenter();
      const bounds = map.getBounds();
      const radiusKm = haversineDistance(
        c.lat, c.lng,
        bounds.getNorth(), bounds.getEast()
      );
      // Clear cached search area so future auto-searches aren't skipped
      lastSearchRef.current = null;
      onMapMoveRef.current?.({ lat: c.lat, lng: c.lng, radiusKm: Math.min(radiusKm, 50) });
    });
    const refreshContainer = document.createElement('div');
    refreshContainer.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    refreshContainer.appendChild(refreshBtn);
    map.getContainer().querySelector('.maplibregl-ctrl-top-right').appendChild(refreshContainer);

    // Auto-search when user pans or zooms the map
    map.on('moveend', () => {
      // Always sync zoom + detected country to URL
      const params = new URLSearchParams(window.location.search);
      params.set('zoom', Math.round(map.getZoom()));
      const c = map.getCenter();
      const detected = detectCountryFromCoords(c.lat, c.lng);
      if (detected && COUNTRIES[detected]) {
        params.set('country', detected);
        params.set('lat', c.lat.toFixed(4));
        params.set('lng', c.lng.toFixed(4));
      }
      window.history.replaceState(null, '', `?${params.toString()}`);

      if (skipMoveRef.current) {
        skipMoveRef.current = false;
        return;
      }
      // Only search when zoomed in enough (zoom >= 9 ≈ city level)
      if (map.getZoom() < 9) return;

      const bounds = map.getBounds();
      const last = lastSearchRef.current;

      // Skip if current viewport is fully inside the last searched area
      if (last &&
          bounds.getNorth() <= last.north &&
          bounds.getSouth() >= last.south &&
          bounds.getEast() <= last.east &&
          bounds.getWest() >= last.west) {
        return;
      }

      clearTimeout(moveDebounceRef.current);
      moveDebounceRef.current = setTimeout(() => {
        const c = map.getCenter();
        const b = map.getBounds();
        // Radius = distance from center to corner of viewport (covers full rectangle)
        const radiusKm = haversineDistance(
          c.lat, c.lng,
          b.getNorth(), b.getEast()
        );

        // Store the searched area
        lastSearchRef.current = {
          north: b.getNorth(),
          south: b.getSouth(),
          east: b.getEast(),
          west: b.getWest(),
        };

        onMapMoveRef.current?.({ lat: c.lat, lng: c.lng, radiusKm: Math.min(radiusKm, 50) });
      }, 800);
    });

    map.on('load', () => {
      // High-res fuel pump icon (drawn at 2x for crisp scaling)
      const ratio = 2;
      const logical = 32;
      const size = logical * ratio;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);

      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Pump body (rounded rect)
      const bx = 6, by = 7, bw = 14, bh = 17, br = 2;
      ctx.beginPath();
      ctx.moveTo(bx + br, by);
      ctx.lineTo(bx + bw - br, by);
      ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + br);
      ctx.lineTo(bx + bw, by + bh - br);
      ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh);
      ctx.lineTo(bx + br, by + bh);
      ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - br);
      ctx.lineTo(bx, by + br);
      ctx.quadraticCurveTo(bx, by, bx + br, by);
      ctx.fill();

      // Display window on pump body
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(9, 10, 8, 5);
      ctx.fillStyle = '#ffffff';

      // Nozzle hose
      ctx.beginPath();
      ctx.moveTo(20, 11);
      ctx.lineTo(24, 8);
      ctx.lineTo(24, 18);
      ctx.lineTo(22, 20);
      ctx.stroke();

      // Nozzle tip
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(22, 20);
      ctx.lineTo(22, 23);
      ctx.stroke();
      ctx.lineWidth = 1.5;

      // Base plate
      ctx.fillRect(5, 25, 16, 2);

      // Top handle
      ctx.fillRect(9, 5, 8, 2);

      map.addImage('fuel-icon', { width: size, height: size, data: ctx.getImageData(0, 0, size, size).data }, { pixelRatio: ratio });

      mapLoadedRef.current = true;
    });

    mapRef.current = map;

    return () => {
      mapLoadedRef.current = false;
      clearTimeout(moveDebounceRef.current);
      map.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update center/zoom when country changes (skip if a search will fitBounds)
  useEffect(() => {
    if (!mapRef.current || searchCenter) return;
    skipMoveRef.current = true;
    mapRef.current.flyTo({ center, zoom, duration: 1000 });
  }, [center, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fly to search location (only for SearchBar/geolocate searches, not map-move)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !searchCenter || searchCenter.skipFly) return;

    // Clear last search area so the new location gets a fresh search on moveend
    lastSearchRef.current = null;

    const fly = () => {
      skipMoveRef.current = true;
      map.flyTo({
        center: [searchCenter.lng, searchCenter.lat],
        zoom: Math.max(map.getZoom(), 12),
        duration: 800,
      });
    };

    if (mapLoadedRef.current) {
      fly();
    } else {
      map.on('load', fly);
    }
  }, [searchCenter]);

  // Place station markers using native map layers (no DOM lag)
  const updateMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (hoverPopupRef.current) { hoverPopupRef.current.remove(); hoverPopupRef.current = null; }
    if (clickPopupRef.current) { clickPopupRef.current.remove(); clickPopupRef.current = null; }

    // Remove old pill images
    if (map._pillIds) {
      for (const id of map._pillIds) {
        if (map.hasImage(id)) map.removeImage(id);
      }
    }
    map._pillIds = [];

    // Build GeoJSON from stations
    const withPrice = stations
      .filter((s) => s.lat != null && s.lng != null)
      .sort((a, b) => (a.prices[fuelType] ?? Infinity) - (b.prices[fuelType] ?? Infinity));

    const minPrice = withPrice.length ? withPrice[0].prices[fuelType] : 0;
    const maxPrice = withPrice.length ? withPrice[withPrice.length - 1].prices[fuelType] : 0;

    // Get fuel type labels for the current country
    const countryConfig = COUNTRIES[countryCode] || {};
    const fuelLabels = {};
    for (const ft of countryConfig.fuelTypes || []) {
      fuelLabels[ft.id] = ft.label;
    }

    const features = withPrice.map((station, rankIdx) => {
      const price = station.prices[fuelType];
      let color = '#9ca3af'; // gray for no price
      if (price != null && minPrice != null && maxPrice != null && withPrice.length > 1) {
        const ratio = (price - minPrice) / (maxPrice - minPrice || 1);
        if (ratio < 0.25) color = '#22c55e';
        else if (ratio > 0.75) color = '#ef4444';
        else color = '#f97316';
      } else if (price != null) {
        color = '#f97316';
      }
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [station.lng, station.lat] },
        properties: {
          stationId: station.id,
          rank: String(rankIdx + 1),
          color,
          brand: station.brand,
          logoUrl: station.logo || getBrandLogoUrl(station.brand) || '',
          pillId: '',  // set later by pill generator
          price: price != null ? formatPrice(price, currency, decimals) : station.brand,
          name: station.name || '',
          address: station.address + (station.city ? ', ' + station.city : ''),
          allPrices: JSON.stringify(station.prices),
          updatedAt: station.updatedAt || '',
          distance: station.distance != null ? station.distance.toFixed(1) : '',
          services: JSON.stringify(station.services || []),
          is24h: station.is24h ? 'true' : '',
          outOfStock: JSON.stringify(station.outOfStock || []),
        },
      };
    });

    const geojson = { type: 'FeatureCollection', features };

    // Service → icon mapping for French stations
    const SERVICE_ICONS = {
      'Toilettes publiques': { icon: '\uD83D\uDEBD', label: 'WC' },
      'Boutique alimentaire': { icon: '\uD83C\uDFEA', label: 'Shop' },
      'Boutique non alimentaire': { icon: '\uD83D\uDECD\uFE0F', label: 'Shop' },
      'DAB (Distributeur automatique de billets)': { icon: '\uD83D\uDCB3', label: 'ATM' },
      'Station de gonflage': { icon: '\uD83D\uDCA8', label: 'Air' },
      'Lavage automatique': { icon: '\uD83E\uDEE7', label: 'Wash' },
      'Lavage manuel': { icon: '\uD83E\uDEE7', label: 'Wash' },
      'Services réparation / entretien': { icon: '\uD83D\uDD27', label: 'Repair' },
      'Carburant additivé': { icon: '\u26FD', label: 'Additive' },
      'Piste poids lourds': { icon: '\uD83D\uDE9B', label: 'Truck' },
      'Relais colis': { icon: '\uD83D\uDCE6', label: 'Parcel' },
      'Vente de pétrole lampant': { icon: '\uD83E\uDE94', label: 'Lamp oil' },
      'Aire de camping-cars': { icon: '\uD83D\uDE90', label: 'Camper' },
      'Vente de gaz domestique (Butane, Propane)': { icon: '\uD83D\uDD25', label: 'Gas' },
      'Bornes électriques': { icon: '\u26A1', label: 'EV' },
      'Automate CB 24/24': { icon: '\uD83C\uDFE7', label: 'Card 24/7' },
      'Wifi': { icon: '\uD83D\uDCF6', label: 'WiFi' },
      'Location de véhicule': { icon: '\uD83D\uDE97', label: 'Rental' },
    };

    // Helper: build detail popup HTML (stored in ref so click handler stays current)
    detailBuilderRef.current = (props) => {
      const prices = JSON.parse(props.allPrices || '{}');
      const outOfStock = JSON.parse(props.outOfStock || '[]');
      const services = JSON.parse(props.services || '[]');
      const is24h = props.is24h === 'true';

      // Build price rows, marking out-of-stock fuels
      let priceRows = '';
      for (const [fuelId, val] of Object.entries(prices)) {
        if (val == null) continue;
        const label = fuelLabels[fuelId] || fuelId;
        const isSelected = fuelId === fuelType;
        const color = getFuelColor(fuelId);
        const indicator = `<span style="display:inline-block;width:4px;height:18px;border-radius:2px;background:${color};margin-right:6px;vertical-align:middle"></span>`;
        const isOut = outOfStock.some(
          (s) => s.toLowerCase() === fuelId.toLowerCase() || s.toLowerCase() === label.toLowerCase()
        );
        if (isOut) {
          priceRows += `<tr class="map-popup-out-of-stock">
            <td class="map-popup-fuel-label">${indicator}<s>${label}</s></td>
            <td class="map-popup-fuel-price map-popup-oos-text">out of stock</td>
          </tr>`;
        } else {
          priceRows += `<tr class="${isSelected ? 'map-popup-selected' : ''}">
            <td class="map-popup-fuel-label">${indicator}${label}</td>
            <td class="map-popup-fuel-price">${formatPrice(val, currency, decimals)}</td>
          </tr>`;
        }
      }
      // Add out-of-stock fuels that aren't already in prices
      for (const oos of outOfStock) {
        const alreadyListed = Object.keys(prices).some(
          (k) => k.toLowerCase() === oos.toLowerCase() || (fuelLabels[k] || '').toLowerCase() === oos.toLowerCase()
        );
        if (!alreadyListed) {
          priceRows += `<tr class="map-popup-out-of-stock">
            <td class="map-popup-fuel-label"><s>${oos}</s></td>
            <td class="map-popup-fuel-price map-popup-oos-text">out of stock</td>
          </tr>`;
        }
      }

      const updatedStr = props.updatedAt ? formatUpdated(props.updatedAt) : '';
      const distStr = props.distance ? `${props.distance} km` : '';
      const meta = [updatedStr, distStr].filter(Boolean).join(' \u00B7 ');

      const logoHtml = props.logoUrl
        ? `<img class="map-popup-logo" src="${props.logoUrl}" alt="" onerror="this.style.display='none'" />`
        : '';

      // 24/7 badge
      const badgeHtml = is24h
        ? '<div class="map-popup-badge-24h">24/7</div>'
        : '';

      // Service icons
      let servicesHtml = '';
      if (services.length > 0) {
        const seen = new Set();
        const icons = services
          .map((s) => {
            // Try exact match, then partial match
            let match = SERVICE_ICONS[s];
            if (!match) {
              const key = Object.keys(SERVICE_ICONS).find(
                (k) => s.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(s.toLowerCase())
              );
              if (key) match = SERVICE_ICONS[key];
            }
            if (!match || seen.has(match.label)) return '';
            seen.add(match.label);
            return `<span class="map-popup-service" data-tooltip="${match.label}">${match.icon}</span>`;
          })
          .filter(Boolean)
          .join('');
        if (icons) {
          servicesHtml = `<div class="map-popup-services">${icons}</div>`;
        }
      }

      const nameHtml = props.name && props.name !== props.brand
        ? `<div class="map-popup-name">${props.name}</div>`
        : '';

      return `<div class="map-popup map-popup-detail">
        <div class="map-popup-header">${logoHtml}<div class="map-popup-brand">${props.brand}</div></div>
        ${nameHtml}
        <div class="map-popup-address">${props.address}</div>
        ${badgeHtml}
        ${priceRows ? `<table class="map-popup-prices">${priceRows}</table>` : ''}
        ${servicesHtml}
        ${meta ? `<div class="map-popup-meta">${meta}</div>` : ''}
      </div>`;
    };

    // Generate marker images for zoom >= 12
    const ratio = 3; // 3x for crisp retina rendering
    const isPin = labelStyle === 'pin';
    const fontSize = 13 * ratio;
    const font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

    // Measure text
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    measureCtx.font = font;

    const pendingLogos = new Map();
    const totalStations = features.length;

    // Classic pill dimensions
    const pillH = 32 * ratio;
    const logoSize = 24 * ratio;
    const padX = 6 * ratio;
    const gap = 4 * ratio;
    const pillRadius = pillH / 2;
    const arrowH = 6 * ratio; // pointer triangle height

    // Pin dimensions
    const pinLogoSize = 40 * ratio;
    const pinBorder = 3 * ratio;
    const pinRibbonPadX = 8 * ratio;
    const pinRibbonPadY = 3 * ratio;
    const pinRibbonRadius = 4 * ratio;
    const pinArrowH = 8 * ratio;
    const pinGap = -3 * ratio; // overlap ribbon onto logo slightly

    for (const f of features) {
      const { price, logoUrl, stationId, rank } = f.properties;
      const pillId = `pill-${stationId}`;
      f.properties.pillId = pillId;
      map._pillIds.push(pillId);

      const rankNum = parseInt(rank, 10);
      let textColor = '#1f2937';
      let accentColor = '#f97316';
      if (rankNum === 1) { textColor = '#16a34a'; accentColor = '#16a34a'; }
      else if (rankNum === totalStations) { textColor = '#dc2626'; accentColor = '#dc2626'; }

      const textW = measureCtx.measureText(price).width;
      const hasLogo = !!logoUrl;

      const drawMarker = (logoImg) => {
        let canvas, ctx;

        if (isPin) {
          // --- PIN STYLE: logo circle on top, ribbon below, arrow ---
          const ribbonW = pinRibbonPadX + textW + pinRibbonPadX;
          const totalW = Math.max(pinLogoSize + pinBorder * 2, ribbonW);
          const totalH = pinLogoSize + pinBorder * 2 + pinGap + pinRibbonPadY * 2 + fontSize + pinArrowH;

          canvas = document.createElement('canvas');
          canvas.width = Math.ceil(totalW);
          canvas.height = Math.ceil(totalH);
          ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          const cx = totalW / 2;
          const logoR = pinLogoSize / 2;
          const logoOuterR = logoR + pinBorder;
          const logoCY = logoOuterR;

          // Logo circle border
          ctx.fillStyle = accentColor;
          ctx.beginPath();
          ctx.arc(cx, logoCY, logoOuterR, 0, Math.PI * 2);
          ctx.fill();

          // Logo circle white fill
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(cx, logoCY, logoR, 0, Math.PI * 2);
          ctx.fill();

          // Logo image
          if (logoImg) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, logoCY, logoR * 0.85, 0, Math.PI * 2);
            ctx.clip();
            const iw = logoImg.naturalWidth || logoImg.width;
            const ih = logoImg.naturalHeight || logoImg.height;
            const s = Math.min((logoR * 1.7) / iw, (logoR * 1.7) / ih);
            const sw = iw * s, sh = ih * s;
            ctx.drawImage(logoImg, cx - sw / 2, logoCY - sh / 2, sw, sh);
            ctx.restore();
          } else {
            // Fallback letter
            ctx.fillStyle = '#9ca3af';
            ctx.font = `bold ${pinLogoSize * 0.4}px -apple-system, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(f.properties.brand.charAt(0), cx, logoCY);
          }

          // Ribbon background
          const ribbonY = logoCY + logoOuterR + pinGap;
          const ribbonH = pinRibbonPadY * 2 + fontSize;
          const ribbonX = (totalW - ribbonW) / 2;
          ctx.fillStyle = accentColor;
          ctx.beginPath();
          ctx.moveTo(ribbonX + pinRibbonRadius, ribbonY);
          ctx.lineTo(ribbonX + ribbonW - pinRibbonRadius, ribbonY);
          ctx.arc(ribbonX + ribbonW - pinRibbonRadius, ribbonY + pinRibbonRadius, pinRibbonRadius, -Math.PI / 2, 0);
          ctx.lineTo(ribbonX + ribbonW, ribbonY + ribbonH - pinRibbonRadius);
          ctx.arc(ribbonX + ribbonW - pinRibbonRadius, ribbonY + ribbonH - pinRibbonRadius, pinRibbonRadius, 0, Math.PI / 2);
          ctx.lineTo(ribbonX + pinRibbonRadius, ribbonY + ribbonH);
          ctx.arc(ribbonX + pinRibbonRadius, ribbonY + ribbonH - pinRibbonRadius, pinRibbonRadius, Math.PI / 2, Math.PI);
          ctx.lineTo(ribbonX, ribbonY + pinRibbonRadius);
          ctx.arc(ribbonX + pinRibbonRadius, ribbonY + pinRibbonRadius, pinRibbonRadius, Math.PI, -Math.PI / 2);
          ctx.closePath();
          ctx.fill();

          // Ribbon text
          ctx.fillStyle = '#ffffff';
          ctx.font = font;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(price, cx, ribbonY + ribbonH / 2);

          // Arrow
          const arrowY = ribbonY + ribbonH;
          ctx.fillStyle = accentColor;
          ctx.beginPath();
          ctx.moveTo(cx - 6 * ratio, arrowY);
          ctx.lineTo(cx + 6 * ratio, arrowY);
          ctx.lineTo(cx, arrowY + pinArrowH);
          ctx.closePath();
          ctx.fill();

        } else {
          // --- CLASSIC PILL + pointer ---
          const pillW = padX + (hasLogo ? logoSize + gap : 0) + textW + padX;
          const totalH = pillH + arrowH;

          canvas = document.createElement('canvas');
          canvas.width = Math.ceil(pillW);
          canvas.height = Math.ceil(totalH);
          ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          // White rounded rect
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(pillRadius, 0);
          ctx.lineTo(pillW - pillRadius, 0);
          ctx.arc(pillW - pillRadius, pillRadius, pillRadius, -Math.PI / 2, Math.PI / 2);
          ctx.lineTo(pillRadius, pillH);
          ctx.arc(pillRadius, pillRadius, pillRadius, Math.PI / 2, -Math.PI / 2);
          ctx.closePath();
          ctx.fill();

          ctx.strokeStyle = '#e5e7eb';
          ctx.lineWidth = 1.5 * ratio;
          ctx.stroke();

          // Pointer triangle
          const midX = pillW / 2;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(midX - 5 * ratio, pillH - 1 * ratio);
          ctx.lineTo(midX + 5 * ratio, pillH - 1 * ratio);
          ctx.lineTo(midX, pillH + arrowH);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#e5e7eb';
          ctx.lineWidth = 1.5 * ratio;
          ctx.stroke();
          // Cover the border line between pill and arrow
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(midX - 5 * ratio + 1, pillH - 2 * ratio, 10 * ratio - 2, 3 * ratio);

          let textX = padX;

          if (logoImg) {
            const lx = padX;
            const ly = (pillH - logoSize) / 2;
            ctx.save();
            ctx.beginPath();
            ctx.arc(lx + logoSize / 2, ly + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            const iw = logoImg.naturalWidth || logoImg.width;
            const ih = logoImg.naturalHeight || logoImg.height;
            const scale = Math.min(logoSize / iw, logoSize / ih);
            const sw = iw * scale, sh = ih * scale;
            ctx.drawImage(logoImg, lx + (logoSize - sw) / 2, ly + (logoSize - sh) / 2, sw, sh);
            ctx.restore();
            textX = padX + logoSize + gap;
          }

          ctx.fillStyle = textColor;
          ctx.font = font;
          ctx.textBaseline = 'middle';
          ctx.fillText(price, textX, pillH / 2);
        }

        if (!map.hasImage(pillId)) {
          map.addImage(pillId, { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data }, { pixelRatio: ratio });
        }
      };

      if (hasLogo) {
        if (!pendingLogos.has(logoUrl)) pendingLogos.set(logoUrl, []);
        pendingLogos.get(logoUrl).push({ drawPill: drawMarker, pillId });
        drawMarker(null);
      } else {
        drawMarker(null);
      }
    }

    // Load logo images and redraw pills
    for (const [logoUrl, entries] of pendingLogos) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        for (const { drawPill, pillId } of entries) {
          if (map.hasImage(pillId)) map.removeImage(pillId);
          drawPill(img);
        }
        // Trigger repaint
        const src = map.getSource('stations');
        if (src) src.setData(geojson);
      };
      img.src = logoUrl;
    }

    // Update or create the source
    const source = map.getSource('stations');
    if (source) {
      source.setData(geojson);
    } else {
      map.addSource('stations', {
        type: 'geojson',
        data: geojson,
      });

      // Station markers with logo + price at all zoom levels
      map.addLayer({
        id: 'stations-pill',
        type: 'symbol',
        source: 'stations',
        filter: ['!=', ['get', 'pillId'], ''],
        layout: {
          'icon-image': ['get', 'pillId'],
          'icon-allow-overlap': ['step', ['zoom'], false, 14, true],
          'icon-ignore-placement': false,
          'icon-padding': 0,
          'icon-size': 1,
          'icon-anchor': 'bottom',
          'symbol-sort-key': ['to-number', ['get', 'rank']],
        },
      });

      // Pointer cursor on hover
      map.on('mouseenter', 'stations-pill', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'stations-pill', () => {
        map.getCanvas().style.cursor = '';
        if (hoverPopupRef.current) { hoverPopupRef.current.remove(); hoverPopupRef.current = null; }
      });

      // Detailed popup on click
      map.on('click', 'stations-pill', (e) => {
        if (!e.features || !e.features.length) return;
        const f = e.features[0];
        const coords = f.geometry.coordinates.slice();

        if (hoverPopupRef.current) { hoverPopupRef.current.remove(); hoverPopupRef.current = null; }
        if (clickPopupRef.current) clickPopupRef.current.remove();

        clickPopupRef.current = new maplibregl.Popup({
          offset: 24,
          closeButton: true,
          closeOnClick: true,
          maxWidth: '280px',
        })
          .setLngLat(coords)
          .setHTML(detailBuilderRef.current(f.properties))
          .addTo(map);
      });
    }
  }, [stations, fuelType, currency, decimals, countryCode, labelStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mapLoadedRef.current) {
      updateMarkers();
    } else {
      map.on('load', updateMarkers);
    }
  }, [updateMarkers]);

  // Halo on hover from station list (no zoom)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    const hlId = hoveredStation?.id || '';

    // Add the halo layer once (rendered below the station circles)
    if (!map.getLayer('station-halo')) {
      map.addLayer(
        {
          id: 'station-halo',
          type: 'circle',
          source: 'stations',
          filter: ['has', 'stationId'],
          paint: {
            'circle-radius': 26,
            'circle-color': '#f97316',
            'circle-opacity': 0,
            'circle-stroke-width': 0,
          },
        },
        'stations-pill' // insert below station markers
      );
    }

    // Toggle halo visibility via opacity
    map.setPaintProperty('station-halo', 'circle-opacity', [
      'case',
      ['==', ['get', 'stationId'], hlId],
      0.25,
      0,
    ]);
    map.setPaintProperty('station-halo', 'circle-radius', [
      'case',
      ['==', ['get', 'stationId'], hlId],
      26,
      0,
    ]);
  }, [hoveredStation]);

  // Fly to station on click from station list
  useEffect(() => {
    if (!mapRef.current || !highlightedStation) return;
    skipMoveRef.current = true;
    mapRef.current.flyTo({
      center: [highlightedStation.lng, highlightedStation.lat],
      zoom: Math.max(mapRef.current.getZoom(), 14),
      duration: 500,
    });
  }, [highlightedStation]);

  return <div ref={containerRef} className="map-container" />;
}
