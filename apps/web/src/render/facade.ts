// Procedural building facade material: emissive window grid with a cheap
// parallax "interior" depth illusion, per-window time variation (toggles,
// TV flicker), and subtle night shading. One shared shader; per-building
// uniforms; a single shared uTime uniform driven by tickFacades().

import * as THREE from "three";

const vertex = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormal2;
  varying vec3 vViewDir;
  void main() {
    vLocal = position;
    vNormal2 = normalMatrix * normal;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vViewDir = world.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uSize;        // building dimensions (w, h, d)
  uniform vec3 uBaseColor;
  uniform vec3 uWindowColor;
  uniform float uSeed;
  uniform float uLitRatio;
  uniform float uTime;
  varying vec3 vLocal;
  varying vec3 vNormal2;
  varying vec3 vViewDir;

  // Storefront ground floor: taller than upper stories, windowless for now.
  const float GROUND_FLOOR = 4.5;
  const float STORY_HEIGHT = 3.0;
  const float CELL_W = 1.4;

  float hash(vec2 p) {
    return fract(sin(dot(p + uSeed, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    // Base facade with vertical gradient (grime near street level).
    float heightFrac = clamp((vLocal.y + uSize.y * 0.5) / uSize.y, 0.0, 1.0);
    vec3 base = uBaseColor * (0.35 + 0.65 * heightFrac);

    // Cheap directional shading from a cool moon light.
    vec3 faceN = normalize(cross(dFdx(vLocal), dFdy(vLocal)));
    vec3 moonDir = normalize(vec3(0.4, 0.8, 0.3));
    float ndl = max(dot(faceN, moonDir), 0.0);
    base *= 0.6 + 0.5 * ndl;

    // Window grid on vertical faces only (skip roof/floor).
    float facing = abs(dot(faceN, vec3(0.0, 1.0, 0.0)));
    vec3 emissive = vec3(0.0);
    if (facing < 0.5) {
      // Pick facade axis: whichever horizontal axis this face spans.
      vec3 fdx = dFdx(vLocal);
      float useX = step(abs(fdx.x), abs(fdx.z));
      float u = mix(vLocal.x, vLocal.z, useX);
      float v = vLocal.y + uSize.y * 0.5; // 0 at street level

      if (v < GROUND_FLOOR) {
        // Ground floor becomes a storefront later; darker and windowless.
        base *= 0.75;
      } else {
        // Window cells: 1.4m wide, 3m per story, starting above the ground floor.
        float vs = v - GROUND_FLOOR;
        vec2 cell = vec2(floor(u / CELL_W), floor(vs / STORY_HEIGHT));
        vec2 f = vec2(fract(u / CELL_W), fract(vs / STORY_HEIGHT));
        float inWindow = step(0.28, f.x) * step(f.x, 0.72) * step(0.3, f.y) * step(f.y, 0.68);

        float lit = step(1.0 - uLitRatio, hash(cell));
        // A few windows toggle on/off over time (people moving around).
        float toggler = step(0.93, hash(cell + 23.0));
        float phase = hash(cell + 29.0) * 60.0;
        float slowOn = step(-0.2, sin(uTime * 0.11 + phase));
        lit = mix(lit, lit * slowOn, toggler);

        float flicker = 0.8 + 0.2 * hash(cell + 7.0);
        // A subset flickers like TV light.
        float tv = step(0.9, hash(cell + 31.0));
        flicker *= mix(
          1.0,
          0.72 + 0.28 * abs(sin(uTime * 9.0 + phase) * sin(uTime * 5.7 + phase * 2.0)),
          tv
        );

        // Vary per-window warmth and brightness so facades feel inhabited.
        vec3 warm = mix(uWindowColor, vec3(1.0, 0.82, 0.55), hash(cell + 3.0) * 0.7);
        float brightness = 0.5 + 0.9 * hash(cell + 11.0);
        emissive = warm * inWindow * lit * flicker * brightness;

        // Fake room depth: parallax-shift an interior pattern by the view
        // direction so lit windows read as volumes instead of stickers.
        if (inWindow * lit > 0.5) {
          vec3 vd = normalize(vViewDir);
          float du = mix(vd.x, vd.z, useX);          // tangent along the facade
          float dn = mix(vd.z, vd.x, useX);          // into the facade
          vec2 par = vec2(du, vd.y) / max(abs(dn), 0.25) * 0.5; // 0.5m deep room
          vec2 iuv = vec2(
            (f.x - 0.28) / 0.44 + par.x / (CELL_W * 0.44),
            (f.y - 0.3) / 0.38 + par.y / (STORY_HEIGHT * 0.38)
          );
          // Back wall gets brighter toward the ceiling; random dark verticals
          // suggest furniture/curtains.
          float roomGrad = 0.55 + 0.45 * clamp(iuv.y, 0.0, 1.0);
          float band = step(0.6, fract(iuv.x * 1.7 + hash(cell + 19.0) * 3.0)) * 0.4;
          float sideWall = smoothstep(0.0, 0.15, iuv.x) * smoothstep(1.0, 0.85, iuv.x);
          float interior = clamp(roomGrad - band, 0.15, 1.2) * mix(0.55, 1.0, sideWall);
          emissive *= mix(0.6, 1.25, clamp(interior, 0.0, 1.0));
        }

        // Dark glass for unlit windows; slight sky tint so they still read.
        base = mix(base, base * 0.35 + vec3(0.01, 0.015, 0.03), inWindow * (1.0 - lit));
      }
    } else {
      base *= 0.5; // roof
    }

    gl_FragColor = vec4(base + emissive, 1.0);
  }
`;

export interface FacadeParams {
  width: number;
  height: number;
  depth: number;
  style: number;
}

const WINDOW_PALETTES = [
  new THREE.Color("#ffd9a0"), // warm tungsten
  new THREE.Color("#bfe3ff"), // cool fluorescent
  new THREE.Color("#ffe9c9"),
  new THREE.Color("#d8f6ff"),
];

const BASE_PALETTES = [
  new THREE.Color("#2a2d36"),
  new THREE.Color("#33302f"),
  new THREE.Color("#23283a"),
  new THREE.Color("#3a3436"),
  new THREE.Color("#2c3330"),
];

/** Shared time uniform for all facade materials (see tickFacades). */
const facadeTime = { value: 0 };

/** Advance facade shader time; call once per frame from the scene root. */
export function tickFacades(elapsed: number): void {
  facadeTime.value = elapsed;
}

export function makeFacadeMaterial(params: FacadeParams): THREE.ShaderMaterial {
  const rng = mulberry(params.style);
  const windowColor = WINDOW_PALETTES[Math.floor(rng() * WINDOW_PALETTES.length)];
  const baseColor = BASE_PALETTES[Math.floor(rng() * BASE_PALETTES.length)];
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uSize: { value: new THREE.Vector3(params.width, params.height, params.depth) },
      uBaseColor: { value: baseColor },
      uWindowColor: { value: windowColor },
      uSeed: { value: (params.style % 1000) * 0.13 },
      uLitRatio: { value: 0.18 + rng() * 0.25 },
      uTime: facadeTime,
    },
  });
}

export const NEON_COLORS = [
  "#ff2d78",
  "#00e5ff",
  "#b64dff",
  "#ffe14d",
  "#39ff8e",
  "#ff6a00",
];

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
