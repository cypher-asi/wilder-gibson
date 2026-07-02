// Visual verification for the Ascent-style pass: camera framing, aim ring,
// firing tracers, enemy health bars, and the bottom-right weapon HUD.
// Usage: node tools/screenshot-ascent.mjs [outPrefix]
// Requires the gateway (WILDER_DEV=1, :8080) and Vite (:5173) running.

import puppeteer from "puppeteer";

const outPrefix = process.argv[2] ?? "ascent";

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--window-size=1600,900", "--use-gl=angle"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log("[page error]", m.text());
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await page.screenshot({ path: `tools/screens/${outPrefix}-${name}.png` });
  console.log(`saved tools/screens/${outPrefix}-${name}.png`);
};

await page.goto("http://localhost:5173", { waitUntil: "networkidle2" });

// Dev login.
await page.waitForFunction(
  () => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("DEV LOGIN")),
  { timeout: 15000 },
);
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.includes("DEV LOGIN")).click();
});

// Character select: pick the first character, or create one.
await page.waitForFunction(
  () => document.querySelector(".char-card") || document.querySelector("input.field"),
  { timeout: 15000 },
);
const hasChar = await page.evaluate(() => !!document.querySelector(".char-card"));
if (!hasChar) {
  await page.type("input.field", "AscentShot");
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.includes("CREATE RUNNER"))
      .click();
  });
  await page.waitForSelector(".char-card", { timeout: 15000 });
}
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".char-card")];
  (cards.find((c) => c.textContent.includes("Dev")) ?? cards[0]).click();
});

await page.waitForSelector("canvas", { timeout: 20000 });
await sleep(7000);

const send = (msg) =>
  page.evaluate((m) => window.__game.send(m), msg);
const chat = (text) => send({ t: "Chat", d: { text } });

// Ensure a pistol + ammo are equipped (existing characters predate the
// starter loadout change).
await chat("/give pistol");
await chat("/give ammo 90");
await sleep(500);
await page.evaluate(() => {
  const inv = window.__ui.getState().inventory;
  if (inv?.equipped_weapon !== "Pistol") {
    const slot = inv?.slots.findIndex((s) => s && s.kind === "Pistol") ?? -1;
    if (slot >= 0) {
      window.__game.send({ t: "InventoryAction", d: { t: "Equip", d: { slot } } });
    }
  }
});
await sleep(500);

// 1. Default framing in the hub, mouse aiming down-right.
await page.mouse.move(1100, 650);
await sleep(700);
await shot("1-default");

// 2. Aim ring pointing the other way.
await page.mouse.move(420, 260);
await sleep(700);
await shot("2-aim");

// 3. Teleport into a hostile district and wait for NPC streaming.
await chat("/tp 105 105");
await sleep(4000);
console.log(
  "post-tp:",
  await page.evaluate(() => {
    const g = window.__game;
    return JSON.stringify({
      name: window.__ui.getState().characterName,
      pos: g.predicted,
      npcs: [...g.entities.values()].filter((e) => e.kind === "Npc").length,
    });
  }),
);

// Pick an NPC with open ground toward the camera (the camera sits at +x/+z
// with the default yaw) so the fight isn't hidden behind a building, then
// teleport next to it. Server-broadcast MuzzleFlash/Hit events drive the
// tracers, sparks, damage numbers, and health bars.
const npc = await page.evaluate(() => {
  const g = window.__game;
  const candidates = [...g.entities.values()].filter((e) => e.kind === "Npc");
  for (const e of candidates) {
    let clear = true;
    for (let k = 1; k <= 16; k += 1) {
      if (!g.chunks.walkable(e.x + k, e.z + k)) {
        clear = false;
        break;
      }
    }
    if (clear) return { x: e.x, z: e.z, clear: true };
  }
  const any = candidates[0];
  return any ? { x: any.x, z: any.z, clear: false } : null;
});
console.log("chosen npc:", npc);
if (npc) {
  await chat(`/tp ${(npc.x + 4.5).toFixed(1)} ${(npc.z + 4.5).toFixed(1)}`);
  await sleep(2500);
  // Zoom in a little so the fight reads clearly.
  await page.mouse.move(800, 450);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel({ deltaY: -120 });
    await sleep(100);
  }
  await sleep(800);
}

const attackNearest = () =>
  page.evaluate(() => {
    const g = window.__game;
    let best = null;
    const me = g.entities.get(g.localEntityId);
    for (const e of g.entities.values()) {
      if (e.kind !== "Npc" || e.anim === "Death") continue;
      const d = Math.hypot(e.x - (me?.x ?? 0), e.z - (me?.z ?? 0));
      if ((!best || d < best.d) && d < 20) best = { e, d };
    }
    if (best) {
      g.send({ t: "Attack", d: { seq: g.nextSeq++, tx: best.e.x, tz: best.e.z } });
      return true;
    }
    return false;
  });

if (npc) {
  await chat("/heal");
  await attackNearest();
  // Server tick + broadcast round-trip before the tracer spawns (~100ms),
  // tracer lives 170ms.
  await sleep(110);
  await shot("3-firing");
  await sleep(600);
  await shot("4-healthbar");

  // Keep firing until something dies (XP + death pulse); stay healed so the
  // charging NPC doesn't kill the cameraman.
  for (let i = 0; i < 20; i++) {
    await chat("/heal");
    if (!(await attackNearest())) break;
    await sleep(650);
  }
  await sleep(500);
  await shot("5-after-kill");
}

const hudState = await page.evaluate(() => {
  const s = window.__ui.getState();
  return {
    weapon: s.inventory?.equipped_weapon,
    level: s.level,
    xp: s.xp,
    nextLevelXp: s.nextLevelXp,
  };
});
console.log("hud state:", hudState);

await browser.close();
