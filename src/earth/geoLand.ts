import landUrl from '../assets/land-110m.json?url&no-inline';
import europeLandUrl from '../assets/land-10m-europe.json?url&no-inline';
import europeLakesUrl from '../assets/lakes-10m-europe.json?url&no-inline';
import { WORLD, type MapRegion } from './regions';

type Ring = number[][];

interface LandPolygon {
  rings: Ring[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface LandPolygons {
  polygons: LandPolygon[];
}

export interface LandTopology {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: {
    land: {
      type: string;
      geometries?: Array<{ type: string; arcs: unknown }>;
      arcs?: unknown;
    };
  };
}

const testers = new Map<string, (lon: number, lat: number) => boolean>();

const LAT_BANDS = 180;

function normalizeLon(lon: number): number {
  let l = lon;
  while (l < -180) l += 360;
  while (l >= 180) l -= 360;
  return l;
}

interface BandSlice {
  minX: number;
  maxX: number;
  /** Packed quads: [xi, yi, (xj - xi) / (yj - yi), yj] for edges crossing this 1° latitude band. */
  edges: Float64Array;
}

/**
 * Active-edge latitude-band index: each 1° latitude band stores only the
 * non-horizontal edges whose vertical span intersects that band, along with
 * their band-local [minX, maxX] bounds and precomputed inverse slopes.
 */
function buildBands(list: LandPolygon[]): BandSlice[][] {
  const out: BandSlice[][] = Array.from({ length: LAT_BANDS }, () => []);
  for (const poly of list) {
    const b0 = Math.max(0, Math.min(LAT_BANDS - 1, Math.floor(poly.minY) + 90));
    const b1 = Math.max(0, Math.min(LAT_BANDS - 1, Math.ceil(poly.maxY) + 90));
    for (let b = b0; b <= b1; b++) {
      const yMin = b - 90;
      const yMax = b - 89;
      const coords: number[] = [];
      let minX = Infinity;
      let maxX = -Infinity;
      for (const ring of poly.rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const xi = ring[i][0];
          const yi = ring[i][1];
          const xj = ring[j][0];
          const yj = ring[j][1];
          if (yi !== yj && Math.max(yi, yj) >= yMin && Math.min(yi, yj) <= yMax) {
            coords.push(xi, yi, (xj - xi) / (yj - yi), yj);
            const loX = Math.min(xi, xj);
            const hiX = Math.max(xi, xj);
            if (loX < minX) minX = loX;
            if (hiX > maxX) maxX = hiX;
          }
        }
      }
      out[b].push({ minX, maxX, edges: new Float64Array(coords) });
    }
  }
  return out;
}

function unwrapRing(ring: Ring): Ring {
  if (ring.length < 3) return ring;
  const out: Ring = [[ring[0][0], ring[0][1]]];
  for (let i = 1; i < ring.length; i++) {
    const [lx] = out[i - 1];
    let nx = ring[i][0];
    const ny = ring[i][1];
    while (nx - lx > 180) nx -= 360;
    while (nx - lx < -180) nx += 360;
    out.push([nx, ny]);
  }
  return out;
}

function centerLon(ring: Ring): number {
  let sum = 0;
  for (const p of ring) sum += p[0];
  return sum / ring.length;
}

function decode(topo: LandTopology): LandPolygon[] {
  const { scale, translate } = topo.transform;
  const arcs: number[][][] = topo.arcs.map((arc) => {
    const pts: number[][] = [];
    let x = 0;
    let y = 0;
    for (const d of arc) {
      x += d[0];
      y += d[1];
      pts.push([x * scale[0] + translate[0], y * scale[1] + translate[1]]);
    }
    return pts;
  });

  const ringFromArcIndexes = (indexes: number[]): Ring => {
    const pts: Ring = [];
    for (const i of indexes) {
      const arc = i >= 0 ? arcs[i] : [...arcs[~i]].reverse();
      if (pts.length > 0) pts.pop();
      for (const p of arc) pts.push(p);
    }
    return unwrapRing(pts);
  };

  const out: LandPolygon[] = [];
  const addPolygon = (arcLists: number[][]) => {
    const outer = ringFromArcIndexes(arcLists[0]);
    const outerCenter = centerLon(outer);
    const holes = arcLists.slice(1).map((ringArcs) => {
      const h = ringFromArcIndexes(ringArcs);
      const shift = 360 * Math.round((outerCenter - centerLon(h)) / 360);
      return shift === 0 ? h : (h.map(([x, y]) => [x + shift, y]) as Ring);
    });
    const allRings = [outer, ...holes];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const ring of allRings) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    out.push({ rings: allRings, minX, minY, maxX, maxY });
  };

  const land = topo.objects.land;
  const geometries = land.geometries ?? (land.type ? [land] : []);
  for (const g of geometries) {
    if (g.type === 'Polygon') addPolygon(g.arcs as number[][]);
    else if (g.type === 'MultiPolygon') for (const poly of g.arcs as number[][][]) addPolygon(poly);
  }
  return out;
}

/** Planar even-odd ray cast over pre-sliced band edges. */
function inSlice(lon: number, lat: number, edges: Float64Array): boolean {
  let inside = false;
  for (let i = 0; i < edges.length; i += 4) {
    const yi = edges[i + 1];
    const yj = edges[i + 3];
    if (yi > lat !== yj > lat && lon < edges[i + 2] * (lat - yi) + edges[i]) {
      inside = !inside;
    }
  }
  return inside;
}

function testerFor(index: BandSlice[][]): (lon: number, lat: number) => boolean {
  return (lon, lat) => {
    if (lat < -90 || lat > 90) return false;
    const l = normalizeLon(lon);
    const band = Math.max(0, Math.min(LAT_BANDS - 1, Math.floor(lat) + 90));
    const candidates = index[band];
    for (const slice of candidates) {
      for (const shift of [-360, 0, 360]) {
        const x = l + shift;
        if (x < slice.minX || x > slice.maxX) continue;
        if (inSlice(x, lat, slice.edges)) return true;
      }
    }
    return false;
  };
}

/** Build a land-mask from an in-memory TopoJSON topology (no fetch). */
export function landTestFromTopology(topo: LandTopology): (lon: number, lat: number) => boolean {
  return testerFor(buildBands(decode(topo)));
}

/** Build a mask from pre-clipped polygon JSON (Europe 10m land / lakes). */
export function landTestFromPolygons(data: LandPolygons): (lon: number, lat: number) => boolean {
  return testerFor(buildBands(data.polygons));
}

async function loadJson<T>(url: string): Promise<T> {
  return (await (await fetch(url)).json()) as T;
}

export async function createGeoLandTest(
  region: Pick<MapRegion, 'id'> = WORLD,
): Promise<(lon: number, lat: number) => boolean> {
  const id = region.id;
  const hit = testers.get(id);
  if (hit) return hit;

  if (id === 'europe') {
    const [land, lakes] = await Promise.all([
      loadJson<LandPolygons>(europeLandUrl),
      loadJson<LandPolygons>(europeLakesUrl),
    ]);
    const landAt = landTestFromPolygons(land);
    const lakeAt = landTestFromPolygons(lakes);
    const tester = (lon: number, lat: number): boolean => landAt(lon, lat) && !lakeAt(lon, lat);
    testers.set(id, tester);
    return tester;
  }

  const topo = await loadJson<LandTopology>(landUrl);
  const tester = landTestFromTopology(topo);
  testers.set(id, tester);
  return tester;
}
