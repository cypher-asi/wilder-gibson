// Short-lived combat visuals: tracers + muzzle flashes for ranged shots,
// hit sparks with floating damage numbers, and a death pulse. Events are
// queued in `game.fx` by the connection layer and drained here each frame.

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { CombatFxEvent, game } from "../state/game";

const LIFETIME_MS: Record<CombatFxEvent["type"], number> = {
  tracer: 170,
  hit: 800,
  death: 600,
};

interface ActiveFx {
  id: number;
  ev: CombatFxEvent;
}

let nextFxId = 1;

export function CombatFx() {
  const [effects, setEffects] = useState<ActiveFx[]>([]);

  useFrame(() => {
    if (game.fx.length === 0) return;
    const drained = game.fx.splice(0, game.fx.length);
    setEffects((prev) =>
      [...prev, ...drained.map((ev) => ({ id: nextFxId++, ev }))].slice(-48),
    );
  });

  // Prune expired effects (component animations end well before this).
  useEffect(() => {
    const timer = setInterval(() => {
      const now = performance.now();
      setEffects((prev) => {
        const alive = prev.filter((e) => now - e.ev.at < LIFETIME_MS[e.ev.type] + 200);
        return alive.length === prev.length ? prev : alive;
      });
    }, 400);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      {effects.map(({ id, ev }) =>
        ev.type === "tracer" ? (
          <Tracer key={id} ev={ev} />
        ) : ev.type === "hit" ? (
          <HitFx key={id} ev={ev} />
        ) : (
          <DeathPulse key={id} ev={ev} />
        ),
      )}
    </>
  );
}

const UP = new THREE.Vector3(0, 1, 0);

/** Bright bullet streak from muzzle to the aim point, with a muzzle flash. */
function Tracer({ ev }: { ev: Extract<CombatFxEvent, { type: "tracer" }> }) {
  const mesh = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);

  const from = new THREE.Vector3(ev.fx, ev.fy, ev.fz);
  const to = new THREE.Vector3(ev.tx, ev.ty, ev.tz);
  const dir = to.clone().sub(from);
  const length = Math.max(dir.length(), 0.1);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());

  useFrame(() => {
    const t = (performance.now() - ev.at) / LIFETIME_MS.tracer;
    const fade = THREE.MathUtils.clamp(1 - t, 0, 1);
    if (mesh.current) {
      (mesh.current.material as THREE.MeshBasicMaterial).opacity = fade * 0.9;
      mesh.current.visible = t < 1;
    }
    if (light.current) light.current.intensity = fade * 14;
  });

  return (
    <>
      <mesh ref={mesh} position={mid} quaternion={quat}>
        <cylinderGeometry args={[0.025, 0.025, length, 5]} />
        <meshBasicMaterial
          color="#ffd27a"
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <pointLight ref={light} position={from} color="#ffbf60" intensity={14} distance={7} />
    </>
  );
}

/** Impact spark + floating damage number. */
function HitFx({ ev }: { ev: Extract<CombatFxEvent, { type: "hit" }> }) {
  const spark = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!spark.current) return;
    const t = (performance.now() - ev.at) / 220;
    spark.current.visible = t < 1;
    if (t < 1) {
      spark.current.scale.setScalar(0.35 + t * 0.65);
      (spark.current.material as THREE.MeshBasicMaterial).opacity =
        THREE.MathUtils.clamp(1 - t, 0, 1) * 0.55;
    }
  });

  return (
    <group position={[ev.x, ev.y, ev.z]}>
      <mesh ref={spark}>
        <sphereGeometry args={[0.22, 8, 8]} />
        <meshBasicMaterial
          color="#ffe9b0"
          transparent
          opacity={0.55}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <Html center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
        <div className="dmg-float">{Math.round(ev.damage)}</div>
      </Html>
    </group>
  );
}

/** Expanding ground ring when something dies. */
function DeathPulse({ ev }: { ev: Extract<CombatFxEvent, { type: "death" }> }) {
  const ring = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!ring.current) return;
    const t = (performance.now() - ev.at) / LIFETIME_MS.death;
    ring.current.visible = t < 1;
    if (t < 1) {
      ring.current.scale.setScalar(0.3 + t * 2.2);
      (ring.current.material as THREE.MeshBasicMaterial).opacity =
        THREE.MathUtils.clamp(1 - t, 0, 1) * 0.7;
    }
  });

  return (
    <mesh ref={ring} position={[ev.x, 0.06, ev.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.7, 0.85, 32]} />
      <meshBasicMaterial
        color="#ff5d5d"
        transparent
        opacity={0.7}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}
