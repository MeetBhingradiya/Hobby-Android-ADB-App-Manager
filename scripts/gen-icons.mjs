#!/usr/bin/env node
// scripts/gen-icons.mjs
// Generates icon.png (512px), icon.ico (Windows), icon.icns (macOS)
// from assets/icon.svg using sharp + png2icons

import { createRequire } from 'module'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// Dynamic imports for build-only deps
const sharp = (await import('sharp')).default
const png2icons = require('png2icons')

const svgPath = resolve(root, 'assets/icon.svg')
const svg = readFileSync(svgPath)

console.log('Generating icons from assets/icon.svg …')

// Render PNG at 1024px for maximum quality source
const png1024 = await sharp(svg)
  .resize(1024, 1024)
  .png({ compressionLevel: 9 })
  .toBuffer()

// 512px PNG — used by Linux + electron-builder
const png512 = await sharp(svg)
  .resize(512, 512)
  .png()
  .toBuffer()

writeFileSync(resolve(root, 'assets/icon.png'), png512)
console.log('✓ assets/icon.png  (512×512)')

// Windows ICO — multiple embedded sizes: 16, 32, 48, 64, 128, 256
const ico = png2icons.createICO(png1024, png2icons.BILINEAR, 0, true, true)
if (ico) {
  writeFileSync(resolve(root, 'assets/icon.ico'), ico)
  console.log('✓ assets/icon.ico  (multi-size)')
} else {
  console.warn('⚠ ICO generation failed — png2icons returned null')
}

// macOS ICNS
const icns = png2icons.createICNS(png1024, png2icons.BILINEAR, 0)
if (icns) {
  writeFileSync(resolve(root, 'assets/icon.icns'), icns)
  console.log('✓ assets/icon.icns')
} else {
  console.warn('⚠ ICNS generation failed — png2icons returned null')
}

console.log('\nDone! Icons saved to assets/')
