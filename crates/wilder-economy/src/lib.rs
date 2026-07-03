//! Resource definitions, yields, zone drop biases and NPC vendor price
//! tables. Phase 2 introduced the resources; the spawn-district commerce
//! layer (vendors, bank, territory cut) builds on top.

use wilder_types::{EntityKind, ItemKind, ZoneKind};

pub const RESOURCES: [ItemKind; 5] = [
    ItemKind::Iron,
    ItemKind::Copper,
    ItemKind::Chemicals,
    ItemKind::Electronics,
    ItemKind::Biomass,
];

/// Resource node variant -> what it yields.
pub fn node_yield(variant: u32) -> ItemKind {
    RESOURCES[(variant as usize) % RESOURCES.len()]
}

// ---------------------------------------------------------------------------
// Commerce constants
// ---------------------------------------------------------------------------

/// Bank conversion fee: percent of converted Cash withheld.
pub const BANK_FEE_PCT: u32 = 10;
/// Percent of every vendor sale/purchase routed to whoever holds the
/// territory the vendor stands in (burned when nobody holds it).
pub const COMMERCE_CUT_PCT: u32 = 10;
/// Cash dropped per NPC kill: (min, max) inclusive. Doubled in BlownUp zones.
pub const CASH_DROP_SCAV: (u32, u32) = (1, 5);
pub const CASH_DROP_RAIDER: (u32, u32) = (3, 10);

// ---------------------------------------------------------------------------
// Zone drop biases
// ---------------------------------------------------------------------------

/// Relative drop weights over [`RESOURCES`] (iron, copper, chemicals,
/// electronics, biomass) for a zone. Zero disables a resource entirely.
pub fn zone_resource_weights(zone: ZoneKind) -> [u32; 5] {
    match zone {
        ZoneKind::BlownUp => [1, 1, 5, 2, 1],
        ZoneKind::Mining => [5, 4, 1, 0, 0],
        ZoneKind::Industrial => [4, 2, 1, 3, 0],
        ZoneKind::TechRuins => [0, 2, 1, 6, 1],
        ZoneKind::Overgrowth => [1, 0, 1, 0, 6],
        ZoneKind::ChemPlant => [0, 1, 6, 1, 2],
        ZoneKind::Scrapyard => [4, 4, 0, 2, 0],
        ZoneKind::Mixed => [1, 1, 1, 1, 1],
    }
}

/// Pick a resource index for a zone from a uniform roll (weight-proportional,
/// deterministic for a given roll).
pub fn zone_resource_index(zone: ZoneKind, roll: u32) -> usize {
    let weights = zone_resource_weights(zone);
    let total: u32 = weights.iter().sum();
    let mut r = roll % total.max(1);
    for (i, &w) in weights.iter().enumerate() {
        if r < w {
            return i;
        }
        r -= w;
    }
    0
}

// ---------------------------------------------------------------------------
// NPC vendor price tables
// ---------------------------------------------------------------------------

/// A vendor's price line: `buy` = WILD the player pays per unit, `sell` =
/// WILD the vendor pays the player per unit. 0 disables that direction.
pub struct VendorEntry {
    pub kind: ItemKind,
    pub buy: u32,
    pub sell: u32,
}

const fn entry(kind: ItemKind, buy: u32, sell: u32) -> VendorEntry {
    VendorEntry { kind, buy, sell }
}

/// Armory: weapons, armor and ammo in WILD. Buy prices sit above craft cost
/// so player manufacturing stays the cheap path; sell prices are the floor.
const ARMORY: &[VendorEntry] = &[
    entry(ItemKind::Pipe, 30, 10),
    entry(ItemKind::Knife, 45, 15),
    entry(ItemKind::Pistol, 140, 45),
    entry(ItemKind::Smg, 320, 100),
    entry(ItemKind::JacketArmor, 90, 30),
    entry(ItemKind::PlateArmor, 220, 70),
    entry(ItemKind::Ammo9mm, 1, 0),
];

/// Bodega: consumables out, raw resources in (cheap, so the player market
/// stays the better place to sell in bulk).
const BODEGA: &[VendorEntry] = &[
    entry(ItemKind::Medkit, 25, 8),
    entry(ItemKind::Flashlight, 10, 3),
    entry(ItemKind::Ammo9mm, 2, 0),
    entry(ItemKind::Iron, 0, 2),
    entry(ItemKind::Copper, 0, 2),
    entry(ItemKind::Chemicals, 0, 3),
    entry(ItemKind::Electronics, 0, 4),
    entry(ItemKind::Biomass, 0, 1),
];

/// The price table for a vendor building kind. Banks and dealerships trade
/// through dedicated flows (Convert / not yet), so their tables are empty.
pub fn vendor_offers(kind: EntityKind) -> &'static [VendorEntry] {
    match kind {
        EntityKind::Armory => ARMORY,
        EntityKind::Bodega => BODEGA,
        _ => &[],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zone_weights_never_empty() {
        for zone in [
            ZoneKind::BlownUp,
            ZoneKind::Mining,
            ZoneKind::Industrial,
            ZoneKind::TechRuins,
            ZoneKind::Overgrowth,
            ZoneKind::ChemPlant,
            ZoneKind::Scrapyard,
            ZoneKind::Mixed,
        ] {
            let total: u32 = zone_resource_weights(zone).iter().sum();
            assert!(total > 0, "{zone:?} has no drop weights");
            // Every roll maps to an in-range resource index.
            for roll in 0..64 {
                assert!(zone_resource_index(zone, roll) < RESOURCES.len());
            }
        }
    }

    #[test]
    fn zone_bias_favors_theme() {
        // Mining ground drops metals more than anything else.
        let w = zone_resource_weights(ZoneKind::Mining);
        assert!(w[0] > w[2] && w[0] > w[3] && w[0] > w[4]);
        // Overgrowth drops biomass more than anything else.
        let w = zone_resource_weights(ZoneKind::Overgrowth);
        assert!(w[4] > w[0] && w[4] > w[1] && w[4] > w[2] && w[4] > w[3]);
    }

    #[test]
    fn vendor_tables_sane() {
        for kind in [EntityKind::Armory, EntityKind::Bodega] {
            let offers = vendor_offers(kind);
            assert!(!offers.is_empty());
            for offer in offers {
                // A vendor never pays more than it charges for the same item.
                if offer.buy > 0 && offer.sell > 0 {
                    assert!(offer.sell < offer.buy, "{:?} margin inverted", offer.kind);
                }
                assert!(offer.buy > 0 || offer.sell > 0);
            }
        }
        assert!(vendor_offers(EntityKind::Bank).is_empty());
        assert!(vendor_offers(EntityKind::Dealership).is_empty());
    }
}
