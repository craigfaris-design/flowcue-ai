// One-off icon generation script for Play Store / PWA readiness.
// Source is src/brand/icon-only-square.png -- a SQUARE-padded version of the
// ribbon mark, deliberately separate from public/logo.png (which is the
// mark's true wide aspect ratio, ~2.5:1, used directly in the UI so it
// isn't squeezed into an almost-empty square box at small sizes). Icons
// here all need square input, hence the separate source. Favicons/app
// icons/feature graphics also need an OPAQUE background (a transparent
// favicon can vanish against light browser chrome, and Android's home
// screen doesn't composite transparency the way the in-app <img> usage
// does), so every generated file composites onto navy.
// Run with: node scripts/gen-icons.cjs
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const SRC = path.join(__dirname, "..", "src", "brand", "icon-only-square.png");
const OUT = path.join(__dirname, "..", "public", "icons");
const NAVY = { r: 1, g: 1, b: 9, alpha: 1 };

fs.mkdirSync(OUT, { recursive: true });

async function standard(size, name) {
  const content = await sharp(SRC).resize(size, size).png().toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: NAVY },
  })
    .composite([{ input: content, gravity: "center" }])
    .png()
    .toFile(path.join(OUT, name));
}

// Maskable icons need the mark inside the "safe zone" (center ~70% of the
// canvas), since Android/Chrome can crop to a circle, squircle, etc. and
// anything near the edge risks being clipped by the mask shape.
async function maskable(size, name) {
  const contentSize = Math.round(size * 0.7);
  const content = await sharp(SRC).resize(contentSize, contentSize).png().toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: NAVY },
  })
    .composite([{ input: content, gravity: "center" }])
    .png()
    .toFile(path.join(OUT, name));
}

async function main() {
  await standard(192, "icon-192.png");
  await standard(512, "icon-512.png");
  await maskable(192, "icon-maskable-192.png");
  await maskable(512, "icon-maskable-512.png");
  await standard(16, "favicon-16.png");
  await standard(32, "favicon-32.png");
  await standard(180, "apple-touch-icon.png");

  // Play Store feature graphic: 1024x500, mark centered on the navy field.
  const featureMark = await sharp(SRC).resize(420, 420).png().toBuffer();
  await sharp({
    create: { width: 1024, height: 500, channels: 4, background: NAVY },
  })
    .composite([{ input: featureMark, gravity: "center" }])
    .png()
    .toFile(path.join(OUT, "feature-graphic.png"));

  console.log("icons generated");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
