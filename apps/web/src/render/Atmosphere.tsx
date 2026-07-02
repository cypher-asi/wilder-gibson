// Night city atmosphere: lighting, fog, rain, and post-processing.

import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, SMAA, Vignette } from "@react-three/postprocessing";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { game } from "../state/game";
import { tickFacades } from "./facade";

export function Lighting() {
  const moonRef = useRef<THREE.DirectionalLight>(null);
  const playerLightRef = useRef<THREE.PointLight>(null);

  useFrame(() => {
    // Keep the shadow camera centered on the player so shadows stay crisp.
    const px = game.predicted.x;
    const pz = game.predicted.z;
    const light = moonRef.current;
    if (light) {
      light.position.set(px + 30, 55, pz + 20);
      light.target.position.set(px, 0, pz);
      light.target.updateMatrixWorld();
    }
    playerLightRef.current?.position.set(px, 2.6, pz);
  });

  return (
    <>
      {/* cool ambient night sky bounce */}
      <hemisphereLight args={["#3a4a70", "#131520", 1.25]} />
      {/* moon */}
      <directionalLight
        ref={moonRef}
        color="#aebfff"
        intensity={1.55}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-far={160}
        shadow-bias={-0.0004}
      />
      {/* warm city glow from below the skyline */}
      <ambientLight color="#3d3228" intensity={0.35} />
      {/* soft light bubble around the player so the character reads */}
      <pointLight ref={playerLightRef} color="#9fb4d8" intensity={14} distance={9} decay={1.8} />
    </>
  );
}

const RAIN_COUNT = 900;
const RAIN_AREA = 70;
const RAIN_HEIGHT = 30;

export function Rain() {
  const ref = useRef<THREE.Points>(null);
  const { positions, speeds } = useMemo(() => {
    const positions = new Float32Array(RAIN_COUNT * 3);
    const speeds = new Float32Array(RAIN_COUNT);
    for (let i = 0; i < RAIN_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * RAIN_AREA;
      positions[i * 3 + 1] = Math.random() * RAIN_HEIGHT;
      positions[i * 3 + 2] = (Math.random() - 0.5) * RAIN_AREA;
      speeds[i] = 18 + Math.random() * 14;
    }
    return { positions, speeds };
  }, []);

  useFrame((_, dt) => {
    const points = ref.current;
    if (!points) return;
    const attr = points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < RAIN_COUNT; i++) {
      arr[i * 3 + 1] -= speeds[i] * dt;
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3] = (Math.random() - 0.5) * RAIN_AREA;
        arr[i * 3 + 1] = RAIN_HEIGHT;
        arr[i * 3 + 2] = (Math.random() - 0.5) * RAIN_AREA;
      }
    }
    attr.needsUpdate = true;
    // Rain volume follows the player.
    points.position.set(game.predicted.x, 0, game.predicted.z);
  });

  return (
    <points ref={ref} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#6a7f9a"
        size={0.08}
        transparent
        opacity={0.55}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

export function Effects() {
  return (
    // MSAA off: SMAA handles the edges, which keeps the AO pass cheap.
    <EffectComposer multisampling={0}>
      <N8AO halfRes quality="performance" aoRadius={2.2} intensity={2.6} distanceFalloff={1.5} />
      <Bloom intensity={1.05} luminanceThreshold={0.55} luminanceSmoothing={0.35} mipmapBlur />
      <SMAA />
      <Vignette eskil={false} offset={0.18} darkness={0.78} />
    </EffectComposer>
  );
}

/**
 * Procedural night-city environment map: dark sky dome, a cool moon glow, and
 * neon strips at the horizon. PMREM-filtered and set as scene.environment so
 * wet asphalt, car paint, and metal props pick up colored reflections.
 */
function makeNightEnvironment(gl: THREE.WebGLRenderer): THREE.Texture {
  const envScene = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(100, 32, 16),
    new THREE.MeshBasicMaterial({ color: "#0a1020", side: THREE.BackSide }),
  );
  envScene.add(sky);

  // Neon glow strips around the horizon (city lights bouncing off the haze).
  const strips = ["#ff2d78", "#00e5ff", "#b64dff", "#ffe14d", "#ff6a00", "#39ff8e"];
  strips.forEach((color, i) => {
    const angle = (i / strips.length) * Math.PI * 2;
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 7),
      new THREE.MeshBasicMaterial({ color }),
    );
    strip.position.set(Math.cos(angle) * 70, 5, Math.sin(angle) * 70);
    strip.lookAt(0, 3, 0);
    envScene.add(strip);
  });

  // Moon glow overhead (matches the directional light).
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(7, 16, 16),
    new THREE.MeshBasicMaterial({ color: "#aebfff" }),
  );
  moon.position.set(35, 80, 25);
  envScene.add(moon);

  const pmrem = new THREE.PMREMGenerator(gl);
  const env = pmrem.fromScene(envScene, 0.06).texture;
  pmrem.dispose();
  return env;
}

export function SceneSetup() {
  const { scene, gl } = useThree();
  useMemo(() => {
    scene.fog = new THREE.FogExp2("#0b0e16", 0.016);
    scene.background = new THREE.Color("#070a12");
    scene.environment = makeNightEnvironment(gl);
    scene.environmentIntensity = 0.6;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.35;
    if (import.meta.env.DEV) {
      (window as unknown as { __gl?: THREE.WebGLRenderer }).__gl = gl;
    }
  }, [scene, gl]);

  // Drive time-varying facade shaders (window flicker/toggles).
  useFrame(({ clock }) => tickFacades(clock.elapsedTime));
  return null;
}
