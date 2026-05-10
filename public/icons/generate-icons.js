/**
 * Run with Node.js to generate placeholder HC icons.
 * In production, replace these with proper designed assets.
 * Usage: node generate-icons.js
 */
const fs = require('fs')
const path = require('path')

function svgIcon(size) {
  const fontSize = Math.round(size * 0.32)
  const r = Math.round(size * 0.18)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="#0a0a0a"/>
  <rect x="2" y="2" width="${size-4}" height="${size-4}" rx="${r-2}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
    font-family="system-ui,-apple-system,sans-serif" font-weight="700"
    font-size="${fontSize}" letter-spacing="-1" fill="white">HC</text>
</svg>`
}

const sizes = [120, 152, 180, 192, 512]
const dir = path.dirname(__filename)

for (const size of sizes) {
  const svg = svgIcon(size)
  const name = size >= 180 ? `apple-touch-icon-${size}.png` : `icon-${size}.png`
  // Write SVG as placeholder (rename to .svg if needed)
  fs.writeFileSync(path.join(dir, name.replace('.png', '.svg')), svg)
  console.log(`Written ${name.replace('.png', '.svg')}`)
}
console.log('Done. Convert SVGs to PNG for production use.')
