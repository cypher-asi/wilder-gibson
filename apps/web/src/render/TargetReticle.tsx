// Hover target diagram: when the cursor is over an enemy, a camera-facing
// reticle locks around it — rotating ring segments, corner brackets, and a
// health arc — with a scale-in snap on acquire.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { game } from "../state/game";

const COLOR = "#ff3040";
const CHEST_HEIGHT = 1.15;
/** Scale-in duration when a new target is acquired, ms. */
const ACQUIRE_MS = 140;

export function TargetReticle() {
  const group = useRef<THREE.Group>(null);
  const spinner = useRef<THREE.Group>(null);
  const healthArc = useRef<THREE.Mesh>(null);
  const acquiredAt = useRef(0);
  const lastTarget = useRef<number | null>(null);
  const arcGeometry = useRef<THREE.RingGeometry | null>(null);
  const lastArcPct = useRef(-1);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: COLOR,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    [],
  );

  useFrame(({ camera, clock }) => {
    if (!group.current) return;
    const id = game.hoverTargetId;
    const target = id != null ? game.entities.get(id) : undefined;
    const valid =
      !!target && target.healthPct > 0 && target.anim !== "Death";
    group.current.visible = valid;
    if (!valid || !target) {
      lastTarget.current = null;
      return;
    }
    const now = performance.now();
    if (lastTarget.current !== id) {
      lastTarget.current = id ?? null;
      acquiredAt.current = now;
    }

    // Follow the target at chest height, always facing the camera.
    group.current.position.set(target.x, target.y + CHEST_HEIGHT, target.z);
    group.current.quaternion.copy(camera.quaternion);

    // Snap-in: start oversized and settle onto the target.
    const acquire = THREE.MathUtils.clamp(
      (now - acquiredAt.current) / ACQUIRE_MS,
      0,
      1,
    );
    const ease = 1 - (1 - acquire) * (1 - acquire);
    group.current.scale.setScalar(1.7 - 0.7 * ease);
    material.opacity = 0.35 + ease * 0.55;

    // Rotating ring segments.
    if (spinner.current) spinner.current.rotation.z = clock.elapsedTime * 1.6;

    // Health arc (rebuilt only when the fraction actually changes).
    const pct = Math.max(target.healthPct, 0.02);
    if (healthArc.current && Math.abs(pct - lastArcPct.current) > 0.01) {
      lastArcPct.current = pct;
      arcGeometry.current?.dispose();
      arcGeometry.current = new THREE.RingGeometry(
        0.62,
        0.68,
        40,
        1,
        Math.PI / 2,
        -pct * Math.PI * 2,
      );
      healthArc.current.geometry = arcGeometry.current;
    }
  });

  // Corner brackets: four L shapes around the target.
  const brackets = useMemo(() => {
    const out: { x: number; y: number; rot: number }[] = [];
    const d = 0.52;
    out.push({ x: -d, y: d, rot: 0 });
    out.push({ x: d, y: d, rot: -Math.PI / 2 });
    out.push({ x: d, y: -d, rot: Math.PI });
    out.push({ x: -d, y: -d, rot: Math.PI / 2 });
    return out;
  }, []);

  return (
    <group ref={group} visible={false} renderOrder={30}>
      {/* rotating segmented ring */}
      <group ref={spinner}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} material={material} renderOrder={30}>
            <ringGeometry
              args={[0.5, 0.545, 24, 1, (i * Math.PI * 2) / 3, Math.PI * 0.42]}
            />
          </mesh>
        ))}
      </group>
      {/* corner brackets */}
      {brackets.map((b, i) => (
        <group key={i} position={[b.x, b.y, 0]} rotation={[0, 0, b.rot]}>
          <mesh material={material} position={[0.09, 0, 0]} renderOrder={30}>
            <planeGeometry args={[0.18, 0.04]} />
          </mesh>
          <mesh material={material} position={[0, -0.09, 0]} renderOrder={30}>
            <planeGeometry args={[0.04, 0.18]} />
          </mesh>
        </group>
      ))}
      {/* health arc (geometry swapped in useFrame as health changes) */}
      <mesh ref={healthArc} material={material} renderOrder={30}>
        <ringGeometry args={[0.62, 0.68, 40, 1, Math.PI / 2, -Math.PI * 2]} />
      </mesh>
      {/* center dot */}
      <mesh material={material} renderOrder={30}>
        <circleGeometry args={[0.03, 12]} />
      </mesh>
    </group>
  );
}
