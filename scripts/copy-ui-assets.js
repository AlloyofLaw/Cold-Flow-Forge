#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Copies static renderer assets (HTML/CSS) from ui/ into dist/ui/ after the
// TypeScript build. tsc only emits compiled .ts -> .js; these plain assets
// need to land next to renderer.js for Electron's loadFile() to find them.
// ---------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "ui");
const outDir = path.join(root, "dist", "ui");

const assets = ["index.html", "styles.css"];

fs.mkdirSync(outDir, { recursive: true });

for (const asset of assets) {
  const src = path.join(srcDir, asset);
  const dest = path.join(outDir, asset);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`copied ${path.relative(root, src)} -> ${path.relative(root, dest)}`);
  }
}
