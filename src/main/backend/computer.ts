import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProviderToolSpec } from './provider'

/**
 * Computer use — real desktop control for the agent.
 *
 * Everything here is a genuine OS action on Windows (screen capture, window
 * enumeration, focus, input, URL opening). It is opt-in: the agent only gets
 * these tools when the user turns Computer use on in Settings.
 *
 * Ported from the earlier desktop shell.
 */

const IS_WIN = process.platform === 'win32'

/* ------------------------------------------------------------------ */
/* PowerShell helpers                                                  */
/* ------------------------------------------------------------------ */

interface PsOptions {
  timeout?: number
  env?: Record<string, string>
}

function ps(script: string, { timeout = 30000, env }: PsOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const psExe = IS_WIN ? 'powershell.exe' : 'pwsh'
    execFile(
      psExe,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        timeout,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        env: env ? { ...process.env, ...env } : process.env
      },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          reject(new Error(String(stderr || err.message).trim().slice(0, 300)))
          return
        }
        resolve(stdout)
      }
    )
  })
}

const SNAPSHOT_DIR = join(tmpdir(), 'knight-cowork', 'snapshots')

/* ------------------------------------------------------------------ */
/* Screen capture                                                      */
/* ------------------------------------------------------------------ */

const CAPTURE_PS = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$out = $env:KNIGHT_SHOT
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
$bounds.Width.ToString() + "x" + $bounds.Height.ToString()
`

export interface Screenshot {
  ok: true
  file: string
  bytes: number
  screen: string
  data: string
}

export async function screenshot(): Promise<Screenshot> {
  if (!IS_WIN) throw new Error('Screen capture is only implemented for Windows in this build.')
  mkdirSync(SNAPSHOT_DIR, { recursive: true })
  const file = join(SNAPSHOT_DIR, `shot-${Date.now()}.png`)
  const size = await ps(CAPTURE_PS, { env: { KNIGHT_SHOT: file } })
  if (!existsSync(file)) throw new Error('The screenshot could not be written.')
  const buf = readFileSync(file)
  return { ok: true, file, bytes: buf.length, screen: String(size).trim(), data: buf.toString('base64') }
}

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */

const WINDOWS_PS = `
Add-Type @"
using System;using System.Runtime.InteropServices;using System.Text;
public class SW {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder t, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$rows = New-Object System.Collections.ArrayList
$cb = [SW+EnumWindowsProc]{
  param($h, $l)
  if ([SW]::IsWindowVisible($h)) {
    $len = [SW]::GetWindowTextLength($h)
    if ($len -gt 0) {
      $sb = New-Object System.Text.StringBuilder ($len + 2)
      [SW]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null
      $p = 0
      [SW]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
      $r = New-Object SW+RECT
      [SW]::GetWindowRect($h, [ref]$r) | Out-Null
      [void]$rows.Add($sb.ToString() + [char]31 + $p + [char]31 + $r.Left + "," + $r.Top + "," + ($r.Right-$r.Left) + "," + ($r.Bottom-$r.Top))
    }
  }
  return $true
}
[SW]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$rows -join [Environment]::NewLine
`

export interface WindowInfo {
  title: string
  pid: number
  x: number
  y: number
  w: number
  h: number
}

export async function windows(): Promise<WindowInfo[]> {
  const out = await ps(WINDOWS_PS)
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [title, pid, rect] = line.split(String.fromCharCode(31))
      const [x, y, w, h] = (rect || '').split(',').map(Number)
      return { title: title || '', pid: Number(pid), x, y, w, h }
    })
    .filter((w) => w.title && w.w > 40 && w.h > 40)
}

const FOCUS_PS = `
Add-Type @"
using System;using System.Runtime.InteropServices;using System.Text;
public class FW {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder t, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int n);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@
$target = $env:KNIGHT_WINDOW
$cb = [FW+EnumWindowsProc]{
  param($h, $l)
  if ([FW]::IsWindowVisible($h)) {
    $len = [FW]::GetWindowTextLength($h)
    $sb = New-Object System.Text.StringBuilder ($len + 2)
    [FW]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null
    if ($sb.ToString() -like "*$target*") {
      [FW]::ShowWindow($h, 9) | Out-Null
      [FW]::BringWindowToTop($h) | Out-Null
      [FW]::SetForegroundWindow($h) | Out-Null
    }
  }
  return $true
}
[FW]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
"ok"
`

export interface FocusResult {
  ok: true
  title: string
}

export async function focusWindow(title: string): Promise<FocusResult> {
  await ps(FOCUS_PS, { env: { KNIGHT_WINDOW: title } })
  return { ok: true, title }
}

const CLICK_PS = `
Add-Type @"
using System;using System.Runtime.InteropServices;
public class MC {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
"@
[MC]::SetCursorPos([int]$env:KNIGHT_X, [int]$env:KNIGHT_Y) | Out-Null
Start-Sleep -Milliseconds 120
[MC]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
[MC]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
"ok"
`

const MOUSE_PS = `
Add-Type @"
using System;using System.Runtime.InteropServices;
public class MM {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
}
"@
[MM]::SetCursorPos([int]$env:KNIGHT_X, [int]$env:KNIGHT_Y) | Out-Null
Start-Sleep -Milliseconds 100
$button = [int]$env:KNIGHT_BUTTON
$down = if ($button -eq 2) { 0x0008 } else { 0x0002 }
$up   = if ($button -eq 2) { 0x0010 } else { 0x0004 }
[MM]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero)
[MM]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero)
if ([int]$env:KNIGHT_CLICK_COUNT -gt 1) {
  Start-Sleep -Milliseconds 90
  [MM]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero)
  [MM]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero)
}
"ok"
`

const SCROLL_PS = `
Add-Type @"
using System;using System.Runtime.InteropServices;
public class MS {
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
"@
$dir = $env:KNIGHT_DIRECTION
$delta = switch ($dir) { "up" { 240 } "right" { -240 } "left" { 240 } default { -240 } }
[MS]::mouse_event(0x0800, 0, [uint32]([int32]$delta), 0, [IntPtr]::Zero)
"ok"
`

const HOTKEY_PS = `
Add-Type @"
using System;using System.Runtime.InteropServices;
public class MK {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
}
"@
$map = @{ ctrl = 0x11; control = 0x11; alt = 0x12; shift = 0x10; win = 0x5B; enter = 0x0D; return = 0x0D; tab = 0x09; esc = 0x1B; escape = 0x1B; backspace = 0x08; space = 0x20; delete = 0x2E }
$keys = $env:KNIGHT_KEYS -split '\\s+' | Where-Object { $_ }
$codes = @()
foreach ($k in $keys) {
  $low = $k.ToLower()
  if ($map.ContainsKey($low)) { $codes += $map[$low] } else {
    $code = [System.Windows.Forms.SendKeys]::SendWait("")
    $c = [byte][char]$low[0]
    $codes += $c
  }
}
foreach ($c in $codes) { [MK]::keybd_event($c, 0, 0, [IntPtr]::Zero) }
foreach ($c in ($codes | Select-Object -Reverse)) { [MK]::keybd_event($c, 0, 2, [IntPtr]::Zero) }
"ok"
`

export type ClickArgs = {
  x?: number
  y?: number
  button?: string
  count?: number
}

export interface ClickResult {
  ok: true
  x: number | undefined
  y: number | undefined
  button: string
  count: number
}

export async function click({ x, y, button = 'left', count = 1 }: ClickArgs): Promise<ClickResult> {
  await ps(
    `Add-Type -AssemblyName System.Windows.Forms
${MOUSE_PS.replace(
      'if ([int]$env:KNIGHT_CLICK_COUNT -gt 1)',
      'if ([int]$env:KNIGHT_CLICK_COUNT -gt 1)'
    )}`,
    {
      env: {
        KNIGHT_X: String(x),
        KNIGHT_Y: String(y),
        KNIGHT_BUTTON: button === 'right' ? '2' : '1',
        KNIGHT_CLICK_COUNT: String(count)
      }
    }
  )
  return { ok: true, x, y, button, count }
}

export type ScrollArgs = {
  direction?: string
  amount?: number
}

export interface ScrollResult {
  ok: true
  direction: string
  amount: number
}

export async function scroll({ direction = 'down', amount = 1 }: ScrollArgs): Promise<ScrollResult> {
  for (let i = 0; i < Math.max(1, amount); i++) {
    await ps(SCROLL_PS, { env: { KNIGHT_DIRECTION: direction } })
  }
  return { ok: true, direction, amount }
}

export type HotkeyArgs = {
  keys?: string[] | string
}

export interface HotkeyResult {
  ok: true
  keys: string[]
}

export async function hotkey({ keys = [] }: HotkeyArgs): Promise<HotkeyResult> {
  const list = (Array.isArray(keys) ? keys : String(keys).split(/\s+/)).filter(Boolean)
  await ps(HOTKEY_PS, { env: { KNIGHT_KEYS: list.join(' ') } })
  return { ok: true, keys: list }
}

export type TypeArgs = {
  text?: string
}

export interface TypeResult {
  ok: true
}

export async function type({ text }: TypeArgs): Promise<TypeResult> {
  await ps(
    `Add-Type -AssemblyName Microsoft.VisualBasic
Start-Sleep -Milliseconds 120
[Microsoft.VisualBasic.SendKeys]::SendWait($env:KNIGHT_TEXT)
"ok"`,
    { env: { KNIGHT_TEXT: String(text).replace(/([+^%~(){}\[\]])/g, '{$1}') } }
  )
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Tool surface for the model                                          */
/* ------------------------------------------------------------------ */

export interface ComputerToolParameter {
  type: string
}

/** An OpenAI-style function tool spec, the shape the provider expects. */
export type ComputerToolDefinition = ProviderToolSpec

export const COMPUTER_TOOLS: ProviderToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'computer_screenshot',
      description: 'Capture the screen so you can see what the user sees.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'computer_windows',
      description: 'List the visible windows on the desktop.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'computer_focus_window',
      description: 'Bring a window to the front by matching its title.',
      parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'computer_click',
      description: 'Click at a screen coordinate.',
      parameters: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string' } },
        required: ['x', 'y']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'computer_type',
      description: 'Type text into the focused window.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
    }
  }
]

export type ComputerEmit = (event: string, payload: unknown) => void

export interface ComputerOptions {
  enabled?: boolean
  emit?: ComputerEmit
}

export interface ComputerResult {
  ok: boolean
  error?: string
  file?: string
  screen?: string
  bytes?: number
  windows?: WindowInfo[]
  title?: string
  x?: number
  y?: number
  button?: string
  count?: number
}

export class Computer {
  enabled: boolean
  emit: ComputerEmit | undefined

  constructor({ enabled, emit }: ComputerOptions) {
    this.enabled = Boolean(enabled)
    this.emit = emit
  }

  setEnabled(on: boolean): void {
    this.enabled = Boolean(on)
  }

  definitions(): ProviderToolSpec[] {
    return this.enabled ? COMPUTER_TOOLS : []
  }

  async invoke(name: string, args: Record<string, unknown> = {}): Promise<ComputerResult> {
    if (!this.enabled) return { ok: false, error: 'Computer use is switched off.' }
    switch (name) {
      case 'computer_screenshot': {
        const shot = await screenshot()
        this.emit?.('computer:screenshot', { file: shot.file, screen: shot.screen })
        // the model gets the path and the size; the base64 is available to callers
        return { ok: true, file: shot.file, screen: shot.screen, bytes: shot.bytes }
      }
      case 'computer_windows':
        return { ok: true, windows: await windows() }
      case 'computer_focus_window':
        return focusWindow(args.title as string)
      case 'computer_click':
        return click(args as ClickArgs)
      case 'computer_type':
        return type(args as TypeArgs)
      default:
        return { ok: false, error: `Unknown computer tool "${name}"` }
    }
  }
}
