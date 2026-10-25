# Native AI Browser

SelfImpulse's default task browser uses **Stagehand 4.3.0 inside the Electron
main process**. It is not a hosted Browserbase session, MCP server, external
CLI, second agent loop, or localhost application bridge. The Captain and each
Crew actor keep their existing task identity, provider, DLP, approvals, usage,
workspace, artifacts, and audit boundaries.

## What is implemented

- **Headless by default:** local Chrome/Chromium launches with an isolated,
  persistent profile for the Captain or one Crew actor.
- **Real AI browser primitives:** `browser_observe` proposes actionable
  elements, `browser_act` performs one natural-language action, and
  `browser_extract_structured` returns schema-validated JSON.
- **Deterministic controls:** open, back, reload, click, type, select, key
  press, scroll, read text, wait, screenshot, and show remain available for
  precise repeatable steps.
- **Existing models:** Stagehand calls the task's configured provider and model
  through SelfImpulse's OpenAI/Anthropic-compatible transports. There is no
  second provider key store. Text and screenshots are converted without
  discarding visual input; model usage is charged to the existing usage ledger.
- **Native presentation:** Settings → AI Browser shows engine/runtime state,
  and the task's Artifacts surface shows a live activity card, latest
  screenshot, bounded action metadata, blocked-request count, fallback notice,
  and a visible-takeover action.
- **Graceful deterministic fallback:** if Stagehand cannot start, opening a
  page can use the existing built-in Electron Chromium browser. AI operations
  then fail explicitly; the product never labels selector-only fallback as a
  successful AI action.

Engine and headless preferences apply to new sessions. Changing a preference
does not unexpectedly replace an active page. An explicit visible takeover of
a headless Stagehand session relaunches the same isolated profile and reopens
the current URL. Cookies/storage retained by that profile remain, but unsaved
form input or other in-memory page state can be reset; the activity card says
so when this happens.

## Chrome requirement

The Stagehand SDK does **not** supply a browser binary. Install Google Chrome
or Chromium, or set `CHROME_PATH` to an existing executable. SelfImpulse does
not download a browser in the background. Settings → AI Browser reports whether
a local executable was discovered.

If Chrome is unavailable, choose **Built-in Chromium** for deterministic
controls, or install Chrome and retry Stagehand. Selecting Built-in Chromium
also prevents new AI-only sessions from silently launching Stagehand.

Stagehand's upstream launcher disables Chromium's OS sandbox when running as
root or when `CI` is set. SelfImpulse refuses that weakened launch rather than
silently accepting it. Run the desktop app as a standard user; the built-in
Electron fallback remains available in environments where Stagehand cannot be
started safely.

## Approval and prompt-injection boundaries

- `browser_act` is high risk and requires **individual approval every time**.
  The per-task “always allow” shortcut is disabled for this tool.
- Deterministic writes continue through the existing tool policy and approval
  broker. Typed text is hidden from approval details, and operational errors
  pass through secret/API-key redaction.
- Page text, element descriptions, screenshots, and AI-proposed actions are
  untrusted input. The Captain prompt explicitly prefers deterministic tools
  for known selectors and forbids using AI actions to bypass a denied action or
  solve CAPTCHAs/human-verification challenges.
- AI extraction is read-only at the tool boundary. A caller-supplied extraction
  schema must be a bounded JSON Schema object; Stagehand's result is validated
  against the corresponding Zod schema before it is returned.

These controls reduce accidental and model-initiated harm. They do not make a
public page honest, and they do not replace human judgment for purchases,
account changes, messages, or other remote side effects.

## Network and session containment

For Stagehand sessions, SelfImpulse attaches a private loopback-only CDP
control channel and installs request interception before resuming page/worker
targets:

- every request scheme is intercepted, while only destinations accepted by the
  existing navigation verifier are allowed;
- public HTTP(S) navigation is DNS-aware; localhost, private/link-local ranges,
  cloud metadata, credential-bearing URLs, and unsupported schemes are denied;
- redirects, subresources, and newly attached targets use the same boundary;
  malformed or excess pending requests fail closed;
- loss of the request guard closes the browser session rather than continuing
  without protection;
- Chrome's wildcard remote-origin waiver and unsafe extension-debugging flag
  are removed, downloads are not accepted, TLS errors are not bypassed, and
  per-session profile directories are owner-only on POSIX platforms.

The built-in Chromium path retains its sandboxed renderer, isolated persistent
partition, denied permission requests/downloads, and navigation/subresource
checks. Screenshots enter the task workspace through the existing artifact
path; new screenshot files use exclusive creation and owner-only permissions.

Task deletion closes and erases every known Captain/Crew browser profile for
that task. Application shutdown closes active sessions without erasing them.
Persistent browser profiles are not presented as an encrypted credential
vault; use the OS-backed provider credential store for provider keys.

### Residual limits

DNS verification and browser request interception are defense in depth, not an
absolute answer to every DNS-rebinding, browser-engine, or compromised-host
scenario. The check and Chrome's own connection are not a hardware-backed
network namespace. Application/path containment is not a container or VM.
DLP is pattern/field-based and cannot identify every confidential fact. These
limits also matter when a configured model provider receives page content.

## Data and audit path

Stagehand model calls use `GovernanceService.protectBrowserMessages`, the same
DLP decision and runtime-audit path as Captain model calls. Block mode fails
before provider egress; redact mode records categories/outcomes rather than
secret values. Browser action metadata and errors are bounded and redacted
before entering persistent task state or renderer UI.

## Verification in this change

The implementation is covered by focused tests for the provider adapters,
multimodal conversion, structured output, DLP, browser tool approval contracts,
settings normalization, loopback-only CDP, fail-closed request handling,
Chrome endpoint parsing, and Stagehand lifecycle with a mocked SDK boundary.
Typecheck and production build are required verification gates.

A mocked SDK lifecycle test is **not** a live Chrome compatibility claim. Live
Stagehand behavior requires a supported local Chrome/Chromium executable and a
configured provider; this document and the UI deliberately keep that
verification distinction visible.

## Attribution

Stagehand is MIT-licensed by Browserbase Inc. The pinned dependency, reviewed
source revision, integration scope, and redistribution notice are recorded in
`src/main/browser/PROVENANCE.json`, `LICENSES/stagehand-MIT.txt`, and
`THIRD-PARTY-NOTICES.md`.
