// Canonical "hostile red" used everywhere red appears: enemy borders and
// silhouettes, minimap NPC blips, alert text/icons, damage numbers, etc.
// Keep this in sync with --red / --red-glow in theme.css.

/** Hostile red as a CSS hex string. */
export const RED_HEX = "#ff6a7c";
/** Hostile red as a 0xRRGGBB number (for THREE.Color / bit ops). */
export const RED_NUM = 0xff6a7c;
/** RGB components (0-255), handy for building rgba() glows on canvas. */
export const RED_RGB = { r: 0xff, g: 0x6a, b: 0x7c } as const;

/** Soft glow color (translucent red) for shadows/box-shadows. */
export function redGlow(alpha = 0.7): string {
  return `rgba(${RED_RGB.r}, ${RED_RGB.g}, ${RED_RGB.b}, ${alpha})`;
}
