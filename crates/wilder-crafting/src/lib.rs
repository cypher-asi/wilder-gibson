//! Recipes: resources -> refinery -> materials -> factory -> weapons.
//! Implemented in Phase 2; tuned via wilder-sim.

use wilder_types::ItemKind;

#[derive(Debug, Clone)]
pub struct Recipe {
    pub id: &'static str,
    pub station: Station,
    pub inputs: &'static [(ItemKind, u32)],
    pub output: (ItemKind, u32),
    /// Seconds per craft.
    pub seconds: f32,
    /// Energy (wallet currency) burned per crafted unit — production fuel.
    pub energy: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Station {
    Refinery,
    Factory,
    Laboratory,
}

pub const RECIPES: &[Recipe] = &[
    // Refinery: resources -> materials (1 Energy per unit)
    Recipe { id: "steel_plate", station: Station::Refinery, inputs: &[(ItemKind::Iron, 4)], output: (ItemKind::SteelPlate, 1), seconds: 4.0, energy: 1 },
    Recipe { id: "copper_wire", station: Station::Refinery, inputs: &[(ItemKind::Copper, 3)], output: (ItemKind::CopperWire, 2), seconds: 3.0, energy: 1 },
    Recipe { id: "polymer", station: Station::Refinery, inputs: &[(ItemKind::Chemicals, 3), (ItemKind::Biomass, 2)], output: (ItemKind::Polymer, 1), seconds: 5.0, energy: 1 },
    Recipe { id: "circuit_board", station: Station::Refinery, inputs: &[(ItemKind::Electronics, 2), (ItemKind::CopperWire, 2)], output: (ItemKind::CircuitBoard, 1), seconds: 6.0, energy: 1 },
    Recipe { id: "bio_gel", station: Station::Refinery, inputs: &[(ItemKind::Biomass, 4), (ItemKind::Chemicals, 1)], output: (ItemKind::BioGel, 1), seconds: 4.0, energy: 1 },
    // Factory: materials -> gear (2 Energy per unit)
    Recipe { id: "pipe", station: Station::Factory, inputs: &[(ItemKind::SteelPlate, 2)], output: (ItemKind::Pipe, 1), seconds: 6.0, energy: 2 },
    Recipe { id: "knife", station: Station::Factory, inputs: &[(ItemKind::SteelPlate, 1), (ItemKind::Polymer, 1)], output: (ItemKind::Knife, 1), seconds: 8.0, energy: 2 },
    Recipe { id: "pistol", station: Station::Factory, inputs: &[(ItemKind::SteelPlate, 3), (ItemKind::Polymer, 2), (ItemKind::CircuitBoard, 1)], output: (ItemKind::Pistol, 1), seconds: 15.0, energy: 2 },
    Recipe { id: "smg", station: Station::Factory, inputs: &[(ItemKind::SteelPlate, 5), (ItemKind::Polymer, 3), (ItemKind::CircuitBoard, 2)], output: (ItemKind::Smg, 1), seconds: 25.0, energy: 2 },
    Recipe { id: "ammo_9mm", station: Station::Factory, inputs: &[(ItemKind::SteelPlate, 1), (ItemKind::Chemicals, 2)], output: (ItemKind::Ammo9mm, 30), seconds: 3.0, energy: 2 },
    Recipe { id: "jacket_armor", station: Station::Factory, inputs: &[(ItemKind::Polymer, 4), (ItemKind::BioGel, 1)], output: (ItemKind::JacketArmor, 1), seconds: 10.0, energy: 2 },
    Recipe { id: "plate_armor", station: Station::Factory, inputs: &[(ItemKind::SteelPlate, 6), (ItemKind::Polymer, 2), (ItemKind::BioGel, 2)], output: (ItemKind::PlateArmor, 1), seconds: 20.0, energy: 2 },
    Recipe { id: "medkit", station: Station::Factory, inputs: &[(ItemKind::BioGel, 2), (ItemKind::Polymer, 1)], output: (ItemKind::Medkit, 1), seconds: 6.0, energy: 2 },
];

/// Energy burned by one Laboratory research unlock (on top of fragments +
/// resources; see wilder-world's RESEARCH_FRAGMENTS/RESEARCH_RESOURCES).
pub const RESEARCH_ENERGY: u32 = 5;

/// Recipes every actor (player or agent) knows from the start; the rest
/// need Laboratory research.
pub const DEFAULT_BLUEPRINTS: &[&str] =
    &["steel_plate", "copper_wire", "pipe", "knife", "ammo_9mm", "medkit"];

pub fn recipe(id: &str) -> Option<&'static Recipe> {
    RECIPES.iter().find(|r| r.id == id)
}
