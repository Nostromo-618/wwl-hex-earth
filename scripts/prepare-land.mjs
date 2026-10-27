/**
 * Clip Natural Earth 10m land (world-atlas TopoJSON) and 10m lakes (NE GeoJSON)
 * to the Europe map bbox, then tile large polygons so point-in-polygon stays local.
 * Dev-only; vendored JSON is committed for offline installs.
 *
 *   pnpm prepare-land
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LAND_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/land-10m.json';
const LAKES_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson';

const EUROPE_LONLAT = { west: -24.5, east: 40, south: 34.5, north: 71.5 };
const LAEA = {
  lat0: (52 * Math.PI) / 180,
  lon0: (10 * Math.PI) / 180,
  x0: 4_321_000,
  y0: 3_210_000,
  R: 6_378_137,
};
const SIN_LAT0 = Math.sin(LAEA.lat0);
const COS_LAT0 = Math.cos(LAEA.lat0);

function forwardLaea(lon, lat) {
  const φ = (lat * Math.PI) / 180;
  const λ = (lon * Math.PI) / 180;
  const dλ = λ - LAEA.lon0;
  const sinφ = Math.sin(φ);
  const cosφ = Math.cos(φ);
  const cosΔ = Math.cos(dλ);
  const denom = 1 + SIN_LAT0 * sinφ + COS_LAT0 * cosφ * cosΔ;
  const k = Math.sqrt(2 / Math.max(denom, 1e-12));
  return [
    LAEA.x0 + LAEA.R * k * cosφ * Math.sin(dλ),
    LAEA.y0 + LAEA.R * k * (COS_LAT0 * sinφ - SIN_LAT0 * cosφ * cosΔ),
  ];
}

function computeLaeaEnvelope(west, east, south, north) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const take = (lon, lat) => {
    const [x, y] = forwardLaea(lon, lat);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  const samples = 16;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const lon = west + (east - west) * t;
    const lat = south + (north - south) * t;
    take(lon, south);
    take(lon, north);
    take(west, lat);
    take(east, lat);
  }
  const marginM = 60_000;
  return {
    minX: minX - marginM,
    maxX: maxX + marginM,
    minY: minY - marginM,
    maxY: maxY + marginM,
  };
}

const LAEA_ENV = computeLaeaEnvelope(
  EUROPE_LONLAT.west,
  EUROPE_LONLAT.east,
  EUROPE_LONLAT.south,
  EUROPE_LONLAT.north,
);

/** Full lon/lat envelope covering the Europe LAEA meter rectangle (incl. corners). */
const WEST = -57;
const EAST = 73;
const SOUTH = 28;
const NORTH = 75;
const TILE = 2;
const DECIMALS = 4;

function tileHitsLaea(x0, x1, y0, y1) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const xm = (x0 + x1) * 0.5;
  const ym = (y0 + y1) * 0.5;
  for (const [lon, lat] of [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [xm, ym],
    [xm, y0],
    [xm, y1],
    [x0, ym],
    [x1, ym],
  ]) {
    const [px, py] = forwardLaea(lon, lat);
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return (
    maxX >= LAEA_ENV.minX && minX <= LAEA_ENV.maxX && maxY >= LAEA_ENV.minY && minY <= LAEA_ENV.maxY
  );
}

function round(n) {
  const f = 10 ** DECIMALS;
  return Math.round(n * f) / f;
}

function unwrapRing(ring) {
  if (ring.length < 3) return ring;
  const out = [[ring[0][0], ring[0][1]]];
  for (let i = 1; i < ring.length; i++) {
    const lx = out[i - 1][0];
    let nx = ring[i][0];
    const ny = ring[i][1];
    while (nx - lx > 180) nx -= 360;
    while (nx - lx < -180) nx += 360;
    out.push([nx, ny]);
  }
  return out;
}

function centerLon(ring) {
  let sum = 0;
  for (const p of ring) sum += p[0];
  return ring.length ? sum / ring.length : 0;
}

function signedArea2(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return area;
}

function bboxHits(minX, minY, maxX, maxY) {
  return maxX >= WEST && minX <= EAST && maxY >= SOUTH && minY <= NORTH;
}

function ringBbox(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const out = [];
  for (const pt of ring) {
    const x = round(pt[0]);
    const y = round(pt[1]);
    const prev = out[out.length - 1];
    if (prev && prev[0] === x && prev[1] === y) continue;
    out.push([x, y]);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      out.push([first[0], first[1]]);
    }
  }
  return { ring: out, minX, minY, maxX, maxY };
}

function intersect(a, b, axis, value) {
  const t =
    axis === 0 ? (value - a[0]) / (b[0] - a[0] || 1e-12) : (value - a[1]) / (b[1] - a[1] || 1e-12);
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

function clipRing(ring, inside, axis, value) {
  if (ring.length < 4) return [];
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const s = ring[i];
    const e = ring[i + 1];
    const sIn = inside(s);
    const eIn = inside(e);
    if (eIn) {
      if (!sIn) out.push(intersect(s, e, axis, value));
      out.push(e);
    } else if (sIn) {
      out.push(intersect(s, e, axis, value));
    }
  }
  if (out.length > 0) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) out.push(first);
  }
  return out;
}

function packRings(rings) {
  if (!rings.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const packed = [];
  for (const ring of rings) {
    if (ring.length < 4) continue;
    const b = ringBbox(ring);
    if (b.ring.length < 4) continue;
    if (b.minX >= b.maxX || b.minY >= b.maxY) continue;
    if (Math.abs(signedArea2(b.ring)) < 1e-8) continue;
    packed.push(b.ring);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  if (!packed.length) return null;
  return { rings: packed, minX, minY, maxX, maxY };
}

function clipToBox(rings, west, east, south, north) {
  const clip = (ring) => {
    let r = ring;
    r = clipRing(r, (p) => p[0] >= west, 0, west);
    r = clipRing(r, (p) => p[0] <= east, 0, east);
    r = clipRing(r, (p) => p[1] >= south, 1, south);
    r = clipRing(r, (p) => p[1] <= north, 1, north);
    return r;
  };
  return packRings(rings.map(clip));
}

function tilePolygon(poly) {
  const clipped = clipToBox(poly.rings, WEST, EAST, SOUTH, NORTH);
  if (!clipped) return [];
  const x0 = Math.floor(clipped.minX / TILE) * TILE;
  const x1 = Math.ceil(clipped.maxX / TILE) * TILE;
  const y0 = Math.floor(clipped.minY / TILE) * TILE;
  const y1 = Math.ceil(clipped.maxY / TILE) * TILE;
  if (x1 - x0 <= TILE + 1e-9 && y1 - y0 <= TILE + 1e-9) {
    return tileHitsLaea(clipped.minX, clipped.maxX, clipped.minY, clipped.maxY) ? [clipped] : [];
  }
  const tiles = [];
  for (let x = x0; x < x1 - 1e-9; x += TILE) {
    for (let y = y0; y < y1 - 1e-9; y += TILE) {
      if (!tileHitsLaea(x, x + TILE, y, y + TILE)) continue;
      const piece = clipToBox(clipped.rings, x, x + TILE, y, y + TILE);
      if (piece) tiles.push(piece);
    }
  }
  return tiles;
}

function alignPolygonRings(rawRings) {
  if (!rawRings.length) return [];
  const outer = unwrapRing(rawRings[0]);
  const outerCenter = centerLon(outer);
  const holes = rawRings.slice(1).map((r) => {
    const h = unwrapRing(r);
    const shift = 360 * Math.round((outerCenter - centerLon(h)) / 360);
    return shift === 0 ? h : h.map(([x, y]) => [x + shift, y]);
  });
  return [outer, ...holes];
}

function shiftPolygon(packed, shift) {
  if (shift === 0) return packed;
  return {
    rings: packed.rings.map((ring) => ring.map(([x, y]) => [round(x + shift), y])),
    minX: round(packed.minX + shift),
    minY: packed.minY,
    maxX: round(packed.maxX + shift),
    maxY: packed.maxY,
  };
}

function addAlignedPolygon(out, rawRings) {
  const aligned = alignPolygonRings(rawRings);
  const packed = packRings(aligned);
  if (!packed) return;
  for (const shift of [-360, 0, 360]) {
    if (bboxHits(packed.minX + shift, packed.minY, packed.maxX + shift, packed.maxY)) {
      out.push(...tilePolygon(shiftPolygon(packed, shift)));
    }
  }
}

function decodeTopo(topo) {
  const { scale, translate } = topo.transform;
  const arcs = topo.arcs.map((arc) => {
    const pts = [];
    let x = 0;
    let y = 0;
    for (const d of arc) {
      x += d[0];
      y += d[1];
      pts.push([x * scale[0] + translate[0], y * scale[1] + translate[1]]);
    }
    return pts;
  });

  const ringFrom = (indexes) => {
    const pts = [];
    for (const i of indexes) {
      const arc = i >= 0 ? arcs[i] : [...arcs[~i]].reverse();
      if (pts.length > 0) pts.pop();
      for (const p of arc) pts.push(p);
    }
    return pts;
  };

  const out = [];
  const addPolygon = (arcLists) => {
    addAlignedPolygon(out, arcLists.map(ringFrom));
  };

  const land = topo.objects.land;
  if (land.type === 'Polygon') addPolygon(land.arcs);
  else if (land.type === 'MultiPolygon') for (const poly of land.arcs) addPolygon(poly);
  else if (land.geometries) {
    for (const g of land.geometries) {
      if (g.type === 'Polygon') addPolygon(g.arcs);
      else if (g.type === 'MultiPolygon') for (const poly of g.arcs) addPolygon(poly);
    }
  }
  return out;
}

function decodeGeojson(fc) {
  const out = [];
  for (const f of fc.features ?? []) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') addAlignedPolygon(out, g.coordinates);
    else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) addAlignedPolygon(out, poly);
    }
  }
  return out;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

const landTopo = await fetchJson(LAND_URL);
const lakesGeo = await fetchJson(LAKES_URL);
const land = decodeTopo(landTopo);
const lakes = decodeGeojson(lakesGeo);

const landPath = join(ROOT, 'src/assets/land-10m-europe.json');
const lakesPath = join(ROOT, 'src/assets/lakes-10m-europe.json');
const landJson = JSON.stringify({ polygons: land });
const lakesJson = JSON.stringify({ polygons: lakes });
await writeFile(landPath, landJson);
await writeFile(lakesPath, lakesJson);

const kb = (p, n, count) => `${p} ${Math.round(n.length / 102.4) / 10} KB, ${count} polys`;
console.log(kb(landPath, landJson, land.length));
console.log(kb(lakesPath, lakesJson, lakes.length));
