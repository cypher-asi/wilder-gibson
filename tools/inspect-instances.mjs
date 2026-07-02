// Temporary validation helper: logs in, then dumps per-asset instance stats
// (count, y range, scale range) from the InstancedKit meshes.
import puppeteer from "puppeteer";

const PORT = process.env.PORT ?? "5173";

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--window-size=1600,900", "--use-gl=angle"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}`, { waitUntil: "networkidle2" });
await page.waitForFunction(
  () => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("DEV LOGIN")),
  { timeout: 15000 },
);
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.includes("DEV LOGIN")).click();
});
await page.waitForSelector(".char-card", { timeout: 15000 });
await page.evaluate(() => document.querySelector(".char-card").click());
await page.waitForSelector("canvas", { timeout: 20000 });
await new Promise((r) => setTimeout(r, 12000));

const report = await page.evaluate(() => {
  const hook = window.__wilderGl;
  if (!hook) return "no hook";
  const out = [];
  hook.scene.traverse((o) => {
    if (!o.isInstancedMesh) return;
    const m = new Float64Array(16);
    let minY = Infinity;
    let maxY = -Infinity;
    let minS = Infinity;
    let maxS = -Infinity;
    for (let i = 0; i < o.count; i++) {
      const arr = o.instanceMatrix.array;
      for (let k = 0; k < 16; k++) m[k] = arr[i * 16 + k];
      const y = m[13];
      const sx = Math.hypot(m[0], m[1], m[2]);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minS = Math.min(minS, sx);
      maxS = Math.max(maxS, sx);
    }
    out.push({
      geom: o.geometry.name || o.material?.name || "?",
      count: o.count,
      y: [minY.toFixed(1), maxY.toFixed(1)],
      scale: [minS.toFixed(2), maxS.toFixed(2)],
    });
  });
  return out;
});
console.log(JSON.stringify(report, null, 1));
await browser.close();
