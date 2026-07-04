//! Deterministic store interiors.
//!
//! Every service POI (Bank, Armory, Bodega, ...) docks to a real procedural
//! building's street face. This module carves a walk-in ground-floor room out
//! of that host building: a door gap in the storefront collision band, thin
//! perimeter walls, a service counter and a few furniture blockers.
//!
//! Everything here is *derived* — computed from `(ChunkData, service entity
//! positions)` with integer/tile math and a fixed hash, so the client mirror
//! (`apps/web/src/game/interiors.ts`) reproduces the exact same colliders for
//! prediction without any protocol changes. Keep the two implementations in
//! lockstep.

use wilder_physics::BUILDING_FRONT_PROUD;
use wilder_types::*;

/// Interior wall thickness, meters (matches the storefront proud band so the
/// front wall band keeps its existing depth).
pub const INTERIOR_WALL: f32 = 0.3;
/// Half-width of the door gap carved into the front wall, meters. A full
/// door is 2 m — exactly one tile, centered on the door tile the service
/// entity stands in front of.
pub const DOOR_HALF_WIDTH: f32 = 1.0;
/// Rooms grow at most this many tiles deep into the footprint.
const ROOM_MAX_DEPTH_TILES: i32 = 5;
/// Rooms extend at most this many tiles left / right of the door tile.
const ROOM_SIDE_TILES: i32 = 3;

/// Service kinds that get a walk-in interior.
pub fn is_service_kind(kind: EntityKind) -> bool {
    matches!(
        kind,
        EntityKind::Building
            | EntityKind::MarketTerminal
            | EntityKind::Refinery
            | EntityKind::Factory
            | EntityKind::Laboratory
            | EntityKind::Armory
            | EntityKind::Bank
            | EntityKind::Bodega
            | EntityKind::Dealership
            | EntityKind::Safehouse
    )
}

/// A door carved into a room's front wall.
#[derive(Debug, Clone, PartialEq)]
pub struct InteriorDoor {
    pub entity: EntityId,
    pub kind: EntityKind,
    /// World-space x of the door center on the front wall plane.
    pub x: f32,
}

/// One walk-in room carved out of a host building's ground floor.
#[derive(Debug, Clone, PartialEq)]
pub struct InteriorSpec {
    pub coord: ChunkCoord,
    /// Index of the host building in `ChunkData::buildings`.
    pub building: usize,
    /// World-space room rect `[minx, minz, maxx, maxz]` (front wall plane at
    /// minz, i.e. the building lot line).
    pub bounds: [f32; 4],
    /// Chunk-local room tile rect `[tx0, tz0, tx1, tz1)` — these footprint
    /// tiles become walkable.
    pub tiles: [u8; 4],
    pub doors: Vec<InteriorDoor>,
    /// World-space `[minx, minz, maxx, maxz]` counter boxes, one per door
    /// (same order as `doors`; a door may have none if the room is tiny).
    pub counters: Vec<[f32; 4]>,
    /// World-space wall + furniture colliders (includes the counters).
    pub colliders: Vec<[f32; 4]>,
}

/// All interiors for a chunk plus the per-building replacement front bands.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ChunkInteriors {
    pub specs: Vec<InteriorSpec>,
    /// `(building index, replacement bands)`: the default full-width
    /// storefront proud band is replaced by these segments (door gaps carved).
    pub front_bands: Vec<(usize, Vec<[f32; 4]>)>,
}

impl ChunkInteriors {
    pub fn is_empty(&self) -> bool {
        self.specs.is_empty()
    }
}

/// Deterministic 32-bit mix (mirrored in interiors.ts — keep identical).
fn mix(a: u32, b: u32) -> u32 {
    let mut h = a ^ b.wrapping_mul(0x9E37_79B9);
    h ^= h >> 15;
    h = h.wrapping_mul(0x85EB_CA6B);
    h ^= h >> 13;
    h
}

/// AABB overlap test on `[minx, minz, maxx, maxz]` boxes.
fn boxes_overlap(a: &[f32; 4], b: &[f32; 4]) -> bool {
    a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
}

/// The host building for a service entity standing on the sidewalk tile in
/// front of a building's street (-z) face. Mirrors the client's
/// `hostBuildingFace`: within the face's x-extent (±0.5 m) and within 1.5
/// tiles in front of the lot line; nearest face wins. Footprints under 2x2
/// tiles are skipped (no room fits).
fn host_building(chunk: &ChunkData, ex: f32, ez: f32) -> Option<usize> {
    let ox = chunk.coord.x as f32 * CHUNK_SIZE;
    let oz = chunk.coord.z as f32 * CHUNK_SIZE;
    let mut best: Option<(f32, usize)> = None;
    for (i, b) in chunk.buildings.iter().enumerate() {
        if b.tx1.saturating_sub(b.tx0) < 2 || b.tz1.saturating_sub(b.tz0) < 2 {
            continue;
        }
        let x0 = ox + b.tx0 as f32 * TILE_SIZE;
        let x1 = ox + b.tx1 as f32 * TILE_SIZE;
        let wall_z = oz + b.tz0 as f32 * TILE_SIZE;
        if ex < x0 - 0.5 || ex > x1 + 0.5 {
            continue;
        }
        let dz = wall_z - ez;
        if !(0.0..=TILE_SIZE * 1.5).contains(&dz) {
            continue;
        }
        if best.map(|(d, _)| dz < d).unwrap_or(true) {
            best = Some((dz, i));
        }
    }
    best.map(|(_, i)| i)
}

/// Compute every interior room for a chunk given the service entities placed
/// in it. `services` order does not matter; output is deterministic.
pub fn chunk_interiors(
    chunk: &ChunkData,
    services: &[(EntityId, EntityKind, Vec3)],
) -> ChunkInteriors {
    let ox = chunk.coord.x as f32 * CHUNK_SIZE;
    let oz = chunk.coord.z as f32 * CHUNK_SIZE;

    // Group doors by host building, sorted by x for stable output.
    let mut per_building: Vec<(usize, Vec<InteriorDoor>)> = Vec::new();
    let mut sorted: Vec<&(EntityId, EntityKind, Vec3)> = services.iter().collect();
    sorted.sort_by(|a, b| a.2.x.partial_cmp(&b.2.x).unwrap().then(a.0.cmp(&b.0)));
    for &&(entity, kind, pos) in &sorted {
        if !is_service_kind(kind) {
            continue;
        }
        let Some(bi) = host_building(chunk, pos.x, pos.z) else { continue };
        let door = InteriorDoor { entity, kind, x: pos.x };
        match per_building.iter_mut().find(|(i, _)| *i == bi) {
            Some((_, doors)) => doors.push(door),
            None => per_building.push((bi, doors_vec(door))),
        }
    }
    per_building.sort_by_key(|(i, _)| *i);

    let mut out = ChunkInteriors::default();
    for (bi, doors) in per_building {
        let b = &chunk.buildings[bi];
        let front_z = oz + b.tz0 as f32 * TILE_SIZE;

        // Each door claims a tile rect around its door tile; overlapping or
        // touching rects merge into one shared room.
        struct Group {
            tx0: i32,
            tx1: i32,
            doors: Vec<InteriorDoor>,
        }
        let mut groups: Vec<Group> = Vec::new();
        for door in doors {
            let dtx = (((door.x - ox) / TILE_SIZE).floor() as i32)
                .clamp(b.tx0 as i32, b.tx1 as i32 - 1);
            let tx0 = (dtx - ROOM_SIDE_TILES).max(b.tx0 as i32);
            let tx1 = (dtx + 1 + ROOM_SIDE_TILES).min(b.tx1 as i32);
            match groups.last_mut() {
                // Doors are sorted by x, so only the last group can touch.
                Some(g) if tx0 <= g.tx1 => {
                    g.tx1 = g.tx1.max(tx1);
                    g.doors.push(door);
                }
                _ => groups.push(Group { tx0, tx1, doors: doors_vec(door) }),
            }
        }

        let tz0 = b.tz0 as i32;
        let tz1 = (tz0 + ROOM_MAX_DEPTH_TILES).min(b.tz1 as i32);
        let mut all_door_xs: Vec<f32> = Vec::new();

        for mut g in groups {
            let rx0 = ox + g.tx0 as f32 * TILE_SIZE;
            let rx1 = ox + g.tx1 as f32 * TILE_SIZE;
            let rz1 = oz + tz1 as f32 * TILE_SIZE;
            let room_w = rx1 - rx0;
            let room_d = rz1 - front_z;

            // Clamp each door's gap fully inside the room's side walls.
            let door_min = rx0 + INTERIOR_WALL + DOOR_HALF_WIDTH + 0.2;
            let door_max = rx1 - INTERIOR_WALL - DOOR_HALF_WIDTH - 0.2;
            for d in &mut g.doors {
                d.x = d.x.clamp(door_min, door_max);
            }
            all_door_xs.extend(g.doors.iter().map(|d| d.x));

            let mut colliders: Vec<[f32; 4]> = Vec::new();
            // Side + back walls just inside the room rect.
            colliders.push([rx0, front_z, rx0 + INTERIOR_WALL, rz1]);
            colliders.push([rx1 - INTERIOR_WALL, front_z, rx1, rz1]);
            colliders.push([rx0, rz1 - INTERIOR_WALL, rx1, rz1]);

            // Counters: one per door, against the back wall, centered on the
            // door so the shopkeep faces the entrance.
            let open_x0 = rx0 + INTERIOR_WALL;
            let open_x1 = rx1 - INTERIOR_WALL;
            let back_gap = if room_d >= 5.2 { 1.2 } else { 0.4 };
            let counter_z1 = rz1 - INTERIOR_WALL - back_gap;
            let counter_z0 = counter_z1 - 0.8;
            let mut counters: Vec<[f32; 4]> = Vec::new();
            for d in &g.doors {
                let cw = (room_w - 2.8).min(4.6);
                if cw < 1.2 || counter_z0 <= front_z + 1.6 {
                    counters.push([0.0, 0.0, 0.0, 0.0]);
                    continue;
                }
                let cx = d.x.clamp(open_x0 + cw / 2.0 + 0.6, open_x1 - cw / 2.0 - 0.6);
                let counter = [cx - cw / 2.0, counter_z0, cx + cw / 2.0, counter_z1];
                counters.push(counter);
                colliders.push(counter);
            }

            // Furniture blockers, seeded from the building style. Kept clear
            // of every door corridor and counter.
            let open = [open_x0, front_z + 0.4, open_x1, counter_z0.max(front_z + 0.4)];
            let mut avoid: Vec<[f32; 4]> = counters
                .iter()
                .filter(|c| c[2] > c[0])
                .cloned()
                .collect();
            for d in &g.doors {
                avoid.push([d.x - 1.3, front_z, d.x + 1.3, counter_z0.max(front_z)]);
            }
            for (di, d) in g.doors.iter().enumerate() {
                furniture(
                    d.kind,
                    &open,
                    b.style.wrapping_add(di as u32),
                    &avoid,
                    &mut colliders,
                );
            }

            out.specs.push(InteriorSpec {
                coord: chunk.coord,
                building: bi,
                bounds: [rx0, front_z, rx1, rz1],
                tiles: [g.tx0 as u8, tz0 as u8, g.tx1 as u8, tz1 as u8],
                doors: g.doors,
                counters,
                colliders,
            });
        }

        // Replacement storefront band: the full-footprint proud band with a
        // gap carved at every (clamped) door of this building.
        let bx0 = ox + b.tx0 as f32 * TILE_SIZE;
        let bx1 = ox + b.tx1 as f32 * TILE_SIZE;
        all_door_xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let mut bands: Vec<[f32; 4]> = Vec::new();
        let mut cursor = bx0;
        for dx in &all_door_xs {
            let gap0 = dx - DOOR_HALF_WIDTH;
            let gap1 = dx + DOOR_HALF_WIDTH;
            if gap0 > cursor {
                bands.push([cursor, front_z - BUILDING_FRONT_PROUD, gap0, front_z]);
            }
            cursor = cursor.max(gap1);
        }
        if cursor < bx1 {
            bands.push([cursor, front_z - BUILDING_FRONT_PROUD, bx1, front_z]);
        }
        out.front_bands.push((bi, bands));
    }
    out
}

fn doors_vec(door: InteriorDoor) -> Vec<InteriorDoor> {
    vec![door]
}

/// Try to add `bx` to `out` if it fits inside `open` and avoids every box in
/// `avoid` (door corridors, counters, earlier furniture).
fn push_if_clear(out: &mut Vec<[f32; 4]>, avoid: &mut Vec<[f32; 4]>, open: &[f32; 4], bx: [f32; 4]) {
    if bx[0] < open[0] || bx[1] < open[1] || bx[2] > open[2] || bx[3] > open[3] {
        return;
    }
    if bx[2] - bx[0] < 0.05 || bx[3] - bx[1] < 0.05 {
        return;
    }
    if avoid.iter().any(|a| boxes_overlap(a, &bx)) {
        return;
    }
    avoid.push(bx);
    out.push(bx);
}

/// Per-kind furniture blockers (collision only — decorative detail is
/// client-side). All boxes are seeded from `style` so both sides agree.
fn furniture(
    kind: EntityKind,
    open: &[f32; 4],
    style: u32,
    avoid: &[[f32; 4]],
    out: &mut Vec<[f32; 4]>,
) {
    let mut avoid: Vec<[f32; 4]> = avoid.to_vec();
    let [ax0, az0, ax1, az1] = *open;
    let w = ax1 - ax0;
    let d = az1 - az0;
    if w < 4.0 || d < 2.0 {
        return;
    }
    match kind {
        // Shelf aisles hugging the side walls.
        EntityKind::Armory | EntityKind::Bodega | EntityKind::Building => {
            let len = 2.0f32.min(d - 1.0);
            let span = (d - len - 0.4).max(0.0);
            let zl = az0 + 0.2 + (mix(style, 11) % 8) as f32 * (span / 8.0);
            let zr = az0 + 0.2 + (mix(style, 23) % 8) as f32 * (span / 8.0);
            push_if_clear(out, &mut avoid, open, [ax0, zl, ax0 + 0.5, zl + len]);
            push_if_clear(out, &mut avoid, open, [ax1 - 0.5, zr, ax1, zr + len]);
        }
        // Freestanding machinery flanking the room.
        EntityKind::Factory | EntityKind::Refinery => {
            let zl = az0 + 0.4 + (mix(style, 37) % 6) as f32 * ((d - 2.0).max(0.0) / 6.0);
            let zr = az0 + 0.4 + (mix(style, 53) % 6) as f32 * ((d - 2.0).max(0.0) / 6.0);
            push_if_clear(out, &mut avoid, open, [ax0 + 0.3, zl, ax0 + 1.5, zl + 1.2]);
            push_if_clear(out, &mut avoid, open, [ax1 - 1.5, zr, ax1 - 0.3, zr + 1.2]);
        }
        // Work benches mid-room, flanking the door corridor.
        EntityKind::Laboratory => {
            let cz = az0 + d * 0.45;
            let cx = (ax0 + ax1) / 2.0;
            push_if_clear(out, &mut avoid, open, [cx - 3.1, cz - 0.4, cx - 1.5, cz + 0.4]);
            push_if_clear(out, &mut avoid, open, [cx + 1.5, cz - 0.4, cx + 3.1, cz + 0.4]);
        }
        // Showroom pedestal.
        EntityKind::Dealership => {
            let cx = ax0 + w * 0.3;
            let cz = az0 + d * 0.5;
            push_if_clear(out, &mut avoid, open, [cx - 1.0, cz - 1.0, cx + 1.0, cz + 1.0]);
        }
        // Bank / market / safehouse floors stay open.
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One 6x6-tile building with its front row at tz=4, in chunk (0,0).
    fn test_chunk() -> ChunkData {
        let n = TILES_PER_CHUNK;
        let mut tiles = vec![TileKind::Sidewalk; n * n];
        let b = BuildingInstance { archetype: 0, tx0: 4, tz0: 4, tx1: 10, tz1: 10, stories: 3, style: 12345 };
        for tz in 4..10 {
            for tx in 4..10 {
                tiles[tz * n + tx] = TileKind::Building;
            }
        }
        ChunkData {
            coord: ChunkCoord::new(0, 0),
            tiles,
            buildings: vec![b],
            props: Vec::new(),
        }
    }

    /// Entity on the sidewalk tile centered in front of the building
    /// (tile x=7 -> world x=15, tile z=3 -> world z=7).
    fn service() -> (EntityId, EntityKind, Vec3) {
        (42, EntityKind::Bank, Vec3::new(15.0, 0.0, 7.0))
    }

    #[test]
    fn builds_a_room_with_a_door_gap() {
        let chunk = test_chunk();
        let out = chunk_interiors(&chunk, &[service()]);
        assert_eq!(out.specs.len(), 1);
        let spec = &out.specs[0];
        assert_eq!(spec.building, 0);
        assert_eq!(spec.doors.len(), 1);
        let door_x = spec.doors[0].x;
        assert!((door_x - 15.0).abs() < 1e-4);

        // The replacement front bands must leave the door gap open.
        let (bi, bands) = &out.front_bands[0];
        assert_eq!(*bi, 0);
        for band in bands {
            assert!(
                band[2] <= door_x - DOOR_HALF_WIDTH + 1e-4
                    || band[0] >= door_x + DOOR_HALF_WIDTH - 1e-4,
                "band {band:?} covers the door at {door_x}"
            );
        }
        // And still cover the rest of the face.
        assert!(bands.iter().any(|b| b[0] <= 8.0 + 1e-4));
        assert!(bands.iter().any(|b| b[2] >= 20.0 - 1e-4));
    }

    #[test]
    fn walls_bound_the_room() {
        let chunk = test_chunk();
        let out = chunk_interiors(&chunk, &[service()]);
        let spec = &out.specs[0];
        let [rx0, rz0, rx1, rz1] = spec.bounds;
        // Room rect covers the footprint front (lot line z=8) and is capped
        // in depth at ROOM_MAX_DEPTH_TILES.
        assert!((rz0 - 8.0).abs() < 1e-4);
        assert!(rz1 <= 8.0 + ROOM_MAX_DEPTH_TILES as f32 * TILE_SIZE + 1e-4);
        // Side and back walls present, inside the rect.
        assert!(spec.colliders.iter().any(|c| (c[0] - rx0).abs() < 1e-4 && c[2] - c[0] <= INTERIOR_WALL + 1e-4));
        assert!(spec.colliders.iter().any(|c| (c[2] - rx1).abs() < 1e-4 && c[2] - c[0] <= INTERIOR_WALL + 1e-4));
        assert!(spec.colliders.iter().any(|c| (c[3] - rz1).abs() < 1e-4 && c[3] - c[1] <= INTERIOR_WALL + 1e-4));
        // Every collider stays inside the room rect.
        for c in &spec.colliders {
            assert!(c[0] >= rx0 - 1e-4 && c[2] <= rx1 + 1e-4);
            assert!(c[1] >= rz0 - 1e-4 && c[3] <= rz1 + 1e-4);
        }
    }

    #[test]
    fn counter_faces_the_door_and_corridor_stays_clear() {
        let chunk = test_chunk();
        let out = chunk_interiors(&chunk, &[service()]);
        let spec = &out.specs[0];
        assert_eq!(spec.counters.len(), 1);
        let counter = spec.counters[0];
        assert!(counter[2] > counter[0], "counter should exist in a 12x10 room");
        let door_x = spec.doors[0].x;
        // Door corridor from the front wall to the counter is free of
        // furniture (walls excluded by construction).
        let corridor = [door_x - 1.0, spec.bounds[1] + 0.35, door_x + 1.0, counter[1] - 0.05];
        for c in &spec.colliders {
            // Skip perimeter walls.
            if c[2] - c[0] <= INTERIOR_WALL + 1e-4 || c[3] - c[1] <= INTERIOR_WALL + 1e-4 && (c[3] - spec.bounds[3]).abs() < 1e-3 {
                continue;
            }
            assert!(
                !boxes_overlap(c, &corridor) || *c == counter && c[1] >= corridor[3],
                "collider {c:?} blocks the door corridor"
            );
        }
    }

    #[test]
    fn deterministic() {
        let chunk = test_chunk();
        let a = chunk_interiors(&chunk, &[service()]);
        let b = chunk_interiors(&chunk, &[service()]);
        assert_eq!(a, b);
    }

    #[test]
    fn two_doors_on_one_face_share_or_split_rooms() {
        let chunk = test_chunk();
        let s1 = (1u64, EntityKind::Bank, Vec3::new(10.0, 0.0, 7.0));
        let s2 = (2u64, EntityKind::Armory, Vec3::new(18.0, 0.0, 7.0));
        let out = chunk_interiors(&chunk, &[s2, s1]);
        // Rects overlap (8 m apart, ±3 tiles each) so the doors merge into
        // one shared room with two door gaps and two counters.
        assert_eq!(out.specs.len(), 1);
        let spec = &out.specs[0];
        assert_eq!(spec.doors.len(), 2);
        assert!(spec.doors[0].x < spec.doors[1].x, "doors sorted by x");
        let (_, bands) = &out.front_bands[0];
        for d in &spec.doors {
            for band in bands {
                assert!(
                    band[2] <= d.x - DOOR_HALF_WIDTH + 1e-4 || band[0] >= d.x + DOOR_HALF_WIDTH - 1e-4
                );
            }
        }
    }

    #[test]
    fn non_service_and_hostless_entities_are_ignored() {
        let chunk = test_chunk();
        let npc = (7u64, EntityKind::Npc, Vec3::new(15.0, 0.0, 7.0));
        let far = (8u64, EntityKind::Bank, Vec3::new(15.0, 0.0, 20.0));
        let out = chunk_interiors(&chunk, &[npc, far]);
        assert!(out.is_empty());
    }
}
