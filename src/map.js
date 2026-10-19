// MapLibre globe with a self-hosted vector basemap (no tiles, no API keys).

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { feature, mesh } from 'topojson-client';
import countriesUrl from 'world-atlas/countries-50m.json?url';
import { bounds, unwrapAround } from './geo.js';

const EMPTY = { type: 'FeatureCollection', features: [] };

const PALETTES = {
  light: {
    ocean: '#c9dde3', land: '#f3efe4', border: '#c8bfa9', coast: '#a9b9b8',
    river: '#1f6fa8', riverCasing: '#ffffff', basin: '#2f8f6b', ghost: '#d9822b', link: '#5b5146',
  },
  dark: {
    ocean: '#10222b', land: '#26302f', border: '#46504b', coast: '#3b5157',
    river: '#6cc0f5', riverCasing: '#0b1418', basin: '#4fc59a', ghost: '#f2a65a', link: '#d6cbbd',
  },
};

function palette() {
  return matchMedia('(prefers-color-scheme: dark)').matches ? PALETTES.dark : PALETTES.light;
}

function style(c) {
  return {
    version: 8,
    projection: { type: 'globe' },
    sky: { 'atmosphere-blend': 0 },
    sources: {
      land: { type: 'geojson', data: EMPTY },
      coast: { type: 'geojson', data: EMPTY },
      borders: { type: 'geojson', data: EMPTY },
      river: { type: 'geojson', data: EMPTY },
      basin: { type: 'geojson', data: EMPTY },
      ghost: { type: 'geojson', data: EMPTY },
      link: { type: 'geojson', data: EMPTY },
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': c.ocean } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': c.land } },
      { id: 'coast', type: 'line', source: 'coast', paint: { 'line-color': c.coast, 'line-width': 0.6 } },
      { id: 'borders', type: 'line', source: 'borders', paint: { 'line-color': c.border, 'line-width': 0.6, 'line-dasharray': [2, 1.5] } },
      { id: 'basin-fill', type: 'fill', source: 'basin', paint: { 'fill-color': c.basin, 'fill-opacity': 0.22 } },
      { id: 'basin-line', type: 'line', source: 'basin', paint: { 'line-color': c.basin, 'line-width': 2 } },
      { id: 'ghost-fill', type: 'fill', source: 'ghost', paint: { 'fill-color': c.ghost, 'fill-opacity': 0.25 } },
      { id: 'ghost-line', type: 'line', source: 'ghost', paint: { 'line-color': c.ghost, 'line-width': 2, 'line-dasharray': [2, 1] } },
      { id: 'link', type: 'line', source: 'link', paint: { 'line-color': c.link, 'line-width': 1.5, 'line-dasharray': [1, 2] } },
      {
        id: 'river-casing', type: 'line', source: 'river',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': c.riverCasing, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 3, 6, 6] },
      },
      {
        id: 'river', type: 'line', source: 'river',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': c.river, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.6, 6, 3.5] },
      },
    ],
  };
}

const PAINT_KEYS = {
  ocean: [['ocean', 'background-color']],
  land: [['land', 'fill-color']],
  coast: [['coast', 'line-color']],
  border: [['borders', 'line-color']],
  basin: [['basin-fill', 'fill-color'], ['basin-line', 'line-color']],
  ghost: [['ghost-fill', 'fill-color'], ['ghost-line', 'line-color']],
  link: [['link', 'line-color']],
  river: [['river', 'line-color']],
  riverCasing: [['river-casing', 'line-color']],
};

const polygonFeature = (coordinates) => ({
  type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates },
});
const lineFeature = (coordinates) => ({
  type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates },
});

export function createMap(container) {
  const map = new maplibregl.Map({
    container,
    style: style(palette()),
    center: [10, 20],
    zoom: 1.4,
    minZoom: 0.6,
    maxZoom: 9,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) window.__map = map;
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  const ready = new Promise((resolve) => map.on('load', resolve));
  const markers = [];
  let spinFrame = 0;
  let clickHandler = null;

  ready.then(async () => {
    const topo = await (await fetch(countriesUrl)).json();
    const countries = topo.objects.countries;
    const land = fixDateLine(feature(topo, countries));
    if (window.__map) window.__land = land;
    map.getSource('land').setData(land);
    map.getSource('coast').setData(dropCutEdges(mesh(topo, countries, (a, b) => a === b)));
    map.getSource('borders').setData(dropCutEdges(mesh(topo, countries, (a, b) => a !== b)));
  });

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const c = palette();
    for (const [key, targets] of Object.entries(PAINT_KEYS)) {
      for (const [layer, prop] of targets) map.setPaintProperty(layer, prop, c[key]);
    }
  });

  map.on('click', (e) => clickHandler?.([e.lngLat.lng, e.lngLat.lat]));

  const set = (source, data) => ready.then(() => map.getSource(source).setData(data));

  return {
    map,
    ready,
    onClick(fn) {
      clickHandler = fn;
      map.getCanvas().style.cursor = fn ? 'crosshair' : '';
    },
    showRiver(line) { set('river', line ? lineFeature(line) : EMPTY); },
    showBasin(rings) { set('basin', rings ? polygonFeature(rings) : EMPTY); },
    showGhost(rings) { set('ghost', rings ? polygonFeature(rings) : EMPTY); },
    showLink(a, b) { set('link', a && b ? lineFeature([a, unwrapAround(b, a[0])]) : EMPTY); },
    addMarker(lngLat, { label, className = '' } = {}) {
      const node = document.createElement('div');
      node.className = `pin ${className}`;
      if (label) {
        const tag = document.createElement('span');
        tag.textContent = label;
        node.append(tag);
      }
      const marker = new maplibregl.Marker({ element: node, anchor: 'center' }).setLngLat(lngLat).addTo(map);
      markers.push(marker);
      return marker;
    },
    clear() {
      for (const m of markers.splice(0)) m.remove();
      for (const s of ['river', 'basin', 'ghost', 'link']) set(s, EMPTY);
      this.onClick(null);
    },
    fit(coords, { padding = 60, maxZoom = 6, duration = 1200 } = {}) {
      const box = bounds(coords);
      ready.then(() => {
        // cameraForBounds gives up (undefined, or throws on the globe) when the
        // padding leaves no room; retry with a thin margin before giving up.
        for (const pad of [insetPadding(container, padding), 8]) {
          let camera;
          try { camera = map.cameraForBounds(box, { padding: pad, maxZoom }); } catch { camera = null; }
          if (camera) {
            map.easeTo({ ...camera, duration });
            return;
          }
        }
      });
    },
    overview() {
      ready.then(() => map.easeTo({ zoom: 1.4, padding: insetPadding(container, 0), duration: 900 }));
    },
    resize() { map.resize(); },
    spin(on) {
      cancelAnimationFrame(spinFrame);
      if (!on || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      let last = performance.now();
      const step = (now) => {
        // idle drift westward; pauses while the player drags or zooms
        if (!map.isMoving()) {
          const c = map.getCenter();
          map.setCenter([c.lng + (now - last) * 0.004, c.lat]);
        }
        last = now;
        spinFrame = requestAnimationFrame(step);
      };
      spinFrame = requestAnimationFrame(step);
    },
  };
}

// Natural Earth closes rings that touch the date line with a mix of +180 and
// -180 vertices (mainland Russia, Fiji, Antarctica). On the globe that edge is
// drawn the long way round, as a stray arc, so snap each ring to one side.
export function fixDateLine(fc) {
  for (const f of fc.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const ring of polys.flat()) {
      const side = Math.sign(ring.reduce((sum, [lon]) => sum + lon, 0)) || 1;
      for (const pt of ring) if (Math.abs(pt[0]) === 180) pt[0] = 180 * side;
      // rings that genuinely straddle it (a Fijian island) get unwrapped past 180
      // (pole-circling rings like Antarctica's span 360° either way and are left alone)
      const span = (xs) => Math.max(...xs) - Math.min(...xs);
      const lons = ring.map(([lon]) => lon);
      if (span(lons) > 180 && span(lons.map((x) => (x < 0 ? x + 360 : x))) < 180) {
        for (const pt of ring) if (pt[0] < 0) pt[0] += 360;
      }
    }
  }
  return fc;
}

// Coastline mesh minus the artificial edges where Natural Earth cuts land
// along the date line or closes Antarctica at the pole, plus hops across
// ±180 that the globe would otherwise draw the long way round.
export function dropCutEdges(multiLine) {
  const cut = ([x1, y1], [x2, y2]) =>
    Math.abs(x2 - x1) > 180 ||
    (Math.abs(x1) >= 179.99 && Math.abs(x2) >= 179.99) ||
    (Math.abs(y1) >= 89.99 && Math.abs(y2) >= 89.99);
  const lines = [];
  for (const line of multiLine.coordinates) {
    let run = [line[0]];
    for (let i = 1; i < line.length; i++) {
      if (cut(line[i - 1], line[i])) {
        if (run.length > 1) lines.push(run);
        run = [line[i]];
      } else {
        run.push(line[i]);
      }
    }
    if (run.length > 1) lines.push(run);
  }
  return { type: 'MultiLineString', coordinates: lines };
}

// Keep fitted shapes clear of the floating panel (left on wide screens, bottom on narrow).
function insetPadding(container, pad) {
  const panel = document.querySelector('.panel');
  const out = { top: pad, right: pad, bottom: pad, left: pad };
  if (!panel || panel.hidden) return out;
  const r = panel.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  if (r.width < c.width * 0.7) {
    out.left = Math.min(c.width * 0.6, r.right - c.left + pad);
    out.right = Math.min(pad, (c.width - out.left) / 4);
  } else {
    out.bottom = Math.min(c.height * 0.65, c.bottom - r.top + pad / 2);
    out.top = Math.min(pad, (c.height - out.bottom) / 4);
    out.left = out.right = Math.min(pad, c.width / 8);
  }
  return out;
}
