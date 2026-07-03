// Client copy of the baked city tile grid (tools/citymap/bake.mjs). Mirrors
// the server's wilder-terrain CityMap so ground geometry, curb heights, and
// shader detail can query any world tile, including unloaded neighbors.

export const CITY_ROAD = 0;
export const CITY_ROAD_LINE = 1;
export const CITY_SIDEWALK = 2;
export const CITY_PLAZA = 3;
export const CITY_BUILDING = 4;
export const CITY_PARK = 5;
export const CITY_WATER = 6;

interface CityGrid {
  tileMinX: number;
  tileMinZ: number;
  width: number;
  height: number;
  tiles: Uint8Array;
}

export interface CityMapManifest {
  tileSize: number;
  tileMinX: number;
  tileMinZ: number;
  width: number;
  height: number;
  pxPerTile: number;
  spawn: [number, number];
  districts: { name: string; x: number; z: number }[];
}

let grid: CityGrid | null = null;
const readyCallbacks: (() => void)[] = [];

export function cityMapReady(): boolean {
  return grid !== null;
}

/** Register a callback for when the tile grid finishes loading (or fire now). */
export function onCityMapReady(cb: () => void): void {
  if (grid) cb();
  else readyCallbacks.push(cb);
}

/** Tile kind at a global world tile coordinate; Water outside / before load. */
export function cityTileAt(wtx: number, wtz: number): number {
  if (!grid) return CITY_WATER;
  const gx = wtx - grid.tileMinX;
  const gz = wtz - grid.tileMinZ;
  if (gx < 0 || gz < 0 || gx >= grid.width || gz >= grid.height) return CITY_WATER;
  return grid.tiles[gz * grid.width + gx];
}

/** Raw decoded tile grid (row-major, world tile space), or null before load. */
export function getCityGrid(): {
  tileMinX: number;
  tileMinZ: number;
  width: number;
  height: number;
  tiles: Uint8Array;
} | null {
  return grid;
}

/** Baked whole-city geometry (tools/citymap/bake.mjs -> geo.bin): the actual
 * building blockout meshes and street polygons, in world space. */
export interface CityGeo {
  /** Building vertex positions (xyz, world meters). */
  buildingPos: Float32Array;
  /** Per-vertex height within its building, 0 (base) .. 255 (roof). */
  buildingRelH: Uint8Array;
  /** Per-vertex glow strength, byte-encoded (255 = 1.6). */
  buildingGlow: Uint8Array;
  buildingIdx: Uint32Array;
  /** Street triangle soup positions (xyz, world meters). */
  streetPos: Float32Array;
}

let geoPromise: Promise<CityGeo> | null = null;

export function getCityGeo(): Promise<CityGeo> {
  geoPromise ??= fetch("/citymap/geo.bin").then(async (res) => {
    const raw = await res.arrayBuffer();
    const head = new DataView(raw);
    const magic = String.fromCharCode(
      head.getUint8(0),
      head.getUint8(1),
      head.getUint8(2),
      head.getUint8(3),
    );
    if (magic !== "WCG1") throw new Error(`bad geo.bin magic: ${magic}`);
    const bVerts = head.getUint32(4, true);
    const bIdx = head.getUint32(8, true);
    const sVerts = head.getUint32(12, true);
    const pad4 = (n: number) => (n + 3) & ~3;
    let o = 16;
    const buildingPos = new Float32Array(raw, o, bVerts * 3);
    o += bVerts * 12;
    const buildingRelH = new Uint8Array(raw, o, bVerts);
    o = pad4(o + bVerts);
    const buildingGlow = new Uint8Array(raw, o, bVerts);
    o = pad4(o + bVerts);
    const buildingIdx = new Uint32Array(raw, o, bIdx);
    o += bIdx * 4;
    const streetPos = new Float32Array(raw, o, sVerts * 3);
    return { buildingPos, buildingRelH, buildingGlow, buildingIdx, streetPos };
  });
  return geoPromise;
}

async function load(): Promise<void> {
  const res = await fetch("/citymap/tiles.bin");
  const buf = new DataView(await res.arrayBuffer());
  const magic = String.fromCharCode(
    buf.getUint8(0),
    buf.getUint8(1),
    buf.getUint8(2),
    buf.getUint8(3),
  );
  if (magic !== "WCT1") throw new Error(`bad tiles.bin magic: ${magic}`);
  const tileMinX = buf.getInt32(4, true);
  const tileMinZ = buf.getInt32(8, true);
  const width = buf.getUint32(12, true);
  const height = buf.getUint32(16, true);
  const runCount = buf.getUint32(20, true);
  const tiles = new Uint8Array(width * height);
  let o = 24;
  let i = 0;
  for (let r = 0; r < runCount; r++) {
    const len = buf.getUint16(o, true);
    const kind = buf.getUint8(o + 2);
    o += 3;
    tiles.fill(kind, i, i + len);
    i += len;
  }
  grid = { tileMinX, tileMinZ, width, height, tiles };
  for (const cb of readyCallbacks.splice(0)) cb();
}

let manifestPromise: Promise<CityMapManifest> | null = null;
export function getCityMapManifest(): Promise<CityMapManifest> {
  manifestPromise ??= fetch("/citymap/manifest.json").then((r) => r.json());
  return manifestPromise;
}

void load().catch((e) => console.error("citymap load failed", e));
