import { Canvas } from "@react-three/fiber";
import { GameConnection } from "../net/connection";
import { useGame } from "../state/game";
import { Effects, Lighting, SceneSetup, SkyBackdrop, SunsetAtmosphere } from "./Atmosphere";
import { CameraRig } from "./CameraRig";
import { Chunks } from "./Chunks";
import { CombatFx } from "./CombatFx";
import { Entities } from "./Entities";
import { PlayerInput } from "./PlayerInput";

export function GameCanvas({ connection }: { connection: GameConnection }) {
  // While the fullscreen map is open, stop rendering the world entirely (the
  // scene stays mounted so closing the map resumes instantly).
  const mapOpen = useGame((s) => s.mapOpen);
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ fov: 34, near: 0.5, far: 400 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      frameloop={mapOpen ? "never" : "always"}
      style={{ position: "absolute", inset: 0, visibility: mapOpen ? "hidden" : "visible" }}
      onCreated={({ gl, scene }) => {
        // Dev-only hook for the screenshot/validation tooling.
        if (import.meta.env.DEV) {
          (window as unknown as Record<string, unknown>).__wilderGl = { gl, scene };
        }
      }}
    >
      <SunsetAtmosphere>
        <SceneSetup />
        <Lighting />
        <SkyBackdrop />
        <Chunks />
        <Entities />
        <CombatFx />
        <CameraRig />
        <PlayerInput connection={connection} />
        <Effects />
      </SunsetAtmosphere>
    </Canvas>
  );
}
