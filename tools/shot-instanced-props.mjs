// Temporary validation helper: logs in on the dev client, waits for chunks +
// instanced kit props to load, and captures screenshots from a few angles.
import puppeteer from "puppeteer";

const PORT = process.env.PORT ?? "5173";

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--window-size=1600,900", "--use-gl=angle"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || m.type() === "warning") console.log(`[${m.type()}]`, t.slice(0, 300));
});
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 500)));
page.on("response", (r) => {
  const url = r.url();
  if (r.status() >= 400) console.log("[http", r.status() + "]", url);
  if (url.includes("/assets/models/imported/")) console.log("[kit glb]", r.status(), url.split("/").pop());
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
  document.querySelector(".char-card").click();
});
await page.waitForSelector("canvas", { timeout: 20000 });
// Let chunks stream + GLBs load.
await new Promise((r) => setTimeout(r, 12000));

async function stats(label) {
  const info = await page.evaluate(() => {
    const hook = window.__wilderGl;
    if (!hook) return null;
    let instanced = 0;
    let meshes = 0;
    hook.scene.traverse((o) => {
      if (o.isInstancedMesh) instanced++;
      else if (o.isMesh) meshes++;
    });
    return { calls: hook.gl.info.render.calls, triangles: hook.gl.info.render.triangles, instanced, meshes };
  });
  console.log(label, JSON.stringify(info));
}

await stats("spawn:");
await page.screenshot({ path: "tools/screens/instanced-props-1.png" });
// Walk forward for a second vantage point.
await page.keyboard.down("w");
await new Promise((r) => setTimeout(r, 3500));
await page.keyboard.up("w");
await new Promise((r) => setTimeout(r, 1500));
await stats("walked:");
await page.screenshot({ path: "tools/screens/instanced-props-2.png" });
// Walk along streets past several building fronts for facade vantage points.
const legs = [
  ["a", 5000, "tools/screens/instanced-props-3.png"],
  ["s", 5000, "tools/screens/instanced-props-4.png"],
  ["a", 5000, "tools/screens/instanced-props-5.png"],
];
for (const [key, ms, out] of legs) {
  await page.keyboard.down(key);
  await new Promise((r) => setTimeout(r, ms));
  await page.keyboard.up(key);
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: out });
}
await stats("end:");
console.log("done");
await browser.close();
