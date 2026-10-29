/**
 * Regenerate every brand asset from the master artwork in `resources/brand/`.
 *
 *     node scripts/brand-assets.mjs
 *
 * This exists because the app ships four different renderings of one mark —
 * a 1024px PNG for the window, tray and notification icons, a multi-size .ico
 * for the packaged executable, and a transparent wordmark for the sidebar —
 * and doing that by hand means whichever one you forgot is the one that ships
 * stale.
 *
 * It is written against `node:zlib` alone rather than an image library on
 * purpose: the build host has no ImageMagick, and pulling a native imaging
 * dependency into the tree just to resize two PNGs at commit time is not a
 * trade worth making.
 */
import { deflateSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const brand = join(root, 'resources', 'brand')

/** Sizes packed into resources/icon.ico. Windows picks the closest match. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const APP_ICON_SIZE = 1024

/**
 * The orbit glyph in `moon-mark-square.png`, in that file's own 1600px
 * coordinates, and the largest .ico size that still loses the wordmark's
 * letterforms. Above this the full lockup is drawn; at or below it, the glyph.
 */
const GLYPH_CX = 1268
const GLYPH_CY = 690
const GLYPH_SPAN = 190
const GLYPH_MAX_SIZE = 32

/** Sizes at or above this are PNG-compressed inside the .ico; below, BMP. */
const PNG_MIN_SIZE = 128

/**
 * The wordmark art is white on a solid near-black field with no alpha channel.
 * Anything below this luminance is treated as background rather than ink, which
 * keeps compression noise in the black from turning into a visible haze once the
 * mark is used as a mask over a themed surface.
 */
const BLACK_POINT = 10

// ---------------------------------------------------------------- PNG decode

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const body = Buffer.alloc(8 + data.length + 4)
  body.writeUInt32BE(data.length, 0)
  body.write(type, 4, 'ascii')
  data.copy(body, 8)
  body.writeUInt32BE(crc32(body.subarray(4, 8 + data.length)), 8 + data.length)
  return body
}

/**
 * Decode an 8-bit, non-interlaced RGB or RGBA PNG into RGBA bytes.
 *
 * Deliberately narrow. The inputs are the two master files in resources/brand/
 * and whatever this project adds later; a palette, 16-bit or interlaced PNG is
 * a mistake worth failing on loudly instead of silently mis-rendering.
 */
function decodePNG(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG file')

  let width = 0
  let height = 0
  let colorType = 0
  let bitDepth = 0
  let interlace = 0
  const idat = []

  for (let offset = 8; offset + 8 <= buffer.length; ) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }

  if (bitDepth !== 8) throw new Error(`only 8-bit PNGs are supported, got ${bitDepth}-bit`)
  if (interlace !== 0) throw new Error('interlaced PNGs are not supported')
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0
  if (!channels) throw new Error(`only colour type 2 or 6 is supported, got ${colorType}`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(width * height * 4)

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = y * (stride + 1) + 1
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? decodePNGRowValue(out, y, x - channels, width, channels) : 0
      const up = y > 0 ? decodePNGRowValue(out, y - 1, x, width, channels) : 0
      const upLeft =
        x >= channels && y > 0
          ? decodePNGRowValue(out, y - 1, x - channels, width, channels)
          : 0
      const current = raw[line + x]
      let value
      if (filter === 0) value = current
      else if (filter === 1) value = current + left
      else if (filter === 2) value = current + up
      else if (filter === 3) value = current + ((left + up) >> 1)
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        value = current + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)
      } else throw new Error(`unknown PNG filter ${filter} on row ${y}`)
      const pixel = Math.floor(x / channels)
      out[(y * width + pixel) * 4 + (x % channels)] = value & 0xff
    }
  }

  // Colour type 2 leaves every alpha slot at zero; an opaque image is the only
  // sensible reading of an RGB master.
  if (channels === 3) {
    for (let i = 0; i < width * height; i++) out[i * 4 + 3] = 255
  }
  return { width, height, data: out }
}

/**
 * Read one already-decoded byte back out of the RGBA scratch buffer.
 *
 * The unfilter pass writes RGBA while PNG filters operate on the source
 * channel layout, so the source byte at `x` has to be found by walking back
 * from the pixel it belongs to.
 */
function decodePNGRowValue(out, y, x, width, channels) {
  const pixel = Math.floor(x / channels)
  const channel = x % channels
  return out[(y * width + pixel) * 4 + channel]
}

// -------------------------------------------------------------------- resize

/**
 * Separable box (area-average) resample, preceded by halving steps.
 *
 * The halving matters: a single box pass from 1600px to 16px keeps one source
 * pixel out of every hundred, which throws away the ring around the planet and
 * turns the wordmark into mush. Halving first means every final pass averages
 * at most about two pixels per axis.
 */
function resize(image, targetWidth, targetHeight) {
  let { width, height, data } = image
  while (width / 2 >= targetWidth && height / 2 >= targetHeight) {
    const result = box(data, width, height, Math.max(1, width >> 1), Math.max(1, height >> 1))
    width = result.width
    height = result.height
    data = result.data
  }
  const final = box(data, width, height, targetWidth, targetHeight)
  return final
}

function box(src, sw, sh, dw, dh) {
  const horizontal = new Float64Array(dw * sh * 4)
  const xRatio = sw / dw
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      const start = x * xRatio
      const end = Math.min(sw, start + xRatio)
      const first = Math.floor(start)
      const last = Math.min(sw - 1, Math.ceil(end) - 1)
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let weight = 0
      for (let i = first; i <= last; i++) {
        const w = Math.min(end, i + 1) - Math.max(start, i)
        const o = (y * sw + i) * 4
        r += src[o] * w
        g += src[o + 1] * w
        b += src[o + 2] * w
        a += src[o + 3] * w
        weight += w
      }
      const t = (y * dw + x) * 4
      horizontal[t] = r / weight
      horizontal[t + 1] = g / weight
      horizontal[t + 2] = b / weight
      horizontal[t + 3] = a / weight
    }
  }

  const out = Buffer.alloc(dw * dh * 4)
  const yRatio = sh / dh
  for (let y = 0; y < dh; y++) {
    const start = y * yRatio
    const end = Math.min(sh, start + yRatio)
    const first = Math.floor(start)
    const last = Math.min(sh - 1, Math.ceil(end) - 1)
    for (let x = 0; x < dw; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let weight = 0
      for (let j = first; j <= last; j++) {
        const w = Math.min(end, j + 1) - Math.max(start, j)
        const o = (j * dw + x) * 4
        r += horizontal[o] * w
        g += horizontal[o + 1] * w
        b += horizontal[o + 2] * w
        a += horizontal[o + 3] * w
        weight += w
      }
      const t = (y * dw + x) * 4
      out[t] = Math.round(r / weight)
      out[t + 1] = Math.round(g / weight)
      out[t + 2] = Math.round(b / weight)
      out[t + 3] = Math.round(a / weight)
    }
  }
  return { width: dw, height: dh, data: out }
}

// ----------------------------------------------------------------- PNG write

function encodePNG({ width, height, data }) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    data.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ----------------------------------------------------------------- ICO write

/**
 * A single .ico entry in the classic BMP form: a BITMAPINFOHEADER whose height
 * is doubled for the AND mask, bottom-up BGRA pixels, then the 1bpp mask.
 *
 * PNG-compressed entries are legal from Vista onwards, but Explorer's icon
 * extraction path has never been reliable about them for executables and
 * shortcuts, and a shell that cannot read the entry falls back to a generic
 * page. The small sizes — the ones that actually live in a taskbar — are
 * therefore written as BMP, and only the 256px entry uses PNG, where the
 * compression is worth it and the reader is modern.
 */
function encodeBMPImage(image) {
  const { width, height, data } = image
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(width, 4)
  header.writeInt32LE(height * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(0, 16)

  const pixels = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sourceRow = height - 1 - y
    for (let x = 0; x < width; x++) {
      const s = (sourceRow * width + x) * 4
      const d = (y * width + x) * 4
      pixels[d] = data[s + 2]
      pixels[d + 1] = data[s + 1]
      pixels[d + 2] = data[s]
      pixels[d + 3] = data[s + 3]
    }
  }

  // An all-zero AND mask means "draw every pixel"; the alpha channel does the
  // actual shaping.
  const maskRowBytes = Math.ceil(width / 32) * 4
  return Buffer.concat([header, pixels, Buffer.alloc(maskRowBytes * height)])
}

/** Pack per-size entries into an .ico directory. Each body is PNG or BMP bytes. */
function encodeICO(entries) {
  const headerSize = 6 + entries.length * 16
  let offset = headerSize
  const directory = Buffer.alloc(headerSize)
  directory.writeUInt16LE(0, 0)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(entries.length, 4)

  const bodies = []
  entries.forEach((entry, index) => {
    const record = 6 + index * 16
    directory[record] = entry.size === 256 ? 0 : entry.size
    directory[record + 1] = entry.size === 256 ? 0 : entry.size
    directory[record + 2] = 0
    directory[record + 3] = 0
    directory.writeUInt16LE(1, record + 4)
    directory.writeUInt16LE(32, record + 6)
    directory.writeUInt32LE(entry.body.length, record + 8)
    directory.writeUInt32LE(offset, record + 12)
    offset += entry.body.length
    bodies.push(entry.body)
  })

  return Buffer.concat([directory, ...bodies])
}

// ------------------------------------------------------------------ the work

/** Turn a white-on-black mark into white-on-transparent, keyed on luminance. */
function keyOutBackground(image) {
  const { width, height, data } = image
  const out = Buffer.alloc(data.length)
  const span = 255 - BLACK_POINT
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    const luminance = Math.max(data[o], data[o + 1], data[o + 2])
    const coverage = Math.max(0, Math.min(255, ((luminance - BLACK_POINT) * 255) / span))
    out[o] = 255
    out[o + 1] = 255
    out[o + 2] = 255
    out[o + 3] = Math.round(coverage)
  }
  return { width, height, data: out }
}

/** Square crop centred on a point in the master, clamped to its bounds. */
function crop(image, cx, cy, size) {
  const side = Math.min(size, image.width, image.height)
  const x0 = Math.max(0, Math.min(image.width - side, Math.round(cx - side / 2)))
  const y0 = Math.max(0, Math.min(image.height - side, Math.round(cy - side / 2)))
  const out = Buffer.alloc(side * side * 4)
  for (let y = 0; y < side; y++) {
    const src = ((y0 + y) * image.width + x0) * 4
    image.data.copy(out, y * side * 4, src, src + side * 4)
  }
  return { width: side, height: side, data: out }
}

/**
 * Drop fully-transparent edges.
 *
 * The supplied wordmark is a wide plate with the mark floating in the middle of
 * it. Cropping to the ink means the asset's own box is the mark's box, so a
 * `height` in CSS is the height of the letters rather than a guess at how much
 * empty plate the file happens to carry.
 */
function trim(image, threshold = 8) {
  let x0 = image.width
  let y0 = image.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] <= threshold) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return image
  const width = x1 - x0 + 1
  const height = y1 - y0 + 1
  const out = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const src = ((y0 + y) * image.width + x0) * 4
    image.data.copy(out, y * width * 4, src, src + width * 4)
  }
  return { width, height, data: out }
}

function write(file, buffer) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, buffer)
  console.log(`  ${file.replace(root + '/', '')}  ${(buffer.length / 1024).toFixed(0)} kB`)
}

/**
 * Build every derived asset.
 *
 * `target` defaults to the real locations but accepts a scratch directory, so
 * the output can be inspected before it replaces a tracked icon file.
 */
function generate(target = root) {
  const moon = decodePNG(readFileSync(join(brand, 'moon-mark-square.png')))
  const wordmark = decodePNG(readFileSync(join(brand, 'wordmark-wide.png')))
  const glyph = crop(moon, GLYPH_CX, GLYPH_CY, GLYPH_SPAN)

  write(
    join(target, 'resources', 'icon.png'),
    encodePNG(resize(moon, APP_ICON_SIZE, APP_ICON_SIZE))
  )

  /**
   * The lockup is two different pictures at two different scales: readable
   * type above ~48px, and an indistinct smear below it. Rather than ship one
   * artwork badly, the small entries carry the orbit glyph — the part of this
   * mark that is actually built to survive 16px — and the large entries carry
   * the full lockup the artwork was drawn as.
   */
  write(
    join(target, 'resources', 'icon.ico'),
    encodeICO(
      ICO_SIZES.map((size) => {
        const resized = resize(size <= GLYPH_MAX_SIZE ? glyph : moon, size, size)
        return {
          size,
          body: size >= PNG_MIN_SIZE ? encodePNG(resized) : encodeBMPImage(resized)
        }
      })
    )
  )

  // The tray and notifications draw at ~16px, so they get the glyph directly
  // instead of asking Electron to shrink a 1024px lockup down to nothing.
  write(join(target, 'resources', 'tray.png'), encodePNG(resize(glyph, 32, 32)))

  /**
   * The sidebar mark is keyed to alpha so a CSS mask can tint it with the
   * active theme's ink, trimmed to its own ink box, then emitted at four times
   * the tallest size it is drawn at so it stays crisp on every display scale
   * this app is used on. Width follows the trimmed mark's own aspect ratio.
   */
  const inked = trim(keyOutBackground(wordmark))
  const sidebarHeight = 80
  const sidebar = resize(
    inked,
    Math.round((sidebarHeight * inked.width) / inked.height),
    sidebarHeight
  )
  write(join(target, 'src', 'renderer', 'src', 'assets', 'brand', 'wordmark.png'), encodePNG(sidebar))

  /**
   * The same treatment for the orbit glyph, for the places a wordmark cannot
   * go: the collapsed rail, the splash, and any 16-22px slot that still needs
   * to read as SelfImpulse. Sourced from the lockup itself rather than redrawn,
   * so it is the same mark the .ico carries at small sizes.
   */
  const glyphInk = trim(keyOutBackground(glyph))
  const glyphHeight = 64
  const glyphAsset = resize(
    glyphInk,
    Math.round((glyphHeight * glyphInk.width) / glyphInk.height),
    glyphHeight
  )
  write(join(target, 'src', 'renderer', 'src', 'assets', 'brand', 'glyph.png'), encodePNG(glyphAsset))
}

export {
  decodePNG,
  encodePNG,
  encodeBMPImage,
  encodeICO,
  resize,
  keyOutBackground,
  crop,
  trim,
  generate,
  ICO_SIZES
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2] ? resolve(process.argv[2]) : root
  console.log(`brand assets → ${target}`)
  generate(target)
  console.log('done')
}
