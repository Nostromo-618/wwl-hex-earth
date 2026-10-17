import { WORLD, latSpan, lonSpan, type MapRegion } from './regions';
import { planarSpan, regionPlanarBounds, xyToLonLat, type LonLat } from './project';

export type { LonLat };

export interface GridTier {
  id: 'low' | 'mid' | 'high' | 'ultra' | 'max';
  label: string;
  /** Hex budget. Painted cols×rows come from `gridFor`, not these figures. */
  cols: number;
  rows: number;
  /**
   * Nominal square-degree size of the old 2:1 budget. The painted globe step
   * is `gridFor`'s cellLon × cellLat.
   */
  cell: number;
  /** Offered on the world globe only. */
  worldOnly?: boolean;
}

/** Resolution tiers — hex-count labels. Painted shape comes from `gridFor`. */
export const TIERS: GridTier[] = [
  { id: 'low', label: '28.8k', cols: 240, rows: 120, cell: 1.5 },
  { id: 'mid', label: '64.8k', cols: 360, rows: 180, cell: 1.0 },
  { id: 'high', label: '115.2k', cols: 480, rows: 240, cell: 0.75 },
  { id: 'ultra', label: '259.2k', cols: 720, rows: 360, cell: 0.5 },
  { id: 'max', label: '512k', cols: 800, rows: 640, cell: 0.35, worldOnly: true },
];

export const DEFAULT_TIER: GridTier['id'] = 'low';
const DEFAULT_TIER_EUROPE: GridTier['id'] = 'mid';
const DEFAULT_TIER_WORLD: GridTier['id'] = 'high';

export function defaultTierFor(regionId: string): GridTier['id'] {
  if (regionId === 'europe') return DEFAULT_TIER_EUROPE;
  if (regionId === 'world') return DEFAULT_TIER_WORLD;
  return DEFAULT_TIER;
}

/** Hex radius in canvas world pixels (shared by the renderer, toolbar, stats). */
export const HEX_SIZE = 6;

export function tierById(id: string): GridTier {
  return TIERS.find((t) => t.id === id) ?? TIERS[0];
}

/** Tiers the toolbar and benchmarks should offer for a region. */
export function tiersFor(regionId: string): GridTier[] {
  if (regionId === 'world') return TIERS;
  return TIERS.filter((tier) => !tier.worldOnly);
}

export function hexCountOf(tier: GridTier): number {
  return tier.cols * tier.rows;
}

export interface GridSpec {
  cols: number;
  rows: number;
  hexes: number;
  /** Kilometres, or the geometric mean of the degree steps. */
  cell: number;
  cellUnit: 'deg' | 'km';
  /** Longitude step in degrees. Set for the globe. */
  cellLon?: number;
  /** Latitude step in degrees. Set for the globe. */
  cellLat?: number;
}

/**
 * After HexEarth's -30° rotation the lattice is pointy-top: column spacing is
 * √3·size and row spacing is 1.5·size, so pixel aspect ≈ (cols/rows)·√3/1.5.
 */
export const HEX_PIXEL_ASPECT = Math.sqrt(3) / 1.5;

function dimensionsFor(hexes: number, colsOverRows: number): { cols: number; rows: number } {
  const rows = Math.max(1, Math.round(Math.sqrt(hexes / colsOverRows)));
  const cols = Math.max(1, Math.round(hexes / rows));
  return { cols, rows };
}

/**
 * World spends the tier's hex budget on a grid whose pointy-top pixels match
 * the geographic aspect (2:1 for the globe). LAEA regions match meter aspect.
 */
export function gridFor(region: MapRegion, tier: GridTier): GridSpec {
  if (region.projection !== 'laea') {
    const geoAspect = lonSpan(region) / latSpan(region);
    const { cols, rows } = dimensionsFor(hexCountOf(tier), geoAspect / HEX_PIXEL_ASPECT);
    const cellLon = lonSpan(region) / cols;
    const cellLat = latSpan(region) / rows;
    return {
      cols,
      rows,
      hexes: cols * rows,
      cell: Math.sqrt(cellLon * cellLat),
      cellLon,
      cellLat,
      cellUnit: 'deg',
    };
  }
  const bounds = regionPlanarBounds(region);
  const { spanX, spanY } = planarSpan(bounds);
  const meterAspect = spanX / spanY;
  const colsOverRows = meterAspect / HEX_PIXEL_ASPECT;
  const { cols, rows } = dimensionsFor(hexCountOf(tier), colsOverRows);
  const cellM = Math.sqrt((spanX / cols) * (spanY / rows));
  return {
    cols,
    rows,
    hexes: cols * rows,
    cell: cellM / 1000,
    cellUnit: 'km',
  };
}

export interface Cell {
  col: number;
  row: number;
}

export function cellToQ(col: number, row: number): number {
  return col - Math.floor(row / 2);
}

export function qToCol(q: number, row: number): number {
  return q + Math.floor(row / 2);
}

export function cellCenterXY(
  col: number,
  row: number,
  cols: number,
  rows: number,
  region: MapRegion,
): { x: number; y: number } {
  const bounds = regionPlanarBounds(region);
  const { spanX, spanY } = planarSpan(bounds);
  return {
    x: bounds.minX + ((col + 0.5 + (row & 1) * 0.5) * spanX) / cols,
    y: bounds.maxY - ((row + 0.5) * spanY) / rows,
  };
}

export function cellStep(
  cols: number,
  rows: number,
  region: MapRegion,
): { dx: number; dy: number } {
  const { spanX, spanY } = planarSpan(regionPlanarBounds(region));
  return { dx: spanX / cols, dy: spanY / rows };
}

/**
 * Geographic center of a cell.
 *
 * The engine lays odd rows out half a column east of even rows
 * (hexToPixel: baseX = size*1.5*q, with qOffset = floor(r/2)); with the app's
 * -30° rotation that shows up as `x = col + (row & 1) * 0.5` column units.
 * Sampling every row at `col + 0.5` sheared N–S coastlines, so the parity
 * offset is applied here to sample the hex's visual center.
 */
export function cellToLonLat(
  col: number,
  row: number,
  cols: number,
  rows: number,
  region: MapRegion = WORLD,
): LonLat {
  const { x, y } = cellCenterXY(col, row, cols, rows, region);
  return xyToLonLat(x, y, region);
}

/**
 * Parity-aware 6-neighborhood, as flat row-major indexes.
 *
 * Matches `getAdjacentHexes` after converting axial q to column: even rows use
 * `upL=(c-1,r-1)/upR=(c,r-1)`, odd rows use `upL=(c,r-1)/upR=(c+1,r-1)`
 * (same for the row below), plus E/W.
 */
export function neighborIndexes(col: number, row: number, cols: number, rows: number): number[] {
  const parity = row & 1;
  const out: number[] = [];
  const add = (c: number, r: number): void => {
    if (c < 0 || c >= cols || r < 0 || r >= rows) return;
    out.push(r * cols + c);
  };
  add(col - 1, row);
  add(col + 1, row);
  add(col - 1 + parity, row - 1);
  add(col + parity, row - 1);
  add(col - 1 + parity, row + 1);
  add(col + parity, row + 1);
  return out;
}

/** Breadth-first path over the parity-correct hex neighborhood. */
export function findPath(start: Cell, goal: Cell, cols: number, rows: number): Cell[] {
  if (
    start.col < 0 ||
    start.col >= cols ||
    start.row < 0 ||
    start.row >= rows ||
    goal.col < 0 ||
    goal.col >= cols ||
    goal.row < 0 ||
    goal.row >= rows
  ) {
    return [];
  }
  const total = cols * rows;
  const idx = (c: number, r: number): number => r * cols + c;
  const startIdx = idx(start.col, start.row);
  const goalIdx = idx(goal.col, goal.row);
  if (startIdx === goalIdx) return [start];
  const prev = new Int32Array(total).fill(-1);
  const seen = new Uint8Array(total);
  seen[startIdx] = 1;
  let frontier: number[] = [startIdx];
  while (frontier.length > 0 && !seen[goalIdx]) {
    const next: number[] = [];
    for (const cur of frontier) {
      const cr = Math.floor(cur / cols);
      const cc = cur % cols;
      for (const ni of neighborIndexes(cc, cr, cols, rows)) {
        if (seen[ni]) continue;
        seen[ni] = 1;
        prev[ni] = cur;
        next.push(ni);
      }
    }
    frontier = next;
  }
  /* v8 ignore start */
  if (!seen[goalIdx]) return [];
  /* v8 ignore stop */
  const path: Cell[] = [];
  let step = goalIdx;
  while (step !== -1) {
    path.push({ col: step % cols, row: Math.floor(step / cols) });
    step = prev[step];
  }
  path.reverse();
  return path;
}
