// Adaptive quality tier, driven by AdaptiveQuality (drei PerformanceMonitor).
//
// The tier is reactive (zustand) so render components can re-key expensive
// resources (shadow maps, reflection targets) when it changes; changes are
// rare thanks to the monitor's hysteresis. Numeric knobs live here so every
// consumer scales consistently.

import { create } from "zustand";

export type QualityTier = "high" | "medium" | "low";

interface QualityState {
  tier: QualityTier;
  setTier: (tier: QualityTier) => void;
}

export const useQuality = create<QualityState>((set) => ({
  tier: "high",
  setTier: (tier) => set((s) => (s.tier === tier ? s : { tier })),
}));

/** Golden-style sun shadow map size (was a fixed 4096). */
export function goldenShadowSize(tier: QualityTier): number {
  return tier === "high" ? 2048 : 1024;
}

/** Anime/tron key-light shadow map size (was a fixed 2048). */
export function animeShadowSize(tier: QualityTier): number {
  return tier === "low" ? 512 : 1024;
}
