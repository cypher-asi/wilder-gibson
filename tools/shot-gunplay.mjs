// Visual + behavioral verification for the gunplay overhaul: hover reticle,
// shooting while moving in every state, hit VFX, and NPC damage/aggro.
import puppeteer from "puppeteer";

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--window-size=1600,900", "--use-gl=angle"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.goto("http://localhost:5173", { waitUntil: "networkidle2" });

await page.waitForFunction(
  () => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("DEV LOGIN")),
  { timeout: 15000 },
);
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.includes("DEV LOGIN")).click();
});
await page.waitForFunction(
  () => document.querySelector(".char-card") || document.querySelector("input.field"),
  { timeout: 15000 },
);
// Try each character until one joins (others may be held by stale sessions).
await page
  .waitForFunction(() => document.querySelectorAll(".char-card").length > 0, {
    timeout: 10000,
  })
  .catch(() => {});
const cardCount = await page.evaluate(
  () => document.querySelectorAll(".char-card").length,
);
console.log("char cards:", cardCount);
let joined = false;
for (let i = 0; i < cardCount && !joined; i++) {
  await page.evaluate((idx) => {
    document.querySelectorAll(".char-card")[idx].click();
  }, i);
  try {
    await page.waitForFunction(
      () => window.__game && window.__game.localEntityId !== 0,
      { timeout: 10000 },
    );
    joined = true;
  } catch {
    console.log(`card ${i} failed to join; retrying with next`);
    await page.reload({ waitUntil: "networkidle2" });
    // Session may or may not persist across reloads; re-login if needed.
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".char-card").length > 0 ||
        [...document.querySelectorAll("button")].some((b) =>
          b.textContent.includes("DEV LOGIN"),
        ),
      { timeout: 15000 },
    );
    const needLogin = await page.evaluate(
      () => document.querySelectorAll(".char-card").length === 0,
    );
    if (needLogin) {
      await page.evaluate(() => {
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent.includes("DEV LOGIN"))
          .click();
      });
      await page.waitForFunction(
        () => document.querySelectorAll(".char-card").length > 0,
        { timeout: 15000 },
      );
    }
  }
}
if (!joined) {
  console.log("NO CHARACTER COULD JOIN - aborting");
  await browser.close();
  process.exit(1);
}
await new Promise((r) => setTimeout(r, 4000));

async function chat(cmd) {
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.type(cmd);
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 700));
  await page.keyboard.press("Escape");
}
await chat("/give pistol");
await chat("/give ammo 200");

// Equip the pistol via the game state (server validates).
await page.evaluate(() => {
  const ui = window.__ui.getState();
  const slot = ui.inventory?.slots.findIndex((s) => s?.kind === "Pistol");
  if (slot >= 0 && ui.inventory.equipped_weapon !== "Pistol") {
    window.__game.send({ t: "InventoryAction", d: { t: "Equip", d: { slot } } });
  }
});
await new Promise((r) => setTimeout(r, 600));

// Find the nearest NPC; teleport next to it.
async function nearestNpc() {
  return page.evaluate(() => {
    const g = window.__game;
    const me = g.entities.get(g.localEntityId);
    let best = null;
    for (const e of g.entities.values()) {
      if (e.kind !== "Npc" || e.healthPct <= 0) continue;
      const d = Math.hypot(e.x - me.x, e.z - me.z);
      if (!best || d < best.d) best = { id: e.id, x: e.x, z: e.z, d, hp: e.healthPct };
    }
    return best;
  });
}

// Hostile chunks are away from the safe hub; hop outward until an NPC is near.
let npc = null;
for (const [x, z] of [[60, 60], [90, 30], [30, 90], [120, 60], [60, 120]]) {
  await chat(`/tp ${x} ${z}`);
  await new Promise((r) => setTimeout(r, 1500));
  npc = await nearestNpc();
  if (npc && npc.d < 30) break;
}
console.log("npc:", JSON.stringify(npc));
if (!npc) {
  console.log("NO NPC FOUND - aborting");
  await browser.close();
  process.exit(1);
}
// Step right up to it so it's on screen for the hover sweep.
await chat(`/tp ${(npc.x - 5).toFixed(1)} ${npc.z.toFixed(1)}`);
await new Promise((r) => setTimeout(r, 1200));

// Zoom in for readable screenshots.
await page.mouse.move(800, 450);
for (let i = 0; i < 16; i++) {
  await page.mouse.wheel({ deltaY: -120 });
  await new Promise((r) => setTimeout(r, 80));
}
await new Promise((r) => setTimeout(r, 1000));

// Sweep the mouse across the view until an enemy hover registers.
async function hoverNpc(id) {
  const found = await page.evaluate(() => window.__game.hoverTargetId);
  if (found != null) return true;
  for (let ry = 200; ry <= 700; ry += 50) {
    for (let rx = 300; rx <= 1300; rx += 50) {
      await page.mouse.move(rx, ry);
      await new Promise((r) => setTimeout(r, 16));
      const hit = await page.evaluate(() => window.__game.hoverTargetId);
      if (hit != null) {
        console.log(`hovered entity ${hit} at (${rx},${ry})`);
        return { rx, ry };
      }
    }
  }
  return null;
}

const hoverAt = await hoverNpc(npc.id);
console.log("hover:", JSON.stringify(hoverAt));
if (hoverAt) {
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: "tools/screens/gun_reticle.png" });
  console.log("saved gun_reticle");
}

async function entityHp(id) {
  return page.evaluate(
    (eid) => window.__game.entities.get(eid)?.healthPct ?? null,
    id,
  );
}
const targetId = await page.evaluate(() => window.__game.hoverTargetId);
const hpBefore = await entityHp(targetId);

// Fire while standing (draw first); heal so NPC punches don't end the test.
await page.mouse.down();
await new Promise((r) => setTimeout(r, 400)); // draw
await page.screenshot({ path: "tools/screens/gun_fire_standing.png" });
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: "tools/screens/gun_fire_standing2.png" });
await new Promise((r) => setTimeout(r, 300));
const hpMid = await entityHp(targetId);
await page.mouse.up();
await chat("/heal");

// Fire while running backwards (S + shift) — anim should stay locomotion.
await page.mouse.move(hoverAt ? hoverAt.rx : 800, hoverAt ? hoverAt.ry : 450);
await page.mouse.down();
await page.keyboard.down("KeyS");
await page.keyboard.down("ShiftLeft");
await new Promise((r) => setTimeout(r, 350));
const movingState = await page.evaluate(() => {
  const g = window.__game;
  const me = g.entities.get(g.localEntityId);
  return {
    anim: me?.anim ?? null,
    shotSeq: g.gun.shotSeq,
    health: window.__ui.getState().health,
  };
});
console.log("firing-while-running state:", JSON.stringify(movingState));
await page.screenshot({ path: "tools/screens/gun_fire_backpedal.png" });
await new Promise((r) => setTimeout(r, 600));
await page.keyboard.up("ShiftLeft");
await page.keyboard.up("KeyS");
await page.mouse.up();
await new Promise((r) => setTimeout(r, 500));

const hpAfter = await entityHp(targetId);
console.log(
  "target hp before/mid/after:",
  JSON.stringify({ targetId, hpBefore, hpMid, hpAfter }),
);

const summary = await page.evaluate(() => {
  const g = window.__game;
  return {
    shotSeq: g.gun.shotSeq,
    hover: g.hoverTargetId,
    mounts: g.gunMounts.size,
    health: window.__ui.getState().health,
  };
});
console.log("summary:", JSON.stringify(summary));

await browser.close();
