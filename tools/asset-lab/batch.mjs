// Batch pipeline: import -> optimize -> promote a list of assets end to end,
// without clicking each one through the Asset Lab UI.
//
//   npm run lab:batch -- <assetId> [<assetId> ...] [--category prop] [--reoptimize]
//
// Completed stages are skipped: assets with a passing variant are not
// re-optimized unless --reoptimize is given, and promotion is idempotent
// (it overwrites the copied GLB and manifest entry in place).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importAsset } from "./import.mjs";
import { optimizeAsset } from "./optimize.mjs";
import { promoteAsset } from "./promote.mjs";
import { loadRegistry } from "./registry.mjs";

export async function batchAsset(assetId, { category, reoptimize = false } = {}) {
  let asset = loadRegistry().assets[assetId];
  if (!asset) throw new Error(`Unknown asset: ${assetId}`);
  const stages = [];

  if (!asset.meta || asset.status === "raw") {
    await importAsset(assetId, { log: () => {} });
    stages.push("import");
    asset = loadRegistry().assets[assetId];
  }

  const hasPassing = (asset.variants ?? []).some((v) => v.passed);
  if (!hasPassing || reoptimize) {
    await optimizeAsset(assetId, category ? { category } : {}, { log: () => {} });
    stages.push("optimize");
  }

  const promoted = promoteAsset(assetId);
  stages.push("promote");
  return { assetId, stages, manifestId: promoted.manifestId, variant: promoted.promotedVariant };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const ids = args.filter((a) => !a.startsWith("--"));
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const category = flag("--category");
  const reoptimize = args.includes("--reoptimize");
  if (ids.length === 0) {
    console.error("Usage: node batch.mjs <assetId>... [--category cat] [--reoptimize]");
    process.exit(1);
  }

  const results = [];
  for (const [i, id] of ids.entries()) {
    const t0 = Date.now();
    process.stdout.write(`[${i + 1}/${ids.length}] ${id} ... `);
    try {
      const r = await batchAsset(id, { category, reoptimize });
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`ok (${r.stages.join("+") || "up to date"}, ${r.variant}, ${secs}s)`);
      results.push(r);
    } catch (err) {
      console.log(`FAILED: ${String(err.message ?? err).split("\n")[0]}`);
      results.push({ assetId: id, error: String(err.message ?? err) });
    }
  }

  const failed = results.filter((r) => r.error);
  console.log(`\nDone: ${results.length - failed.length}/${ids.length} promoted.`);
  if (failed.length > 0) {
    console.log("Failed:");
    for (const f of failed) console.log(`  ${f.assetId}: ${f.error.split("\n")[0]}`);
    process.exit(1);
  }
}
