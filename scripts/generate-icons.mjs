/**
 * Generates build icons (ICO, ICNS, PNGs) from the source app icon.
 * Usage: node scripts/generate-icons.mjs
 */
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SOURCE = join(ROOT, 'public', 'recordsaas-appicon.png')
const BUILD = join(ROOT, 'build')
const ICONS = join(BUILD, 'icons')

mkdirSync(ICONS, { recursive: true })

// --- Generate PNGs for electron-builder ---
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024]
console.log('Generating PNGs...')
for (const size of sizes) {
  await sharp(SOURCE)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(join(ICONS, `${size}x${size}.png`))
  console.log(`  ✓ ${size}x${size}.png`)
}

// --- Generate ICO (Windows) ---
console.log('Generating ICO...')
const icoSizes = [16, 32, 48, 64, 128, 256]
const icoPngs = []
for (const size of icoSizes) {
  const buf = await sharp(SOURCE)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  icoPngs.push(buf)
}
const icoBuffer = await pngToIco(icoPngs)
writeFileSync(join(BUILD, 'icon.ico'), icoBuffer)
console.log('  ✓ icon.ico')

// --- Generate ICNS (macOS) ---
// ICNS format: magic + TOC + icon entries
// We use the standard icon types expected by macOS
console.log('Generating ICNS...')

const icnsTypes = [
  { osType: 'ic07', size: 128 },   // 128x128
  { osType: 'ic08', size: 256 },   // 256x256
  { osType: 'ic09', size: 512 },   // 512x512
  { osType: 'ic10', size: 1024 },  // 1024x1024 (512x512@2x)
  { osType: 'ic11', size: 32 },    // 16x16@2x
  { osType: 'ic12', size: 64 },    // 32x32@2x
  { osType: 'ic13', size: 256 },   // 128x128@2x
  { osType: 'ic14', size: 512 },   // 256x256@2x
]

const iconEntries = []
for (const { osType, size } of icnsTypes) {
  const pngData = await sharp(SOURCE)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()

  // Each entry: 4 bytes type + 4 bytes length (including header) + data
  const entryLength = 8 + pngData.length
  const header = Buffer.alloc(8)
  header.write(osType, 0, 4, 'ascii')
  header.writeUInt32BE(entryLength, 4)
  iconEntries.push(Buffer.concat([header, pngData]))
}

const allEntries = Buffer.concat(iconEntries)
const icnsHeader = Buffer.alloc(8)
icnsHeader.write('icns', 0, 4, 'ascii')
icnsHeader.writeUInt32BE(8 + allEntries.length, 4)
const icnsBuffer = Buffer.concat([icnsHeader, allEntries])
writeFileSync(join(BUILD, 'icon.icns'), icnsBuffer)
console.log('  ✓ icon.icns')

console.log('\nDone! All icons generated.')
