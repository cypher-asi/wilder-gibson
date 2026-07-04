// Client-side mirror of the server's movement + collision rules
// (crates/wilder-physics). Used for local player prediction.

import {
  BUILDING_FRONT_PROUD,
  CHUNK_SIZE,
  ChunkData,
  TILE_SIZE,
  TILES_PER_CHUNK,
} from "../net/protocol";
import type { ChunkInteriors } from "./interiors";

export const WALK_SPEED = 3.0;
export const RUN_SPEED = 9.0;
export const CROUCH_SPEED = 1.6;
export const PLAYER_RADIUS = 0.4;

// Dodge roll dash (mirrors wilder-physics).
export const ROLL_SPEED = 7.5;
export const ROLL_DURATION = 0.5;
export const ROLL_COOLDOWN = 0.9;

export function chunkKey(x: number, z: number): string {
  return `${x},${z}`;
}

/**
 * Player-collision radius (meters) for a prop archetype. `0` means walk-through
 * (floor grates, wall signs). Mirror of `wilder_terrain::prop_collision_radius`.
 */
export function propCollisionRadius(archetype: number): number {
  switch (archetype) {
    case 0: // STREETLIGHT
      return 0.35;
    case 1: // BENCH
      return 0.6;
    case 2: // TRASH
      return 0.35;
    case 3: // HYDRANT
      return 0.3;
    case 6: // TREE
      return 0.55;
    case 7: // CAR / motorbike
      return 0.9;
    case 8: // BARRIER
      return 0.5;
    case 9: // KIOSK
      return 1.1;
    case 10: // TRAFFIC_LIGHT
      return 0.3;
    case 11: // STOP_SIGN
      return 0.25;
    default: // NEON_SIGN (4, wall), VENT (5, floor grate)
      return 0;
  }
}

/** Mirror of `wilder_terrain::MAX_PROP_RADIUS`. */
const MAX_PROP_RADIUS = 1.1;

interface PropCollider {
  x: number;
  z: number;
  r: number;
}

/** World-space axis-aligned box: [minx, minz, maxx, maxz]. */
type Aabb = [number, number, number, number];

/** Whether a disc at (cx, cz) with `radius` overlaps an AABB (closest point). */
function discAabbOverlap(cx: number, cz: number, radius: number, box: Aabb): boolean {
  const [minx, minz, maxx, maxz] = box;
  const nx = Math.min(Math.max(cx, minx), maxx);
  const nz = Math.min(Math.max(cz, minz), maxz);
  const dx = cx - nx;
  const dz = cz - nz;
  return dx * dx + dz * dz < radius * radius;
}

export class ChunkStore {
  chunks = new Map<string, ChunkData>();
  walkableCache = new Map<string, boolean[]>();
  /** World-space prop colliders per chunk (excludes walk-through props). */
  propCache = new Map<string, PropCollider[]>();
  /** World-space building front-face buffers per chunk (mirror of server). */
  buildingCache = new Map<string, Aabb[]>();
  /** Registered walk-in interiors per chunk (mirror of server ChunkCache). */
  interiorCache = new Map<string, ChunkInteriors>();
  /** bumped on chunk add/remove so React can resync */
  version = 0;

  add(chunk: ChunkData) {
    const key = chunkKey(chunk.coord.x, chunk.coord.z);
    this.chunks.set(key, chunk);
    const ox = chunk.coord.x * CHUNK_SIZE;
    const oz = chunk.coord.z * CHUNK_SIZE;
    const colliders: PropCollider[] = [];
    for (const p of chunk.props) {
      const r = propCollisionRadius(p.archetype);
      if (r > 0) colliders.push({ x: ox + p.x, z: oz + p.z, r });
    }
    this.propCache.set(key, colliders);
    this.rebuild(key, chunk);
    this.version++;
  }

  /**
   * Register (or clear) the walk-in interiors carved into a chunk's
   * buildings; takes effect immediately if the chunk is streamed in.
   */
  setInteriors(key: string, ints: ChunkInteriors | null) {
    if (ints) this.interiorCache.set(key, ints);
    else this.interiorCache.delete(key);
    const chunk = this.chunks.get(key);
    if (chunk) {
      this.rebuild(key, chunk);
      this.version++;
    }
  }

  /**
   * Walkability + collision boxes with interiors applied: room tiles open
   * up, host front bands gain door gaps, walls/furniture join the box list
   * (mirror of the server's `apply_interiors`).
   */
  private rebuild(key: string, chunk: ChunkData) {
    const walkable = chunk.tiles.map((t) => t !== "Building" && t !== "Water");
    const ox = chunk.coord.x * CHUNK_SIZE;
    const oz = chunk.coord.z * CHUNK_SIZE;
    // Front-face buffers: the proud storefront band in front of each
    // building's street (-z) face, matching render/building.ts geometry.
    const aabbs: Aabb[] = chunk.buildings.map((b) => {
      const minx = ox + b.tx0 * TILE_SIZE;
      const maxx = ox + b.tx1 * TILE_SIZE;
      const lot = oz + b.tz0 * TILE_SIZE;
      return [minx, lot - BUILDING_FRONT_PROUD, maxx, lot];
    });
    const ints = this.interiorCache.get(key);
    if (ints) {
      for (const [building, replacement] of ints.frontBands) {
        if (replacement.length > 0) {
          aabbs[building] = replacement[0];
          for (let i = 1; i < replacement.length; i++) aabbs.push(replacement[i]);
        } else {
          aabbs[building] = [0, 0, 0, 0];
        }
      }
      for (const spec of ints.specs) {
        const [tx0, tz0, tx1, tz1] = spec.tiles;
        for (let tz = tz0; tz < tz1; tz++) {
          for (let tx = tx0; tx < tx1; tx++) {
            walkable[tz * TILES_PER_CHUNK + tx] = true;
          }
        }
        for (const c of spec.colliders) aabbs.push(c);
      }
    }
    this.walkableCache.set(key, walkable);
    this.buildingCache.set(key, aabbs);
  }

  remove(x: number, z: number) {
    const key = chunkKey(x, z);
    this.chunks.delete(key);
    this.walkableCache.delete(key);
    this.propCache.delete(key);
    this.buildingCache.delete(key);
    this.version++;
  }

  clear() {
    this.chunks.clear();
    this.walkableCache.clear();
    this.propCache.clear();
    this.buildingCache.clear();
    this.interiorCache.clear();
    this.version++;
  }

  walkable(x: number, z: number): boolean {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const grid = this.walkableCache.get(chunkKey(cx, cz));
    // Unloaded chunk: treat as solid, same as the server.
    if (!grid) return false;
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    const tx = Math.min(Math.floor(lx / TILE_SIZE), TILES_PER_CHUNK - 1);
    const tz = Math.min(Math.floor(lz / TILE_SIZE), TILES_PER_CHUNK - 1);
    return grid[tz * TILES_PER_CHUNK + tx];
  }

  /** Circle-vs-circle test of a disc against nearby prop colliders. */
  propBlocked(x: number, z: number, radius: number): boolean {
    const reach = radius + MAX_PROP_RADIUS;
    const cx0 = Math.floor((x - reach) / CHUNK_SIZE);
    const cx1 = Math.floor((x + reach) / CHUNK_SIZE);
    const cz0 = Math.floor((z - reach) / CHUNK_SIZE);
    const cz1 = Math.floor((z + reach) / CHUNK_SIZE);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const colliders = this.propCache.get(chunkKey(cx, cz));
        if (!colliders) continue;
        for (const c of colliders) {
          const dx = c.x - x;
          const dz = c.z - z;
          const rr = radius + c.r;
          if (dx * dx + dz * dz < rr * rr) return true;
        }
      }
    }
    return false;
  }

  /** Whether the disc overlaps any building's front-face proud buffer. */
  buildingBlocked(x: number, z: number, radius: number): boolean {
    const reach = radius + BUILDING_FRONT_PROUD;
    const cx0 = Math.floor((x - reach) / CHUNK_SIZE);
    const cx1 = Math.floor((x + reach) / CHUNK_SIZE);
    const cz0 = Math.floor((z - reach) / CHUNK_SIZE);
    const cz1 = Math.floor((z + reach) / CHUNK_SIZE);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const boxes = this.buildingCache.get(chunkKey(cx, cz));
        if (!boxes) continue;
        for (const box of boxes) {
          if (discAabbOverlap(x, z, radius, box)) return true;
        }
      }
    }
    return false;
  }

  positionClear(x: number, z: number): boolean {
    return (
      this.walkable(x + PLAYER_RADIUS, z) &&
      this.walkable(x - PLAYER_RADIUS, z) &&
      this.walkable(x, z + PLAYER_RADIUS) &&
      this.walkable(x, z - PLAYER_RADIUS) &&
      !this.propBlocked(x, z, PLAYER_RADIUS) &&
      !this.buildingBlocked(x, z, PLAYER_RADIUS)
    );
  }
}

/** Mirror of wilder_physics::step_move (axis-separated slide). */
export function stepMove(
  store: ChunkStore,
  px: number,
  pz: number,
  dx: number,
  dz: number,
  run: boolean,
  dt: number,
): [number, number] {
  return stepMoveSpeed(store, px, pz, dx, dz, run ? RUN_SPEED : WALK_SPEED, dt);
}

/** Mirror of wilder_physics::step_move_speed (crouch, roll dash). */
export function stepMoveSpeed(
  store: ChunkStore,
  px: number,
  pz: number,
  dx: number,
  dz: number,
  speed: number,
  dt: number,
): [number, number] {
  const len = Math.hypot(dx, dz);
  if (len < 1e-5 || dt <= 0) return [px, pz];
  const clamped = Math.min(dt, 0.25);
  const step = (speed * clamped) / len;
  const mx = dx * step;
  const mz = dz * step;

  let x = px;
  let z = pz;
  if (store.positionClear(x + mx, z)) x += mx;
  if (store.positionClear(x, z + mz)) z += mz;
  return [x, z];
}
