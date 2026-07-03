// Screenshot the holographic city map (M): 3D view, zoomed out, and top-down.
// Usage: node tools/shot-holomap.mjs [outPrefix]
import puppeteer from "puppeteer";

const outPrefix = process.argv[2] ?? "holomap";

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--window-size=1600,900", "--use-gl=angle"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") {
    console.log(`[console.${msg.type()}]`, msg.text());
  }
});
page.on("pageerror", (err) => console.log("[pageerror]", err.message));
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
await page.click(".char-card");
await page.waitForSelector("canvas", { timeout: 20000 });
await new Promise((r) => setTimeout(r, 6000));

// Open the map.
await page.keyboard.press("KeyM");
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: `tools/screens/${outPrefix}-3d.png` });
console.log(`saved tools/screens/${outPrefix}-3d.png`);

// Zoom out to city scale.
await page.mouse.move(800, 450);
for (let i = 0; i < 14; i++) {
  await page.mouse.wheel({ deltaY: 400 });
  await new Promise((r) => setTimeout(r, 80));
}
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `tools/screens/${outPrefix}-city.png` });
console.log(`saved tools/screens/${outPrefix}-city.png`);

// Top-down view.
await page.keyboard.press("KeyT");
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `tools/screens/${outPrefix}-top.png` });
console.log(`saved tools/screens/${outPrefix}-top.png`);

// Close the map and confirm the game resumes.
await page.keyboard.press("KeyM");
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `tools/screens/${outPrefix}-closed.png` });
console.log(`saved tools/screens/${outPrefix}-closed.png`);

await browser.close();
