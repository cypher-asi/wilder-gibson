// Validation helper: walks the dev character to a kit tower / imported
// building near spawn and captures screenshots. Join can be flaky headless,
// so the login flow retries with page reloads.
import puppeteer from "puppeteer";

const PORT = process.env.PORT ?? "5173";
// Kit tower mass spans x 16..56, z 64..80 (front face at z=64). Stand NW of
// it; a yaw-5pi/4 camera looks toward +x/+z and frames the street face.
const TARGET = { x: Number(process.env.TX ?? 30), z: Number(process.env.TZ ?? 50) };
// Optional intermediate waypoints "x,z;x,z" walked before TARGET (to route
// around blocking buildings; the walker is a naive greedy controller).
const WAYPOINTS = (process.env.WAYPOINTS ?? "")
  .split(";")
  .filter(Boolean)
  .map((s) => {
    const [x, z] = s.split(",").map(Number);
    return { x, z };
  });
const PREFIX = process.env.SHOT ?? "tools/screens/imported-building";
// Camera yaw hold (seconds of Z at 1.8 rad/s) before shot 1; 0 keeps the
// default yaw pi/4 (looking toward -x/-z). Extra wheel zoom for shot 1
// (positive deltaY zooms out to frame tall towers).
const ROT = Number(process.env.ROT ?? 1.75);
const ZOOM = Number(process.env.ZOOM ?? 0);

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--window-size=1600,900", "--use-gl=angle"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
page.on("response", (r) => {
  if (r.url().includes("/assets/models/imported/")) console.log("[glb]", r.status(), r.url().split("/").pop());
});

async function enterWorld() {
  await page.goto(`http://localhost:${PORT}`, { waitUntil: "networkidle2" });
  // Auth may persist across reloads; land wherever we are in the flow.
  await page.waitForFunction(
    () =>
      document.querySelector(".hud-pos") ||
      document.querySelector(".char-card") ||
      [...document.querySelectorAll("button")].some((b) => b.textContent.includes("DEV LOGIN")),
    { timeout: 15000 },
  );
  const stage = await page.evaluate(() => {
    if (document.querySelector(".hud-pos")) return "world";
    if (document.querySelector(".char-card")) return "select";
    return "login";
  });
  if (stage === "login") {
    await page.evaluate(() => {
      [...document.querySelectorAll("button")].find((b) => b.textContent.includes("DEV LOGIN")).click();
    });
    await page.waitForSelector(".char-card", { timeout: 15000 });
  }
  if (stage !== "world") {
    await page.evaluate(() => document.querySelector(".char-card").click());
    await page.waitForSelector("canvas", { timeout: 20000 });
    await page.waitForSelector(".hud-pos", { timeout: 20000 });
  }
}

let entered = false;
for (let attempt = 1; attempt <= 4 && !entered; attempt++) {
  try {
    await enterWorld();
    entered = true;
  } catch (err) {
    console.log(`[attempt ${attempt}] join failed: ${String(err.message).split("\n")[0]}`);
  }
}
if (!entered) {
  console.log("FAILED to enter world");
  await browser.close();
  process.exit(1);
}
await new Promise((r) => setTimeout(r, 6000));

async function getPos() {
  return page.evaluate(() => {
    const el = document.querySelector(".hud-pos");
    if (!el) return null;
    const m = el.textContent.match(/(-?[\d.]+),\s*(-?[\d.]+)/);
    return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
  });
}

// WASD is camera-relative; at the default yaw (pi/4): S -> +x+z, D -> +x-z,
// A -> -x+z, W -> -x-z.
function keyFor(dx, dz) {
  if (dx > 1.5 && dz > 1.5) return "s";
  if (dx > 1.5 && dz < -1.5) return "d";
  if (dx < -1.5 && dz > 1.5) return "a";
  if (dx < -1.5 && dz < -1.5) return "w";
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? "s" : "w";
  return dz > 0 ? "s" : "w";
}

await page.keyboard.down("Shift");
for (const [wi, wp] of [...WAYPOINTS, TARGET].entries()) {
  let stuck = 0;
  let last = null;
  for (let i = 0; i < 120; i++) {
    const pos = await getPos();
    if (!pos) break;
    const dx = wp.x - pos.x;
    const dz = wp.z - pos.z;
    if (Math.hypot(dx, dz) < 3) break;
    // Abandon an unreachable waypoint after ~3 s without progress.
    if (last && Math.hypot(pos.x - last.x, pos.z - last.z) < 0.4) {
      if (++stuck > 7) break;
    } else {
      stuck = 0;
    }
    last = pos;
    const key = keyFor(dx, dz);
    await page.keyboard.down(key);
    await new Promise((r) => setTimeout(r, 400));
    await page.keyboard.up(key);
  }
  console.log(`waypoint ${wi} done at`, JSON.stringify(await getPos()));
}
await page.keyboard.up("Shift");
console.log("arrived at", JSON.stringify(await getPos()));

// Rotate the camera to look toward +x/+z: yaw pi/4 -> ~5pi/4 (Z rotates at
// 1.8 rad/s).
if (ROT > 0) {
  await page.keyboard.down("z");
  await new Promise((r) => setTimeout(r, ROT * 1000));
  await page.keyboard.up("z");
}
if (ZOOM !== 0) {
  await page.mouse.move(800, 450);
  await page.mouse.wheel({ deltaY: ZOOM });
}
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${PREFIX}-1.png` });

// Zoom in for a closer look.
await page.mouse.move(800, 450);
await page.mouse.wheel({ deltaY: -900 });
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${PREFIX}-2.png` });

// Second angle: swing another ~quarter turn.
await page.keyboard.down("z");
await new Promise((r) => setTimeout(r, 900));
await page.keyboard.up("z");
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${PREFIX}-3.png` });

console.log("done");
await browser.close();
