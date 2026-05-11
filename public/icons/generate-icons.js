/**
 * Generates PNG app icons for Health Centre PWA.
 * Run: node public/icons/generate-icons.js
 */
const sharp = require('sharp')
const path = require('path')

function makeSvg(size) {
  const cx = size / 2
  const cy = size / 2
  const pad = size * 0.13
  const r1 = (size / 2) - pad
  const r2 = r1 - size * 0.115
  const r3 = r2 - size * 0.115
  const sw = size * 0.075
  const cornerR = Math.round(size * 0.22)

  function arc(r, startDeg, endDeg) {
    const start = (startDeg - 90) * Math.PI / 180
    const end = (endDeg - 90) * Math.PI / 180
    const x1 = cx + r * Math.cos(start)
    const y1 = cy + r * Math.sin(start)
    const x2 = cx + r * Math.cos(end)
    const y2 = cy + r * Math.sin(end)
    const large = (endDeg - startDeg) > 180 ? 1 : 0
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#111118"/>
      <stop offset="100%" stop-color="#0a0a0f"/>
    </linearGradient>
    <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
    <linearGradient id="g2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#34d399"/>
      <stop offset="100%" stop-color="#22c55e"/>
    </linearGradient>
    <linearGradient id="g3" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fbbf24"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${cornerR}" fill="url(#bg)"/>
  <rect x="1" y="1" width="${size-2}" height="${size-2}" rx="${cornerR - 1}"
    fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1.5"/>
  <circle cx="${cx}" cy="${cy}" r="${r1}" fill="none"
    stroke="rgba(255,255,255,0.08)" stroke-width="${sw}" stroke-linecap="round"/>
  <circle cx="${cx}" cy="${cy}" r="${r2}" fill="none"
    stroke="rgba(255,255,255,0.08)" stroke-width="${sw}" stroke-linecap="round"/>
  <circle cx="${cx}" cy="${cy}" r="${r3}" fill="none"
    stroke="rgba(255,255,255,0.08)" stroke-width="${sw}" stroke-linecap="round"/>
  <path d="${arc(r1, 0, 281)}" fill="none"
    stroke="url(#g1)" stroke-width="${sw}" stroke-linecap="round"/>
  <path d="${arc(r2, 0, 234)}" fill="none"
    stroke="url(#g2)" stroke-width="${sw}" stroke-linecap="round"/>
  <path d="${arc(r3, 0, 151)}" fill="none"
    stroke="url(#g3)" stroke-width="${sw}" stroke-linecap="round"/>
</svg>`
}

async function generateAll() {
  const sizes = [
    { name: 'apple-touch-icon-180.png', size: 180 },
    { name: 'apple-touch-icon-152.png', size: 152 },
    { name: 'apple-touch-icon-120.png', size: 120 },
    { name: 'icon-192.png', size: 192 },
    { name: 'icon-512.png', size: 512 },
  ]

  for (const { name, size } of sizes) {
    const svg = Buffer.from(makeSvg(size))
    const outPath = path.join(__dirname, name)
    await sharp(svg).png().toFile(outPath)
    console.log(`✓ ${name} (${size}x${size})`)
  }
  console.log('\nAll icons generated.')
}

generateAll().catch(console.error)
