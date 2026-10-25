/**
 * Durable office-generation regression gate for the pinned transitive
 * dependencies introduced by Task 2 (`package.json` → `overrides`).
 *
 * Why this file exists: the overrides pin `image-size@2.0.4` (declared by
 * `pptxgenjs`, the library `src/main/services/documents.ts` uses for .pptx) and
 * `uuid@11.1.1` (used by `exceljs`, the same module's .xlsx writer). Neither of
 * those two majors is a version either library *chose*, so the app ships a
 * generated document format whose producing libraries were tested against
 * something else. `studio.test.ts` covers registry/argv/classification only, so
 * before this file nothing repeatable ever called `pptxgenjs.write()` or
 * `exceljs.xlsx.writeBuffer()` under the pinned tree.
 *
 * What "exercised" means here, measured rather than assumed:
 *  - the .pptx is generated through the production function
 *    (`generatePresentation`) and, separately, with a real embedded PNG through
 *    the library the production function uses. `SlideSpec` has no image field,
 *    so an embedded image is not expressible through the production API; adding
 *    one would be a production change, not a test change.
 *  - `image-size` is exercised on the same PNG the deck embeds, resolved from
 *    `pptxgenjs`'s own require context (i.e. the resolution the override
 *    actually controls), and the file asserts the reason the pin is safe:
 *    `pptxgenjs@4` ships no `image-size` call site at all.
 *  - `uuid` is exercised at `exceljs`'s one and only call site
 *    (`cf-rule-ext-xform.js`, the `x14:id` of an ext conditional-formatting
 *    rule), so the GUID in the written package is the observable proof.
 *
 * Every assertion is on observable output: real bytes on disk in a temp task
 * workspace, the `PK\x03\x04` zip local-file signature, the `[Content_Types].xml`
 * central-directory entry, and the text of the OOXML parts inside the package.
 * No mocks of the office libraries, no spies, no stubbed writes.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { deflateSync, inflateRawSync } from 'node:zlib'
import ExcelJS from 'exceljs'
import PptxGenJS from 'pptxgenjs'
import { afterEach, describe, expect, it, vi } from 'vitest'

// `documents.ts` imports BrowserWindow at module scope (only `generatePdf` uses
// it). The office generators under test never open a window, so the Electron
// import is stubbed for the Node test environment; nothing in the office path is
// mocked.
vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindowStub {
    webContents = { printToPDF: async () => Buffer.alloc(0) }
    loadFile = async (): Promise<void> => undefined
    destroy = (): void => undefined
  }
}))

import { generatePresentation, generateSpreadsheet } from './documents'

const ROOT = resolvePath(__dirname, '..', '..', '..')

/** Zip local-file-header signature: `PK\x03\x04`. Every OOXML package starts here. */
const ZIP_LOCAL_FILE_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]

/** The OOXML content-type map; a package without it is not an Office document. */
const CONTENT_TYPES_PART = '[Content_Types].xml'

/** A generated .pptx or .xlsx is tens of kilobytes; anything near this is a stub. */
const MIN_OFFICE_BYTES = 2048

interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  localHeaderOffset: number
}

/**
 * Minimal central-directory reader (EOCD -> directory -> local headers), so the
 * assertions run on the bytes the libraries actually produced rather than on a
 * zip library we would otherwise be trusting.
 */
function zipEntries(bytes: Buffer): ZipEntry[] {
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('No zip end-of-central-directory record: not a zip package.')
  const count = bytes.readUInt16LE(eocd + 10)
  let offset = bytes.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Corrupt zip central directory.')
    const method = bytes.readUInt16LE(offset + 10)
    const compressedSize = bytes.readUInt32LE(offset + 20)
    const nameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    const localHeaderOffset = bytes.readUInt32LE(offset + 42)
    entries.push({
      name: bytes.slice(offset + 46, offset + 46 + nameLength).toString('utf8'),
      method,
      compressedSize,
      localHeaderOffset
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function zipPartNames(bytes: Buffer): string[] {
  return zipEntries(bytes).map((entry) => entry.name)
}

/** Read one package part out of the zip: stored (0) or deflated (8). */
function readZipPart(bytes: Buffer, name: string): Buffer {
  const entry = zipEntries(bytes).find((candidate) => candidate.name === name)
  if (!entry) throw new Error(`Zip has no part '${name}'.`)
  const header = entry.localHeaderOffset
  if (bytes.readUInt32LE(header) !== 0x04034b50) throw new Error(`Corrupt local header for '${name}'.`)
  const nameLength = bytes.readUInt16LE(header + 26)
  const extraLength = bytes.readUInt16LE(header + 28)
  const start = header + 30 + nameLength + extraLength
  const data = bytes.slice(start, start + entry.compressedSize)
  return entry.method === 0 ? data : inflateRawSync(data)
}

/** All XML parts of a package concatenated — lets assertions ignore part layout. */
function zipXmlText(bytes: Buffer): string {
  return zipEntries(bytes)
    .filter((entry) => !entry.name.endsWith('/') && /\.(xml|rels)$/i.test(entry.name))
    .map((entry) => readZipPart(bytes, entry.name).toString('utf8'))
    .join('\n')
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const name = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0)
  return Buffer.concat([length, name, data, crc])
}

/**
 * A real, self-contained 8x8 RGBA PNG written byte by byte (signature, IHDR,
 * one filtered scanline per row deflated into IDAT, IEND) — no fixture files, no
 * network, and valid enough for `image-size` to dimension it.
 */
function buildPng(width = 8, height = 8): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  const stride = 1 + width * 4
  const raw = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const row = y * stride
    raw[row] = 0 // filter: None
    for (let x = 0; x < width; x++) {
      const pixel = row + 1 + x * 4
      raw[pixel] = (x * 31) & 0xff
      raw[pixel + 1] = (y * 31) & 0xff
      raw[pixel + 2] = 0x80
      raw[pixel + 3] = 0xff
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/**
 * Resolve a module the way one dependent package resolves it, so the assertion
 * covers the tree the override actually controls instead of a top-level import.
 */
function requireAs(dependentPackage: string): NodeJS.Require {
  const dependentEntry = createRequire(join(ROOT, 'package.json')).resolve(dependentPackage)
  return createRequire(dependentEntry)
}

/** Nearest package.json with a `name` (skips the `{"type":"commonjs"}` stubs). */
function packageManifest(resolvedFile: string): { name: string; version: string } {
  let dir = dirname(resolvedFile)
  for (;;) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string }
      if (parsed.name && parsed.version) return { name: parsed.name, version: parsed.version }
    }
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`No package manifest above ${resolvedFile}`)
    dir = parent
  }
}

function assertOfficePackage(bytes: Buffer, label: string, requiredParts: string[]): string[] {
  expect(bytes.length, `${label} is empty`).toBeGreaterThan(MIN_OFFICE_BYTES)
  expect(
    [...bytes.subarray(0, 4)],
    `${label} does not start with the PK\\x03\\x04 zip local-file signature`
  ).toEqual(ZIP_LOCAL_FILE_SIGNATURE)
  const names = zipPartNames(bytes)
  expect(names, `${label} has no ${CONTENT_TYPES_PART} entry`).toContain(CONTENT_TYPES_PART)
  for (const part of requiredParts) {
    expect(names, `${label} is missing the ${part} package part`).toContain(part)
  }
  return names
}

let workspaces: string[] = []

function makeWorkspace(): string {
  // The production API already takes the task workspace as its first argument,
  // so the generators write into a real (temporary) workspace exactly as they do
  // in the app; no production function was added or widened for this test.
  const workspace = mkdtempSync(join(tmpdir(), 'office-selfimpulse-'))
  workspaces.push(workspace)
  return workspace
}

afterEach(() => {
  for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true })
  workspaces = []
})

describe('office generation under the pinned dependencies', () => {
  it('writes a real .pptx through the production presentation generator', async () => {
    const workspace = makeWorkspace()
    const generated = await generatePresentation(workspace, {
      filename: 'board-deck.pptx',
      title: 'SelfImpulse Board Deck',
      subtitle: 'Generated under the pinned office dependencies',
      slides: [
        { title: 'Q4 objectives', bullets: ['Ship the merged agent', 'Keep the sink ratchet green'] },
        { title: 'Risks register', bullets: ['Pinned transitive dependencies'] }
      ]
    })

    expect(generated.kind).toBe('presentation')
    expect(generated.filePath).toBe(join(workspace, 'artifacts', 'board-deck.pptx'))

    const bytes = readFileSync(generated.filePath)
    console.info(`PPTX via generatePresentation: ${generated.filePath} (${bytes.length} bytes)`)
    const names = assertOfficePackage(bytes, 'production .pptx', [
      'ppt/presentation.xml',
      'ppt/slides/slide1.xml',
      'ppt/slides/slide2.xml'
    ])

    const xml = zipXmlText(bytes)
    expect(xml).toContain('Q4 objectives')
    expect(xml).toContain('Risks register')
    expect(xml).toContain('Ship the merged agent')
    // One slide part per slide: the title slide plus the two content slides.
    expect(names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(3)

    const preview = generated.previewPath
    expect(preview).toBeDefined()
    expect(existsSync(preview as string), 'no HTML preview written beside the deck').toBe(true)
    expect(readFileSync(preview as string, 'utf8')).toContain('Q4 objectives')
  })

  it('embeds a real PNG and keeps the pinned image-size usable', async () => {
    const pptxRequire = requireAs('pptxgenjs')
    const imageSizePath = pptxRequire.resolve('image-size')
    const manifest = packageManifest(imageSizePath)
    expect(
      manifest,
      'pptxgenjs does not resolve the image-size version the override pins'
    ).toEqual({ name: 'image-size', version: '2.0.4' })

    // The 1.x -> 2.x jump replaced a callable default export with a namespace, so
    // the shape is the thing that would break a call site. Assert the shape, then
    // assert the shape actually works on a real PNG.
    const imageSizeModule = pptxRequire('image-size') as {
      imageSize?: (input: Buffer) => { width?: number; height?: number; type?: string }
      default?: (input: Buffer) => { width?: number; height?: number; type?: string }
    }
    expect(typeof imageSizeModule.imageSize, 'image-size 2.x must expose imageSize()').toBe('function')
    const dimensions = (imageSizeModule.imageSize as (input: Buffer) => { width?: number; height?: number; type?: string })(
      buildPng(8, 8)
    )
    expect(dimensions).toMatchObject({ width: 8, height: 8, type: 'png' })

    // The reason the pin is safe, kept under test: the shipped pptxgenjs bundle
    // carries no image-size call site. If a future version starts importing it,
    // this fails and the 1.x->2.x API change above must be re-checked.
    const dist = join(ROOT, 'node_modules', 'pptxgenjs', 'dist')
    const bundles = readdirSync(dist).filter((name) => /\.(cjs|es|min)\.js$/.test(name))
    expect(bundles.length, 'no pptxgenjs bundles found to inspect').toBeGreaterThan(0)
    for (const bundle of bundles) {
      const source = readFileSync(join(dist, bundle), 'utf8')
      expect(
        /(?:require\(|from\s*)['"]image-size['"]/.test(source),
        `pptxgenjs/${bundle} now imports image-size — re-verify the pinned major`
      ).toBe(false)
    }

    // And the image really does end up inside a real deck.
    const workspace = makeWorkspace()
    const png = buildPng(8, 8)
    const pptx = new PptxGenJS()
    const slide = pptx.addSlide()
    slide.addText('Embedded image regression', { x: 0.8, y: 0.5, w: 6, h: 0.9 })
    slide.addImage({ data: `image/png;base64,${png.toString('base64')}`, x: 0.8, y: 1.6, w: 1, h: 1 })
    const target = join(workspace, 'embedded-image.pptx')
    await pptx.writeFile({ fileName: target })

    const bytes = readFileSync(target)
    console.info(`PPTX with embedded PNG: ${target} (${bytes.length} bytes, media ${png.length} bytes)`)
    const names = assertOfficePackage(bytes, 'image-embedding .pptx', ['ppt/presentation.xml'])
    const media = names.filter((name) => name.startsWith('ppt/media/'))
    expect(media.length, 'no media part in the deck').toBeGreaterThan(0)
    const mediaName = media.find((name) => name.endsWith('.png'))
    expect(mediaName, 'the embedded part is not the PNG we generated').toBeDefined()
    expect([...readZipPart(bytes, mediaName as string)], 'the stored media is not our PNG bytes').toEqual([...png])
    expect(readZipPart(bytes, CONTENT_TYPES_PART).toString('utf8')).toContain('image/png')
  })

  it('writes a real .xlsx with rows through the production spreadsheet generator', async () => {
    const workspace = makeWorkspace()
    const generated = await generateSpreadsheet(workspace, {
      filename: 'q4-budget.xlsx',
      title: 'Q4 budget',
      sheets: [
        {
          name: 'Budget',
          rows: [
            ['Line', 'Amount', 'Owner'],
            ['Runrate', 120000, 'Finance'],
            ['GPU cluster', 48000, 'Infra']
          ]
        }
      ]
    })

    expect(generated.kind).toBe('spreadsheet')
    expect(generated.filePath).toBe(join(workspace, 'artifacts', 'q4-budget.xlsx'))

    const bytes = readFileSync(generated.filePath)
    console.info(`XLSX via generateSpreadsheet: ${generated.filePath} (${bytes.length} bytes)`)
    assertOfficePackage(bytes, 'production .xlsx', ['xl/workbook.xml', 'xl/worksheets/sheet1.xml'])

    const xml = zipXmlText(bytes)
    expect(xml).toContain('Budget')
    expect(xml).toContain('Runrate')
    expect(xml).toContain('GPU cluster')
    expect(xml).toContain('120000')
    expect(xml).toContain('48000')
    expect(readFileSync(generated.previewPath as string, 'utf8')).toContain('Runrate')
  })

  it('keeps the pinned uuid working at exceljs only call site', async () => {
    const excelRequire = requireAs('exceljs')
    expect(
      packageManifest(excelRequire.resolve('uuid')),
      'exceljs does not resolve the uuid version the override pins'
    ).toEqual({ name: 'uuid', version: '11.1.1' })

    // exceljs's single call site is `const { v4: uuidv4 } = require('uuid')` in
    // cf-rule-ext-xform.js, so the destructure it uses has to keep working.
    const { v4 } = excelRequire('uuid') as { v4: () => string }
    expect(v4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(new Set([v4(), v4(), v4()]).size).toBe(3)

    const workspace = makeWorkspace()
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Ext rules')
    sheet.addRows([[1], [2], [3], [4], [5]])
    // A dataBar rule is written through the x14 extension list, whose `x14:id` is
    // the uuid v4 value: the one place in exceljs that can prove the pin works.
    sheet.addConditionalFormatting({
      ref: 'A1:A5',
      rules: [{ type: 'dataBar', priority: 1, cfvo: [{ type: 'min' }, { type: 'max' }], minLength: 0, maxLength: 100 }]
    })
    const target = join(workspace, 'ext-rule.xlsx')
    await workbook.xlsx.writeFile(target)

    const bytes = readFileSync(target)
    console.info(`XLSX exercising exceljs uuid call site: ${target} (${bytes.length} bytes)`)
    assertOfficePackage(bytes, 'extension-rule .xlsx', ['xl/workbook.xml', 'xl/worksheets/sheet1.xml'])

    const sheetXml = readZipPart(bytes, 'xl/worksheets/sheet1.xml').toString('utf8')
    expect(sheetXml).toContain('x14:cfRule')
    expect(sheetXml, 'the extension rule lost its range').toContain('<xm:sqref>A1:A5</xm:sqref>')
    const generatedId = sheetXml.match(
      /<x14:id>\{([0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12})\}<\/x14:id>/
    )
    expect(
      generatedId,
      'no uuid-v4 x14:id in the written package — exceljs call site did not run against the pinned uuid'
    ).not.toBeNull()
  })
})
