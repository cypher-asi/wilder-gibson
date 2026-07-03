// Corner minimap (top-right): a live north-up crop of the baked city map
// centered on the player, with entity blips (NPCs, players, extraction
// points) and the safe-zone outline. Click (or M) opens the fullscreen map.

import { useEffect, useRef, useState } from "react";
import { CityMapManifest, getCityMapManifest } from "../game/citymap";
import { CHUNK_SIZE } from "../net/protocol";
import { game, useGame } from "../state/game";

/** Canvas size in CSS px (square panel with notched corners). */
const SIZE = 192;
/** Screen px per world meter. */
const SCALE = 1.35;

export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [manifest, setManifest] = useState<CityMapManifest | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const toggleMap = useGame((s) => s.toggleMap);

  useEffect(() => {
    void getCityMapManifest().then(setManifest);
    const img = new Image();
    img.src = "/citymap/minimap.png";
    img.onload = () => (imageRef.current = img);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== SIZE * dpr) {
        canvas.width = SIZE * dpr;
        canvas.height = SIZE * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#010409";
      ctx.fillRect(0, 0, SIZE, SIZE);

      const px = game.predicted.x;
      const pz = game.predicted.z;
      const toScreen = (x: number, z: number): [number, number] => [
        SIZE / 2 + (x - px) * SCALE,
        SIZE / 2 + (z - pz) * SCALE,
      ];

      // Baked city image: world meters -> image px via the manifest transform.
      const img = imageRef.current;
      const man = manifest;
      if (img && man) {
        const originX = man.tileMinX * man.tileSize;
        const originZ = man.tileMinZ * man.tileSize;
        const metersPerPx = man.tileSize / man.pxPerTile;
        const [sx, sy] = toScreen(originX, originZ);
        const s = SCALE * metersPerPx;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, sx, sy, img.width * s, img.height * s);
        // Holographic recolor to match the fullscreen map: keep the baked
        // luminance but force everything to the hologram blue hue.
        ctx.globalCompositeOperation = "color";
        ctx.fillStyle = "#4fc3ff";
        ctx.fillRect(0, 0, SIZE, SIZE);
        // Lift bright areas (roads) into a glow like the M map's emissive net.
        ctx.globalCompositeOperation = "overlay";
        ctx.fillStyle = "rgba(79, 195, 255, 0.35)";
        ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.globalCompositeOperation = "source-over";
      }

      // Safe-zone outline (chunks |x|,|z| <= 1).
      {
        const [x0, y0] = toScreen(-CHUNK_SIZE, -CHUNK_SIZE);
        const [x1, y1] = toScreen(CHUNK_SIZE * 2, CHUNK_SIZE * 2);
        ctx.strokeStyle = "rgba(41, 217, 140, 0.8)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        ctx.setLineDash([]);
      }

      // Entity blips.
      for (const entity of game.entities.values()) {
        if (entity.id === game.localEntityId) continue;
        const [sx, sy] = toScreen(entity.x, entity.z);
        if (sx < -8 || sy < -8 || sx > SIZE + 8 || sy > SIZE + 8) continue;
        if (entity.kind === "ExtractionPoint") {
          ctx.fillStyle = "#ffd24a";
          ctx.beginPath();
          ctx.moveTo(sx, sy - 5);
          ctx.lineTo(sx + 5, sy);
          ctx.lineTo(sx, sy + 5);
          ctx.lineTo(sx - 5, sy);
          ctx.closePath();
          ctx.fill();
        } else if (entity.kind === "Npc") {
          ctx.fillStyle = "#ff4d5e";
          ctx.beginPath();
          ctx.arc(sx, sy, 3, 0, Math.PI * 2);
          ctx.fill();
        } else if (entity.kind === "Player") {
          ctx.fillStyle = "#29d98c";
          ctx.beginPath();
          ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
          ctx.fill();
        } else if (entity.kind !== "LootContainer" && entity.kind !== "ResourceNode") {
          // Hub stations / stash / market terminals.
          ctx.fillStyle = "rgba(79, 195, 255, 0.9)";
          ctx.fillRect(sx - 2.5, sy - 2.5, 5, 5);
        }
      }

      // Player marker: pulsing dot + facing wedge, always centered.
      {
        const sx = SIZE / 2;
        const sy = SIZE / 2;
        const pulse = 5 + Math.sin(now / 260) * 1.2;
        ctx.fillStyle = "rgba(234, 247, 255, 0.25)";
        ctx.beginPath();
        ctx.arc(sx, sy, pulse + 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(game.predicted.yaw);
        ctx.fillStyle = "#eaf7ff";
        ctx.beginPath();
        ctx.moveTo(pulse + 2, 0);
        ctx.lineTo(-pulse * 0.6, pulse * 0.62);
        ctx.lineTo(-pulse * 0.25, 0);
        ctx.lineTo(-pulse * 0.6, -pulse * 0.62);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // North marker.
      ctx.fillStyle = "rgba(234, 247, 255, 0.85)";
      ctx.font = "700 10px Rajdhani, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("N", SIZE / 2, 13);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [manifest]);

  return (
    <div className="minimap-ring" onClick={toggleMap} title="Open map (M)">
      <canvas ref={canvasRef} className="minimap-canvas" style={{ width: SIZE, height: SIZE }} />
      <span className="minimap-key">M</span>
    </div>
  );
}
