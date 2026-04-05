import { useRef, useEffect, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { getMapStyle } from '../../utils/mapStyle';
import { formatPrice } from '../../utils/format';
import { COUNTRIES } from '../../services/countries';
import { getBrandLogoUrl } from '../../utils/brandLogo';

export default function TripMap({ route, origin, destination, waypoints, recommendedStations, highlightedStation, labelStyle }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]); // only for origin/dest/waypoint dots
  const pillIdsRef = useRef([]);
  const clickPopupRef = useRef(null);

  // Initialize map
  useEffect(() => {
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getMapStyle(),
      center: [2.3522, 48.8566],
      zoom: 5,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      // Route
      map.addSource('route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#c2410c', 'line-width': 7, 'line-opacity': 0.4 },
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#f97316', 'line-width': 4, 'line-opacity': 0.9 },
      });

      // Station symbols source + layer
      map.addSource('trip-stations', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'trip-stations-pill',
        type: 'symbol',
        source: 'trip-stations',
        filter: ['!=', ['get', 'pillId'], ''],
        layout: {
          'icon-image': ['get', 'pillId'],
          'icon-allow-overlap': ['step', ['zoom'], false, 13, true],
          'icon-ignore-placement': false,
          'icon-padding': 0,
          'icon-size': 1,
          'icon-anchor': 'bottom',
          'symbol-sort-key': ['to-number', ['get', 'rank']],
        },
      });

      // Click popup on station
      map.on('click', 'trip-stations-pill', (e) => {
        if (!e.features?.length) return;
        const f = e.features[0];
        const coords = f.geometry.coordinates.slice();
        if (clickPopupRef.current) clickPopupRef.current.remove();
        clickPopupRef.current = new maplibregl.Popup({ offset: 24, closeButton: true, maxWidth: '280px' })
          .setLngLat(coords)
          .setHTML(f.properties.popupHtml)
          .addTo(map);
      });
      map.on('mouseenter', 'trip-stations-pill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'trip-stations-pill', () => { map.getCanvas().style.cursor = ''; });
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Draw station canvas images and update the symbol layer
  const updateStationLayer = useCallback((map, stations, style) => {
    // Clean old pill images
    for (const id of pillIdsRef.current) {
      if (map.hasImage(id)) map.removeImage(id);
    }
    pillIdsRef.current = [];

    if (!stations?.length) {
      const src = map.getSource('trip-stations');
      if (src) src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const ratio = 3;
    const font = `bold ${13 * ratio}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    measureCtx.font = font;

    const isPin = style === 'pin';
    const totalStations = stations.length;
    const pendingLogos = new Map();

    const features = stations.map((station, i) => {
      const sc = COUNTRIES[station.countryCode];
      const priceStr = formatPrice(station.price, sc?.currency || '\u20AC', sc?.decimals || 3);
      const logoUrl = station.logo || getBrandLogoUrl(station.brand, station.countryCode) || '';
      const isBest = i === 0;
      const isWorst = i === totalStations - 1 && totalStations > 1;

      let accentColor = '#f97316';
      let textColor = '#1f2937';
      if (isBest) { accentColor = '#16a34a'; textColor = '#16a34a'; }
      else if (isWorst) { accentColor = '#dc2626'; textColor = '#dc2626'; }

      const pillId = `trip-pill-${station.id}`;
      pillIdsRef.current.push(pillId);
      const textW = measureCtx.measureText(priceStr).width;
      const hasLogo = !!logoUrl;

      // Popup HTML
      const popupHtml = `<div style="font-size:13px;">
        <strong>${station.brand}</strong><br/>
        ${station.address}${station.city ? ', ' + station.city : ''}<br/>
        <span style="color:${accentColor};font-weight:700;">${priceStr}</span>
        <span style="color:#6b7280;"> per ${sc?.unit || 'L'}</span>
        ${isBest ? '<br/><em style="color:#16a34a;">Best price along route</em>' : ''}
      </div>`;

      const drawMarker = (logoImg) => {
        let canvas, ctx;

        if (isPin) {
          const pinLogoSize = 40 * ratio;
          const pinBorder = 3 * ratio;
          const pinRibbonPadX = 8 * ratio;
          const pinRibbonPadY = 3 * ratio;
          const pinRibbonRadius = 4 * ratio;
          const pinArrowH = 8 * ratio;
          const pinGap = -3 * ratio;
          const fontSize = 13 * ratio;

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

          ctx.fillStyle = accentColor;
          ctx.beginPath();
          ctx.arc(cx, logoCY, logoOuterR, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(cx, logoCY, logoR, 0, Math.PI * 2);
          ctx.fill();

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
            ctx.fillStyle = '#9ca3af';
            ctx.font = `bold ${pinLogoSize * 0.4}px -apple-system, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(station.brand.charAt(0), cx, logoCY);
          }

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

          ctx.fillStyle = '#ffffff';
          ctx.font = font;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(priceStr, cx, ribbonY + ribbonH / 2);

          const arrowY = ribbonY + ribbonH;
          ctx.fillStyle = accentColor;
          ctx.beginPath();
          ctx.moveTo(cx - 6 * ratio, arrowY);
          ctx.lineTo(cx + 6 * ratio, arrowY);
          ctx.lineTo(cx, arrowY + pinArrowH);
          ctx.closePath();
          ctx.fill();
        } else {
          // Classic pill + pointer
          const pillH = 32 * ratio;
          const logoSize = 24 * ratio;
          const padX = 6 * ratio;
          const gap = 4 * ratio;
          const pillRadius = pillH / 2;
          const arrowH = 6 * ratio;

          const pillW = padX + (hasLogo && logoImg ? logoSize + gap : 0) + textW + padX;
          const totalH = pillH + arrowH;

          canvas = document.createElement('canvas');
          canvas.width = Math.ceil(pillW);
          canvas.height = Math.ceil(totalH);
          ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

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
          ctx.fillText(priceStr, textX, pillH / 2);
        }

        if (map.hasImage(pillId)) map.removeImage(pillId);
        map.addImage(pillId, {
          width: canvas.width, height: canvas.height,
          data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        }, { pixelRatio: ratio });
      };

      // Queue logo loading
      if (hasLogo) {
        if (!pendingLogos.has(logoUrl)) pendingLogos.set(logoUrl, []);
        pendingLogos.get(logoUrl).push({ drawMarker, pillId });
        drawMarker(null); // fallback immediately
      } else {
        drawMarker(null);
      }

      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [station.lng, station.lat] },
        properties: { pillId, rank: String(i + 1), popupHtml },
      };
    });

    const geojson = { type: 'FeatureCollection', features };
    const src = map.getSource('trip-stations');
    if (src) src.setData(geojson);

    // Load logos async
    for (const [logoUrl, entries] of pendingLogos) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        for (const { drawMarker: draw, pillId: pid } of entries) {
          draw(img);
        }
        const s = map.getSource('trip-stations');
        if (s) s.setData(geojson);
      };
      img.src = logoUrl;
    }
  }, []);

  // Update route + markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      // Clear origin/dest/waypoint dots
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      if (clickPopupRef.current) { clickPopupRef.current.remove(); clickPopupRef.current = null; }

      // Update route
      const routeSrc = map.getSource('route');
      if (routeSrc) {
        routeSrc.setData(route?.geometry
          ? { type: 'Feature', geometry: route.geometry, properties: {} }
          : { type: 'FeatureCollection', features: [] }
        );
      }

      // Origin/dest/waypoint dots (DOM markers — only a few)
      const addDot = (point, color) => {
        if (!point?.lat) return;
        const el = document.createElement('div');
        el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);`;
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([point.lng, point.lat])
          .addTo(map);
        markersRef.current.push(marker);
      };
      addDot(origin, '#16a34a');
      (waypoints || []).forEach(wp => addDot(wp, '#f97316'));
      addDot(destination, '#dc2626');

      // Station symbols via canvas layer
      updateStationLayer(map, recommendedStations, labelStyle);

      // Fit bounds
      if (route?.geometry?.coordinates?.length > 1) {
        const coords = route.geometry.coordinates;
        const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
        if (recommendedStations?.length) {
          for (const s of recommendedStations) bounds.extend([s.lng, s.lat]);
        }
        map.fitBounds(bounds, { padding: 60, duration: 800 });
      } else if (origin?.lat && destination?.lat) {
        map.fitBounds(new maplibregl.LngLatBounds([origin.lng, origin.lat], [destination.lng, destination.lat]), { padding: 60, duration: 800 });
      }
    };

    if (map.isStyleLoaded()) update();
    else map.once('load', update);
  }, [route, origin, destination, waypoints, recommendedStations, labelStyle, updateStationLayer]);

  // Fly to highlighted station
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !highlightedStation?.lat) return;

    map.flyTo({
      center: [highlightedStation.lng, highlightedStation.lat],
      zoom: Math.max(map.getZoom(), 13),
      duration: 500,
    });

    // Open popup
    if (clickPopupRef.current) clickPopupRef.current.remove();
    const sc = COUNTRIES[highlightedStation.countryCode];
    const priceStr = formatPrice(highlightedStation.price, sc?.currency || '\u20AC', sc?.decimals || 3);
    const accentColor = highlightedStation === recommendedStations?.[0] ? '#16a34a' : '#f97316';
    clickPopupRef.current = new maplibregl.Popup({ offset: 24, closeButton: true, maxWidth: '280px' })
      .setLngLat([highlightedStation.lng, highlightedStation.lat])
      .setHTML(`<div style="font-size:13px;">
        <strong>${highlightedStation.brand}</strong><br/>
        ${highlightedStation.address}${highlightedStation.city ? ', ' + highlightedStation.city : ''}<br/>
        <span style="color:${accentColor};font-weight:700;">${priceStr}</span>
        <span style="color:#6b7280;"> per ${sc?.unit || 'L'}</span>
      </div>`)
      .addTo(map);
  }, [highlightedStation, recommendedStations]);

  return <div ref={containerRef} className="map-container" />;
}
