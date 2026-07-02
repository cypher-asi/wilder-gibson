// Ascent-style follow camera: fixed high pitch, pulled back so the character
// stays small against the environment. The mouse is reserved for aiming, so
// the camera yaw only changes with Q/E; wheel zooms within a tight band.

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { game } from "../state/game";

export const cameraState = {
  yaw: Math.PI / 4,
  distance: 34,
  minDistance: 20,
  maxDistance: 48,
};

const PITCH_NEAR = THREE.MathUtils.degToRad(52);
const PITCH_FAR = THREE.MathUtils.degToRad(62);

export function CameraRig() {
  const { camera, gl } = useThree();
  const target = useRef(new THREE.Vector3());
  const keys = useRef({ q: false, e: false });

  useEffect(() => {
    const canvas = gl.domElement;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraState.distance = THREE.MathUtils.clamp(
        cameraState.distance + event.deltaY * 0.03,
        cameraState.minDistance,
        cameraState.maxDistance,
      );
    };
    const onContext = (event: MouseEvent) => event.preventDefault();
    const onKey = (event: KeyboardEvent, down: boolean) => {
      if (event.code === "KeyQ") keys.current.q = down;
      if (event.code === "KeyE") keys.current.e = down;
    };
    const onKeyDown = (e: KeyboardEvent) => onKey(e, true);
    const onKeyUp = (e: KeyboardEvent) => onKey(e, false);

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContext);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContext);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [gl]);

  useFrame((_, dt) => {
    if (keys.current.q) cameraState.yaw += dt * 1.8;
    if (keys.current.e) cameraState.yaw -= dt * 1.8;

    const player = game.entities.get(game.localEntityId);
    const tx = player ? player.x : game.predicted.x;
    const tz = player ? player.z : game.predicted.z;

    // Smooth follow; snap on long-range teleports (death/extraction respawn).
    const next = new THREE.Vector3(tx, 0, tz);
    if (target.current.distanceTo(next) > 40) {
      target.current.copy(next);
    } else {
      target.current.lerp(next, Math.min(1, dt * 8));
    }

    // Slightly steeper look-down when zoomed out (reads more top-down).
    const zoomFrac =
      (cameraState.distance - cameraState.minDistance) /
      (cameraState.maxDistance - cameraState.minDistance);
    const pitch = THREE.MathUtils.lerp(PITCH_NEAR, PITCH_FAR, zoomFrac);

    const horizontal = Math.cos(pitch) * cameraState.distance;
    const height = Math.sin(pitch) * cameraState.distance;
    camera.position.set(
      target.current.x + Math.cos(cameraState.yaw) * horizontal,
      height,
      target.current.z + Math.sin(cameraState.yaw) * horizontal,
    );
    camera.lookAt(target.current.x, 1.2, target.current.z);
  });

  return null;
}
