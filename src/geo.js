// Spherical helpers. Coordinates are [lon, lat] in degrees throughout.

export const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;

export function toVec([lon, lat]) {
  const cl = Math.cos(lat * RAD);
  return [cl * Math.cos(lon * RAD), cl * Math.sin(lon * RAD), Math.sin(lat * RAD)];
}

export function fromVec([x, y, z]) {
  const r = Math.hypot(x, y, z);
  return [Math.atan2(y, x) / RAD, Math.asin(Math.max(-1, Math.min(1, z / r))) / RAD];
}

export function haversineKm([lon1, lat1], [lon2, lat2]) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, a)));
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Map a nested coordinate array (any depth) through fn([lon, lat]). */
export function mapCoords(coords, fn) {
  return typeof coords[0] === 'number' ? fn(coords) : coords.map((c) => mapCoords(c, fn));
}

/**
 * Rigidly rotate a shape over the sphere so the point `from` lands on `to`.
 * Unlike shifting lon/lat, this keeps the outline's true size and shape
 * wherever the player drops it.
 */
export function rotateShape(coords, from, to) {
  const a = toVec(from);
  const b = toVec(to);
  let axis = cross(a, b);
  const sin = Math.hypot(...axis);
  const cos = dot(a, b);
  if (sin < 1e-12) {
    if (cos > 0) return coords;
    // antipodal drop: half-turn about any axis perpendicular to `from`
    axis = cross(a, Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
  }
  const len = Math.hypot(...axis);
  axis = axis.map((v) => v / len);
  return mapCoords(coords, (p) => {
    const v = toVec(p);
    const kxv = cross(axis, v);
    const kdv = dot(axis, v);
    // Rodrigues' rotation formula
    const r = [0, 1, 2].map((i) => v[i] * cos + kxv[i] * sin + axis[i] * kdv * (1 - cos));
    return fromVec(r);
  });
}

/**
 * Shift longitudes by multiples of 360 so every point sits within 180° of
 * lon0. A shape dropped across the date line then stays in one piece.
 */
export function unwrapAround(coords, lon0) {
  return mapCoords(coords, ([lon, lat]) => [lon0 + ((((lon - lon0) % 360) + 540) % 360) - 180, lat]);
}

/** Mean direction of a set of points, as [lon, lat]. */
export function sphericalMean(points) {
  const sum = [0, 0, 0];
  for (const p of points) {
    const v = toVec(p);
    sum[0] += v[0];
    sum[1] += v[1];
    sum[2] += v[2];
  }
  return fromVec(sum);
}

export function flatten(coords, out = []) {
  if (typeof coords[0] === 'number') out.push(coords);
  else for (const c of coords) flatten(c, out);
  return out;
}

export function bounds(coords) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of flatten(coords)) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [[minX, minY], [maxX, maxY]];
}

/**
 * Orthographic projection around `center`, in km. Shapes keep their
 * proportions (north up) so planforms and outlines read true at any latitude.
 */
export function projectLocal(coords, center) {
  const [lon0, lat0] = center.map((d) => d * RAD);
  const sin0 = Math.sin(lat0);
  const cos0 = Math.cos(lat0);
  return mapCoords(coords, ([lon, lat]) => {
    const l = lon * RAD - lon0;
    const p = lat * RAD;
    return [
      EARTH_RADIUS_KM * Math.cos(p) * Math.sin(l),
      EARTH_RADIUS_KM * (cos0 * Math.sin(p) - sin0 * Math.cos(p) * Math.cos(l)),
    ];
  });
}
