import { app, desktopCapturer, screen } from 'electron'
import type { DesktopCapturerSource, Display } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { PastedImageInput } from '@shared/types'
import { ensureTaskWorkspace } from './paths'
import { store } from './store'
import { getMainWindow } from './window'

/**
 * Clipboard and screen images reach the agent the same way every other
 * attachment does: as a real file on disk. `AttachmentRef` carries a path and
 * nothing else, so anything the renderer holds only in memory has to be written
 * before it can be attached — here, into the task workspace's own
 * `attachments/` folder, which is where `runtime.ts#copyAttachments` already
 * keeps attached files.
 */

/** Clipboard formats the attachment pipeline can actually read as an image. */
const IMAGE_SUFFIXES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

/** Own-property lookup only, so an input like `constructor` can never resolve. */
function suffixFor(mimeType: string): string | undefined {
  return Object.hasOwn(IMAGE_SUFFIXES, mimeType) ? IMAGE_SUFFIXES[mimeType] : undefined
}

/** Screenshots are far below this; anything bigger is refused before decoding. */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

/**
 * A paste made from the welcome composer happens before a task exists. Those
 * bytes stage in the app's own temp tree — the same convention
 * `src/main/backend/computer.ts` uses for host screenshots — and
 * `runtime.ts#copyAttachments` moves them into the task workspace when the
 * message is sent, so nothing durable is invented.
 */
function pendingImagesDir(): string {
  return join(app.getPath('temp'), 'selfimpulse', 'clipboard')
}

function attachmentsDirFor(taskId: unknown): string {
  const id = typeof taskId === 'string' ? taskId.trim() : ''
  // App-generated task ids only, so nothing here can walk outside the
  // workspaces root even before the store lookup below rejects an unknown id.
  if (id && /^[A-Za-z0-9_-]{1,80}$/.test(id) && store.getTask(id)) {
    return join(ensureTaskWorkspace(id), 'attachments')
  }
  return pendingImagesDir()
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
}

/** Never overwrite an earlier capture: two pastes in one second stay two files. */
async function uniquePath(dir: string, prefix: string, suffix: string): Promise<string> {
  const at = stamp()
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = join(dir, attempt ? `${prefix}-${at}-${attempt}.${suffix}` : `${prefix}-${at}.${suffix}`)
    try {
      await fs.access(candidate)
    } catch {
      return candidate
    }
  }
  return join(dir, `${prefix}-${at}-${Date.now()}.${suffix}`)
}

async function writeImage(dir: string, prefix: string, bytes: Buffer, suffix: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true })
  const path = await uniquePath(dir, prefix, suffix)
  await fs.writeFile(path, bytes, { mode: 0o600 })
  if (dir === pendingImagesDir()) void prunePendingImages()
  return path
}

/**
 * A base64 clipboard image, exactly as the renderer read it off
 * `ClipboardEvent.clipboardData`, written to disk. Returns the path so the
 * caller can hand it to the same `fileRef` builder the drop and picker paths
 * use, which is what gives a pasted screenshot identical downstream behaviour.
 */
export async function savePastedImage(input: PastedImageInput): Promise<string> {
  const candidate = (input ?? {}) as Partial<PastedImageInput>
  const mimeType = typeof candidate.mimeType === 'string' ? candidate.mimeType.toLowerCase().trim() : ''
  const suffix = suffixFor(mimeType)
  if (!suffix) {
    throw new Error('Only a PNG, JPEG, WebP or GIF image can be attached from the clipboard.')
  }

  const encoded = typeof candidate.data === 'string' ? candidate.data.trim() : ''
  if (!encoded) throw new Error('The clipboard did not carry an image. Press Print Screen again and paste.')
  if (encoded.length > MAX_IMAGE_BYTES * 2) {
    throw new Error('That clipboard image is too large to attach. Limit is 25 MB.')
  }

  let bytes: Buffer
  try {
    bytes = Buffer.from(encoded, 'base64')
  } catch {
    bytes = Buffer.alloc(0)
  }
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error('The clipboard image could not be read. Take the screenshot again and paste it.')
  }

  return writeImage(attachmentsDirFor(candidate.taskId), 'pasted-image', bytes, suffix)
}

/** The display the app window lives on, falling back to the primary one. */
function targetDisplay(): Display {
  const window = getMainWindow()
  if (window && !window.isDestroyed()) {
    try {
      return screen.getDisplayMatching(window.getBounds())
    } catch {
      /* fall through to the primary display */
    }
  }
  return screen.getPrimaryDisplay()
}

const PERMISSION_HINT =
  'Screen capture needs your permission. On macOS open System Settings > Privacy & Security > Screen Recording, enable SelfImpulse and relaunch the app. On Windows check that no privacy setting or overlay is blocking screen capture, then try again.'

/**
 * One narrow capture action: the screen the app is on, written as a PNG into
 * the task's `attachments/` folder, returning its path. `desktopCapturer` only
 * exists in the main process, so this is the whole privileged surface the
 * renderer gets — no source list, no window picker, nothing arbitrary.
 */
export async function captureScreen(taskId: unknown): Promise<string> {
  const display = targetDisplay()
  const pixels = {
    width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
    height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor))
  }

  let sources: DesktopCapturerSource[]
  try {
    sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: pixels })
  } catch (error) {
    console.error('[capture] desktopCapturer.getSources failed:', error)
    throw new Error(PERMISSION_HINT)
  }

  const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0]
  if (!source) throw new Error(PERMISSION_HINT)

  let bytes: Buffer
  try {
    bytes = source.thumbnail.toPNG()
  } catch (error) {
    console.error('[capture] could not encode the captured screen:', error)
    throw new Error(PERMISSION_HINT)
  }
  const size = source.thumbnail.getSize()
  if (!bytes.length || !size.width || !size.height) {
    // A denied capture comes back as an empty image rather than an error.
    throw new Error(PERMISSION_HINT)
  }

  return writeImage(attachmentsDirFor(taskId), 'screen-capture', bytes, 'png')
}

/**
 * The staging tree is disposable by definition, so prune it whenever a capture
 * runs. Bounded, ordered removal: newest files are kept, everything past the
 * cap is deleted, and a failure here must never break the capture itself.
 */
async function prunePendingImages(keep = 24): Promise<void> {
  try {
    const dir = pendingImagesDir()
    const entries = await fs.readdir(dir)
    const files = await Promise.all(
      entries
        .map((name) => join(dir, name))
        .map(async (path) => {
          try {
            const stat = await fs.stat(path)
            return stat.isFile() ? { path, mtime: stat.mtimeMs } : null
          } catch {
            return null
          }
        })
    )
    const ranked = files
      .filter((entry): entry is { path: string; mtime: number } => Boolean(entry))
      .sort((a, b) => b.mtime - a.mtime)
    await Promise.all(ranked.slice(Math.max(0, keep)).map((entry) => fs.rm(entry.path, { force: true })))
  } catch (error) {
    console.debug('[capture] clipboard staging cleanup skipped:', error)
  }
}
