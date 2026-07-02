// Temporary validation helper: captures the new WoW-style HUD panels.
import puppeteer from "puppeteer";

const PORT = process.env.PORT ?? "5173";

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--window-size=1600,900", "--use-gl=angle"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 500)));
page.on("console", (m) => {
  if (m.type() === "error") console.log("[error]", m.text().slice(0, 300));
});

await page.goto(`http://localhost:${PORT}`, { waitUntil: "networkidle2" });
await page.waitForFunction(
  () => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("DEV LOGIN")),
  { timeout: 15000 },
);
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.includes("DEV LOGIN")).click();
});
await page.waitForSelector(".char-card", { timeout: 15000 });
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".char-card")].filter((c) =>
    c.textContent.includes("Shot"),
  );
  (cards[cards.length - 1] ?? document.querySelector(".char-card")).click();
});
await page.waitForSelector("canvas", { timeout: 20000 });
await new Promise((r) => setTimeout(r, 9000));

// 1. Base HUD at spawn.
await page.screenshot({ path: "tools/screens/hud-1-base.png" });

// 2. Give + equip plate armor via dev chat commands, then check the shield bar.
async function chat(text) {
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 300));
  await page.type(".chat-input", text);
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 500));
}
await chat("/give plate");
// Equip via the full inventory panel: double-click the plate slot.
await page.keyboard.press("KeyI");
await new Promise((r) => setTimeout(r, 500));
async function clickPlate() {
  return page.evaluate(() => {
    const slots = [...document.querySelectorAll(".inventory .inv-slot")];
    const plate = slots.find((s) => s.title.includes("PlateArmor"));
    if (!plate) return false;
    plate.click();
    return true;
  });
}
const found = await clickPlate();
await new Promise((r) => setTimeout(r, 400));
await clickPlate();
console.log("plate equipped:", found);
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: "tools/screens/hud-2-inventory-shield.png" });
await page.keyboard.press("KeyI");
await new Promise((r) => setTimeout(r, 400));

// 3. Fire abilities to see cooldown sweeps + buff chips.
await page.keyboard.press("KeyQ");
await new Promise((r) => setTimeout(r, 250));
await page.keyboard.press("KeyE");
await new Promise((r) => setTimeout(r, 250));
await page.keyboard.press("KeyR");
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: "tools/screens/hud-3-cooldowns.png" });

// 4. Status tab with active buffs.
await page.evaluate(() => {
  const tabs = [...document.querySelectorAll(".chatwin-tab")];
  tabs.find((t) => t.textContent === "STATUS")?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: "tools/screens/hud-4-status-tab.png" });

// 5. Combat tab.
await page.evaluate(() => {
  const tabs = [...document.querySelectorAll(".chatwin-tab")];
  tabs.find((t) => t.textContent === "COMBAT")?.click();
});
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: "tools/screens/hud-5-combat-tab.png" });

const ui = await page.evaluate(() => {
  const s = window.__ui?.getState?.();
  return s
    ? {
        shield: s.shield,
        maxShield: s.maxShield,
        abilities: Object.fromEntries(
          Object.entries(s.abilities).map(([k, v]) => [
            k,
            { cd: v.cooldown, ready: v.readyAt > performance.now() ? "cooling" : "ready" },
          ]),
        ),
      }
    : null;
});
console.log("ui state:", JSON.stringify(ui));
console.log("done");
await browser.close();
