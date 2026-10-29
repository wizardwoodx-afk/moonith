import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  AtSign,
  Bot,
  Boxes,
  Camera,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock,
  Command,
  Copy,
  Cpu,
  ExternalLink,
  Eye,
  File,
  FileStack,
  FileText,
  Folder,
  FolderOpen,
  Info,
  KeyRound,
  ListChecks,
  LockKeyhole,
  Minus,
  Paperclip,
  Pause,
  Pin,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Settings2,
  ShieldCheck,
  Square,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  Users,
  Wrench,
  X,
  Zap
} from 'lucide-react'
import { cn } from '../lib/utils'

/**
 * The icon system.
 *
 * Lucide draws on a 24-unit grid and hands that grid to a `size` box, so a
 * glyph's stroke shrinks with the box: the app's 12px icons were painting hairlines
 * under a device pixel while its 16px icons painted a full one, which is why a
 * dense panel read as several icon families rather than one. Two fixes were on the
 * table and one was rejected — a hand-authored glyph set that holds a constant
 * stroke by construction (tried once here, ~2000 paths, the wrong move: it is a
 * second icon library to maintain and it drifts from Lucide the day Lucide
 * redraws a leaf). This layer takes the other one: keep Lucide, keep one stroke
 * *weight*, and state it as the thickness we want on screen rather than the
 * number on the viewBox. `ICON_STROKE_PX` is that promise; `iconStrokeWidth`
 * converts it per size. At `lg` (16px) it lands on exactly 1.5, the weight Lucide
 * authored, so the glyphs stay as drawn and only the small end gets the
 * compensation it needs.
 *
 * State works the same way. Anything that carries a state — installed, ready,
 * live, attached, pinned — is one geometry shown two ways: outline at rest,
 * `fill="currentColor"` when active. Same path, so toggling reads as one control
 * changing rather than two icons swapping. That is the pattern
 * `MessageFeedback.tsx` already set with the thumbs, and every glyph marked
 * `state: true` below follows it. A glyph with no honest state stays line-only and
 * refuses `active`, so nothing can be filled by accident.
 */

/** The whole scale. Five steps, and no icon in the app may sit between them. */
export const ICON_SIZES = {
  /** Micro affordances inside 10px chrome: chevrons, chips, inline markers. */
  xs: 11,
  /** The default. Dense task-panel rows, inline with 10.5-11.5px text. */
  sm: 12,
  /** Controls and menu rows, inline with 12-12.5px text. */
  md: 14,
  /** Modal and section heads. Also the size Lucide's 1.5 stroke is drawn for. */
  lg: 16,
  /** Hero glyphs alone: a state mark in a 40px+ tile. Never inline with text. */
  xl: 20
} as const

export type IconSize = keyof typeof ICON_SIZES

/** One optical weight, in CSS pixels, at every size. */
export const ICON_STROKE_PX = 1

/**
 * The viewBox stroke that draws `ICON_STROKE_PX` on screen at `size`, rounded to
 * two decimals so the attribute stays stable across renders.
 */
export function iconStrokeWidth(size: IconSize): number {
  return Math.round(((ICON_STROKE_PX * 24) / ICON_SIZES[size]) * 100) / 100
}

interface GlyphSpec {
  icon: LucideIcon
  /** Present only on glyphs whose state is carried by `fill`. */
  state?: true
}

/**
 * The glyphs this app uses, by meaning. Add to the right group when a surface
 * needs one; do not reach for `lucide-react` directly in a view — that is how the
 * 10/11/12/13/14/15 spread came back.
 */
export const ICONS = {
  /* Capability — what the agent can do right now. */
  spark: { icon: Sparkles, state: true }, // line: nothing installed or chosen · filled: installed / a model chosen
  connector: { icon: Plug, state: true }, // line: stopped, starting or failed · filled: ready
  crew: { icon: Bot, state: true }, // line: no run live · filled: a run is live
  builtin: { icon: Boxes }, // ships with the app; it has no off state
  model: { icon: Cpu },
  plan: { icon: ListChecks },
  quick: { icon: Zap },
  tool: { icon: Wrench },

  /* Judgement — outcomes the app reports on work it did. */
  alert: { icon: CircleAlert }, // a state of its own; colour carries it
  caution: { icon: TriangleAlert },
  confirm: { icon: Check },
  checkAll: { icon: CheckCheck },
  stopped: { icon: Minus },
  shield: { icon: ShieldCheck, state: true }, // line: gating or awaiting you · filled: guarding right now
  voteUp: { icon: ThumbsUp, state: true }, // the pair MessageFeedback.tsx established
  voteDown: { icon: ThumbsDown, state: true },

  /* Sources & output — what the task is holding. */
  folder: { icon: Folder, state: true }, // line: no folder granted · filled: working folder attached
  folderOpen: { icon: FolderOpen, state: true }, // line: nothing attached · filled: access granted
  file: { icon: File, state: true }, // line: not attached · filled: attached to this message
  fileText: { icon: FileText },
  output: { icon: FileStack }, // the count next to it carries the state, not the glyph
  pin: { icon: Pin, state: true }, // line: not pinned · filled: pinned

  /* Composer — building a message. */
  add: { icon: Plus },
  attach: { icon: Paperclip },
  capture: { icon: Camera },
  mention: { icon: AtSign },
  command: { icon: Command },
  send: { icon: ArrowUp }, // a filled arrow is a blob, so send's pair is `stop`, not a fatter arrow
  stop: { icon: Square, state: true }, // line: the square as drawn · filled: work is live, pressing ends it

  /* Chrome — moving around the app. */
  chevronDown: { icon: ChevronDown },
  chevronLeft: { icon: ChevronLeft },
  chevronRight: { icon: ChevronRight },
  arrowLeft: { icon: ArrowLeft },
  arrowRight: { icon: ArrowRight },
  arrowUpRight: { icon: ArrowUpRight },
  externalLink: { icon: ExternalLink },
  close: { icon: X },
  refresh: { icon: RefreshCw },
  settings: { icon: Settings },
  settingsFine: { icon: Settings2 },
  search: { icon: Search },
  info: { icon: Info },
  key: { icon: KeyRound },
  lock: { icon: LockKeyhole },
  copy: { icon: Copy },
  eye: { icon: Eye },
  play: { icon: Play },
  pause: { icon: Pause },
  clock: { icon: Clock },
  users: { icon: Users }
} satisfies Record<string, GlyphSpec>

export type IconName = keyof typeof ICONS

/** Names whose state the filled side carries. `active` means nothing elsewhere. */
export type StatefulIconName = {
  [K in IconName]: (typeof ICONS)[K] extends { state: true } ? K : never
}[IconName]

export const STATEFUL_ICON_NAMES = Object.keys(ICONS).filter(
  (name): name is StatefulIconName => (ICONS[name as IconName] as GlyphSpec).state === true
)

export interface IconProps {
  name: IconName
  size?: IconSize
  /** The active half of a state pair. Ignored by glyphs that carry no state. */
  active?: boolean
  className?: string
}

/**
 * Every glyph in the app goes through here, so size, stroke, alignment and the
 * line/fill rule have one owner.
 *
 * Icons stay `aria-hidden`: the control or the word beside it already names them,
 * and a second label inside the button is how screen readers start announcing
 * "Restart Restart local server".
 */
export function Icon({ name, size = 'sm', active = false, className }: IconProps) {
  const spec: GlyphSpec = ICONS[name]
  const Glyph = spec.icon
  const filled = active === true && spec.state === true
  return (
    <Glyph
      size={ICON_SIZES[size]}
      strokeWidth={iconStrokeWidth(size)}
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden="true"
      className={cn('shrink-0 align-[-0.125em]', className)}
    />
  )
}
