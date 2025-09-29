import { build } from "esbuild";
import { resolve } from "node:path";
const entry = resolve("electron/preload.ts");
const outdir = resolve("dist-electron");

await build({
  entryPoints: [entry],
  outdir,
  bundle: true,
  platform: "node",     // corre en proceso separado, pero es node-like
  target: "node18",
  format: "cjs",
  sourcemap: true,
  minify: false,
  watch: process.argv.includes("--watch"),
});
console.log("[esbuild] preload listo en dist-electron/preload.js");