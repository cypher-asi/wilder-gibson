// Point-of-interest taxonomy: what each service building is, what happens
// there, and how it's drawn. Single source of truth for colors/glyphs so the
// HUD, minimap, holo map and in-world signage all agree.

import { EntityKind } from "../net/protocol";

export interface PoiStyle {
  /** Display label (map legend, in-world sign). */
  label: string;
  /** Single-character marker glyph (minimap/holo map). */
  glyph: string;
  /** Accent color shared by every surface. */
  color: string;
  /** One-line "what happens here" for the legend. */
  desc: string;
}

/** Vendor buildings served by the shared vendor panel/protocol. */
export const VENDOR_KINDS = ["Armory", "Bodega", "Bank", "Dealership"] as const;
export type VendorKind = (typeof VENDOR_KINDS)[number];

export const POI_STYLES: Partial<Record<EntityKind, PoiStyle>> = {
  Building: {
    label: "STORAGE",
    glyph: "S",
    color: "#4fc3ff",
    desc: "Stash your backpack loot",
  },
  MarketTerminal: {
    label: "MARKET",
    glyph: "M",
    color: "#ffd700",
    desc: "Player market — trade in WILD",
  },
  Refinery: {
    label: "REFINERY",
    glyph: "R",
    color: "#ff8c1a",
    desc: "Refine resources into materials",
  },
  Factory: {
    label: "FACTORY",
    glyph: "F",
    color: "#ff2d78",
    desc: "Manufacture gear from materials",
  },
  Laboratory: {
    label: "LABORATORY",
    glyph: "L",
    color: "#8f7bff",
    desc: "Research blueprints",
  },
  Armory: {
    label: "ARMORY",
    glyph: "A",
    color: "#ff4f3f",
    desc: "Buy & sell weapons, armor, ammo",
  },
  Bank: {
    label: "BANK",
    glyph: "B",
    color: "#86ffd4",
    desc: "Convert looted Cash into WILD",
  },
  Bodega: {
    label: "BODEGA",
    glyph: "G",
    color: "#d0ff4f",
    desc: "General store — consumables & resource buyer",
  },
  Dealership: {
    label: "DEALERSHIP",
    glyph: "D",
    color: "#b06bff",
    desc: "Vehicles (coming soon)",
  },
  Safehouse: {
    label: "SAFEHOUSE",
    glyph: "H",
    color: "#29d98c",
    desc: "Safety bubble — hostiles ignore you",
  },
};

export function isVendorKind(kind: EntityKind): kind is VendorKind {
  return (VENDOR_KINDS as readonly string[]).includes(kind);
}
