// SVG renderings of a river planform or a basin outline, with no basemap.

import { bounds, flatten, projectLocal, sphericalMean } from './geo.js';

const NS = 'http://www.w3.org/2000/svg';
const SIZE = 320;
const PAD = 22;

function el(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function niceKm(km) {
  const pow = 10 ** Math.floor(Math.log10(km));
  for (const m of [5, 2, 1]) if (m * pow <= km) return m * pow;
  return pow;
}

/** Project to local km, then fit into the SIZE box with y flipped (north up). */
export function fitShape(coords, center = sphericalMean(flatten(coords))) {
  const km = projectLocal(coords, center);
  const [[minX, minY], [maxX, maxY]] = bounds(km);
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const scale = (SIZE - 2 * PAD) / span;
  const ox = (SIZE - (maxX - minX) * scale) / 2;
  const oy = (SIZE - (maxY - minY) * scale) / 2;
  const toPx = ([x, y]) => [ox + (x - minX) * scale, SIZE - (oy + (y - minY) * scale)];
  return { km, toPx, pxPerKm: scale };
}

const pathOf = (pts, close = false) =>
  pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + (close ? 'Z' : '');

function decorate(svg, pxPerKm) {
  // scale bar: the largest 1/2/5 x 10^n km that fits in a quarter of the box
  const km = niceKm((SIZE * 0.28) / pxPerKm);
  const w = km * pxPerKm;
  const y = SIZE - 10;
  const g = el('g', { class: 'shape-scale' });
  g.append(el('path', { d: `M${PAD} ${y - 4}V${y}H${PAD + w}V${y - 4}` }));
  const label = el('text', { x: PAD + w + 6, y: y + 1 });
  label.textContent = `${km.toLocaleString()} km`;
  g.append(label);
  const north = el('g', { class: 'shape-north', transform: `translate(${SIZE - 16} 20)` });
  north.append(el('path', { d: 'M0 -9L5 5L0 2L-5 5Z' }));
  const n = el('text', { x: 0, y: 17 });
  n.textContent = 'N';
  north.append(n);
  svg.append(g, north);
}

function frame(kind) {
  const svg = el('svg', {
    viewBox: `0 0 ${SIZE} ${SIZE}`,
    class: `shape shape--${kind}`,
    role: 'img',
  });
  return svg;
}

export function planformSvg(line) {
  const { km, toPx, pxPerKm } = fitShape(line);
  const svg = frame('planform');
  const d = pathOf(km.map(toPx));
  svg.append(el('path', { d, class: 'shape-river-casing' }), el('path', { d, class: 'shape-river' }));
  const [sx, sy] = toPx(km[0]);
  const [mx, my] = toPx(km[km.length - 1]);
  svg.append(el('circle', { cx: sx, cy: sy, r: 3, class: 'shape-source' }));
  svg.append(el('circle', { cx: mx, cy: my, r: 5, class: 'shape-mouth' }));
  decorate(svg, pxPerKm);
  return svg;
}

export function outlineSvg(multipolygon, center) {
  const { km, toPx, pxPerKm } = fitShape(multipolygon, center);
  const svg = frame('basin');
  const d = km.map((poly) => pathOf(poly[0].map(toPx), true)).join('');
  svg.append(el('path', { d, class: 'shape-basin' }));
  decorate(svg, pxPerKm);
  return svg;
}
