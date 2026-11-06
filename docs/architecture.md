# Sahayak Architecture

High-level decisions for building Sahayak, a Chrome Manifest V3 side-panel agent that can read the current page, **summarise public YouTube videos**, answer from that context, and act only after the user approves each step.

This document is the source of truth for *how* the system is structured. `docs/problemstatement.md` is the source of truth for *what* must ship. Implementation slices should follow this architecture rather than invent a second protocol, storage layout, or model router.

---

## 1. Purpose and design principles

Sahayak is not an autonomous browser bot. It is a **user-controlled** assistant that:

1. **Sees** the current tab (article text, **public YouTube watch pages**, selection, screenshot, numbered interactive elements).
2. **Thinks** in a side-panel chat using a free-tier model.
3. **Acts** one step at a time, only after Approve / Skip / Stop.

Two equal Week 1 reading jobs: **summarise the article in this tab**, and **summarise the public YouTube video in this tab** (same structured shape, plus chapter timestamps on video).

### 1.1 Non-negotiable principles

| Principle | Decision |
| --- | --- |
| User in the loop | No click, type, select, or scroll executes until the user approves that exact step. |
| Safety in code | Sensitive URLs, password/OTP/card fields, and consequential buttons are blocked by TypeScript policy, not by prompt text alone. |
| Keys stay in the panel process | The content script never sees API keys. Only the side panel (and the AI client it calls) reads credentials from `chrome.storage.local`. |
| Local memory | Profile, preferences, skills, and settings live on the device. No backend. |
| Grounded answers | Page chat answers only from supplied page context; otherwise it says the answer is not on the page. |
| Cheap by default | Gemini Flash-Lite for everyday text. Flash only for vision, YouTube, or JSON repair. Groq is text-only fallback. |
| Survive MV3 sleep | Approval state and agent progress live in `chrome.storage.session`, not in service-worker RAM. |
| Small extracts, not HTML | Models receive clipped readable text or a compact action map, never raw DOM. |

### 1.2 What this architecture deliberately excludes

- A server, proxy, or hosted backend.
- Autonomous multi-step execution.
- Login, payment, OTP, or banking automation.
- Chrome Web Store listing (GitHub Release ZIP + Load unpacked is the ship path).
- Mobile Chrome.
- Private, unlisted, age-gated, or live YouTube that Gemini cannot ingest. No caption scraping, no youtube-dl, no third-party transcript APIs.

---

## 2. System context

```
┌─────────────────────────────────────────────────────────────────┐
│  Google Chrome (desktop)                                        │
│                                                                 │
│  ┌──────────────┐   messages    ┌────────────────────────────┐  │
│  │ Side panel   │◄─────────────►│ Background service worker  │  │
│  │ React UI     │               │ routing, menus, capture,   │  │
│  │ + AI client  │               │ tab tracking, persistence  │  │
│  └──────┬───────┘               └─────────────┬──────────────┘  │
│         │ chrome.storage                      │ scripting /     │
│         │ local + session                     │ runtime msgs    │
│         ▼                                     ▼                 │
│  ┌──────────────┐               ┌────────────────────────────┐  │
│  │ Settings,    │               │ Content script in tab      │  │
│  │ profile,     │               │ extract, scan, badges,     │  │
│  │ skills, logs │               │ click/type/select/scroll   │  │
│  └──────────────┘               └────────────────────────────┘  │
│                                                                 │
│  Page  ←  Readability / DOM scan  →  numbered overlays          │
└───────────┬─────────────────────────────────────────────────────┘
            │ HTTPS (user's own API keys)
            ▼
   ┌─────────────────┐     fallback (text only)     ┌──────────┐
   │ Gemini          │─────────────────────────────►│ Groq     │
   │ Flash-Lite /    │                              │ (optional│
   │ Flash           │                              │  key)    │
   └─────────────────┘                              └──────────┘
```

External systems Sahayak talks to:

- **Gemini** — default model family. Text, vision (screenshot), and public YouTube file/URI input.
- **Groq** — optional text-only fallback when Gemini rate-limits or is unavailable.
- **GitHub** — source, release ZIP, and Pages landing site. Not part of runtime.

There is no Sahayak cloud. If Gemini and Groq are both down, the UI shows a clear error and stays usable.

---

## 3. Runtime processes and trust boundaries

Chrome MV3 gives three isolated JavaScript worlds. Architecture treats them as three trust zones.

| Zone | Process | May hold API keys | May touch the page DOM | May call Gemini/Groq |
| --- | --- | --- | --- | --- |
| Panel | Side panel (extension page) | Yes | No | **Yes — sole caller** |
| Worker | Service worker | No (may *forward* opaque settings reads only if a future path requires it; v1 does not) | No | No |
| Content | Isolated world in the tab | **Never** | Yes | **Never** |

### 3.1 Why the panel owns the model

- Settings UI already lives in the panel; keys stay next to the form that writes them.
- Streaming tokens belong in the chat UI.
- Content scripts run on untrusted pages. A page that tries to message the content script must not be able to exfiltrate a key.

The worker is a **router**, not an AI gateway: it validates the command, runs `classifyUrl`, injects/forwards to the content script, captures tabs, and persists session state.

### 3.2 Trust of page content

Anything read from the DOM is **untrusted data**. It is treated as content to summarise or map, never as instructions. Prompt assembly always places user/page text *after* a frozen system/policy block (see §9.5).

---

## 4. Logical modules

Build as a Vite + React + TypeScript Chrome extension (`@crxjs/vite-plugin`). Source lives under `src/`. Shared types are imported; there is one protocol, one storage helper, one safety module.

```
src/
  background/          service worker
  content/             page extract, scan, execute
  sidepanel/           React UI
  ai/                  Gemini + Groq client, prompts, parsers
  shared/              protocol, storage, limits, safety, models
  practice/            optional static practice pages (or a separate folder)
```

| Module | Responsibility | Created |
| --- | --- | --- |
| `manifest.json` | MV3 surface, permissions, side panel, content scripts | Slice 1 |
| `src/shared/protocol.ts` | Envelope, command names, record types | Slice 1 |
| `src/shared/storage.ts` | `local` and `session` getters/setters | Slice 1 |
| `src/shared/limits.ts` | Caps: extract, selection, steps, timeout, log retention | Slice 1 |
| `src/shared/safety-policy.ts` | URL class, field class, consequential names. Pure, no Chrome APIs | Slice 1 |
| `src/shared/models.ts` | Task → model route. Pin model id strings here only | Slice 2 |
| `src/ai/client.ts` | One HTTP client for Gemini and Groq | Slice 2 |
| `src/ai/prompts.ts` | Prompt assembly order from §9.5 | Slice 2 |
| `src/ai/parse.ts` | Summary, find-it, and agent JSON parsers | Slice 3 |
| `src/background/messaging.ts` | Panel → worker → content router | Slice 1 |
| `src/content/index.ts` | Content-script dispatcher | Slice 3 |

Later slices **fill functions** in these files. They do not invent a second protocol.

---

## 5. Chrome extension surface

### 5.1 Manifest V3

Minimum capabilities:

| Capability | Why |
| --- | --- |
| `side_panel` | Primary UI while the user stays on the page |
| `action` + `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` | Toolbar icon opens the panel |
| Background service worker | Messaging, context menus, tab tracking, `captureVisibleTab` |
| Content scripts | Extract, scan, overlay badges, execute approved actions |
| `options_ui` or in-panel Settings | API keys and preferences; keys are never hard-coded |

**Permissions (keep this set tight):**

- `sidePanel`
- `storage`
- `activeTab` plus host access needed for content scripts on http/https (and localhost for practice pages)
- `scripting` — inject or message the content script; execute approved actions
- `contextMenus` — Explain / Translate / Draft a reply
- `tabs` — active tab metadata; required for `captureVisibleTab` of the visible tab

**Host permissions:** `http://localhost/*`, `http://127.0.0.1/*`, and `https://*/*` / `http://*/*` as required for extraction and the agent on pages the user opens. The **agent allowlist** (who may receive click/type) is a *policy* check on top of host permissions, not a substitute for them.

Do not request `debugger`, `<all_urls>` beyond what content scripts need, or remote code.

### 5.2 Content script lifecycle

- Register a single content-script entry in the manifest so Load unpacked is valid from slice 1 (no-op until extract exists).
- One dispatcher in `src/content/index.ts` handles `page/extract`, `page/selection`, `page/scan`, `page/highlight`, `page/act`.
- Overlays (numbered badges) are injected into the page DOM but identified with a Sahayak prefix so they are excluded from later scans.

### 5.3 Side panel lifecycle

- On load, send `panel/ready` and `tab/getActive`.
- Header always shows the active tab title (and a safety badge if the URL is sensitive).
- If a `pendingIntent` exists in session storage (context menu), consume it and clear it.
- Tab change: refresh extract context, clear screenshot data URLs, reset chat transcript for the new `tabId`.

---

## 6. Messaging protocol

All messages use one envelope. No ad-hoc `chrome.runtime.sendMessage` payloads.

```ts
type Envelope<T = unknown> = {
  v: 1;
  id: string;          // correlation id
  cmd: CommandName;
  tabId?: number;
  payload?: T;
};
```

Responses:

```ts
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } };
```

The worker is the only hop between panel and content. Panel never talks to the tab directly.

### 6.1 Command catalog

| Command | Direction | Purpose |
| --- | --- | --- |
| `panel/ready` | Panel → Worker | Handshake; return pending intent if any |
| `tab/getActive` | Panel → Worker | `{ tabId, url, title }` |
| `settings/get` `settings/set` | Panel ↔ storage | Keys and preferences (panel may also call storage helpers directly) |
| `page/extract` | Panel → Worker → Content | Readable extract + `kind` |
| `page/selection` | Panel → Worker → Content | Current selection text |
| `page/scan` | Panel → Worker → Content | Action map + overlay badges |
| `page/highlight` | Panel → Worker → Content | Highlight element `n` without acting |
| `page/act` | Panel → Worker → Content | Execute one **already approved** action |
| `capture/visible` | Panel → Worker | `captureVisibleTab` PNG data URL |
| `agent/propose` | Panel-internal + worker | After extract/scan, model returns one JSON action (panel calls AI) |
| `agent/state/get` `agent/state/set` | Panel ↔ session storage | Persist loop progress |

Context-menu clicks do **not** call the model in the worker. They write `pendingIntent` and open the panel; the panel runs the prompt.

### 6.2 Worker routing rules

Before forwarding any page-read or page-act command:

1. Resolve `tabId` (active tracked tab, or the id on the envelope).
2. Read `tab.url`.
3. Run `classifyUrl(url)` from `safety-policy.ts`.
4. If `sensitive` → return `sensitive_page`. Do not inject, extract, capture, or act.
5. If the command is an **agent action** (`page/act` or scan-for-agent) and the URL is not allowlisted → return `not_allowlisted`.
6. Then forward to the content script.

---

## 7. Data stored on the device

Two Chrome storage areas. Never mix them.

### 7.1 `chrome.storage.local`

Durable, user-owned. Survives browser restart.

| Key | Contents |
| --- | --- |
| `settings` | Gemini API key, optional Groq key, `language` (`en` \| `hinglish`), `translateLanguage` (default `hi`), dry-run default, step-limit override |
| `profile` | Name, college, skills, links, preferred tone — **never** passwords |
| `skills` | Named prompt recipes; import/export as JSON file |
| `actionLogIndex` | Recent session ids (cap in `limits.ts`) |

API keys are stored only here. `.gitignore` includes `.env*`. Keys are never written into the repo, logs, action log, or prompts that get committed.

### 7.2 `chrome.storage.session`

Ephemeral across the browser session. **This is where the agent loop lives** so a sleeping service worker does not lose Approve state.

| Key | Contents |
| --- | --- |
| `pendingIntent` | `{ kind, selectionText, tabId, url, createdAt }` from context menus. Drop if older than 2 minutes |
| `agentRun` | Current task: goal, `tabId`, step index, last action map hash, last proposal, user decision pending, dry-run flag |
| `actionLog:{sessionId}` | Proposed step, reason, decision (`approved` \| `skipped` \| `stopped` \| `blocked`) |

Do **not** persist screenshot data URLs. Drop them when the answer arrives, the user cancels, or the tab changes.

### 7.3 In-memory UI state (React)

Chat transcript is keyed by `tabId` in panel memory. Switching tabs clears it. It is not a product requirement to persist chat across panel close in v1.

---

## 8. Safety architecture

Safety is a **pure module** (`src/shared/safety-policy.ts`) plus **call-site gates**. Prompts may repeat the rules; they are not the enforcement layer.

### 8.1 URL classification

`classifyUrl(url)` returns exactly one of:

- `sensitive` — block all model-bound page reads, captures, and actions.
- `allowlisted` — agent actions permitted (practice / user-owned pages).
- `normal` — read, summarise, chat, screenshot, find-it highlight allowed; **agent execution still blocked** unless the host is on the allowlist.

A URL that is both denylisted and allowlisted is **sensitive**. A bank host added to a user allowlist remains sensitive.

**Sensitive if any of the following match** (host or path, case-insensitive):

Hosts / tokens (illustrative denylist to ship in code and expand in tests):

- Banking and payments: `bank`, `banking`, `paypal`, `stripe`, `razorpay`, `paytm`, `phonepe`, `bhim`, `upi`, `netbanking`, `wallet`
- Well-known finance hosts as needed in tests (e.g. major bank domains used in the URL matrix)
- Paths: `/checkout`, `/payment`, `/pay`, `/upi`, `/netbanking`

**Default agent allowlist** (hard-coded until settings UI in the ship phase):

- `http://localhost:*`
- `http://127.0.0.1:*`

Week 4 may add a user-editable allowlist for pages the user owns. The denylist still wins.

**Private / sensitive page policy for models:** if `classifyUrl` is `sensitive`, do not send page text, HTML, screenshots, or selections to Gemini or Groq.

### 8.2 Field classification

`classifyField(el)` returns `password` | `otp` | `card` | `normal`.

Treat as protected (never type, never include value in extracts sent to models):

| Signal | Class |
| --- | --- |
| `type="password"` | `password` |
| `autocomplete` containing `one-time-code`, `otp` | `otp` |
| `name` / `id` / `autocomplete` matching `otp`, `totp`, `one-time` | `otp` |
| `autocomplete` `cc-number`, `cc-csc`, `cc-exp`, `cc-name`; name/id matching `card`, `cvv`, `cvc` | `card` |

Agent `type` actions targeting a protected field return `protected_field` and are not executed.

### 8.3 Consequential actions

`isConsequentialName(text)` is true for visible name/label/value matching (word boundaries): `Submit`, `Pay`, `Send`, `Confirm payment`, `Place order`, and close variants.

Even on an allowlisted page, these require a **second confirmation** in the panel after the normal Approve.

### 8.4 Execution gate (content script)

`page/act` is refused unless all of the following hold:

1. Worker already classified the URL as `allowlisted` (not merely `normal`).
2. Action JSON passed the parser.
3. The panel recorded an Approve for this exact proposal id.
4. Target field is not protected.
5. If consequential, a second confirm flag is set.
6. Step count `<` max steps.
7. Action type ∈ `{ click, type, select, scroll, done }`.

Dry-run mode uses `page/highlight` only. It never calls the click/type code paths.

### 8.5 Kill switch

Stop is always visible during an agent run. Stop writes `decision: stopped` to the session run, clears the pending proposal, and tells the content script to remove highlight. No further `page/act` is accepted for that run id.

---

## 9. AI layer

### 9.1 Model routing

Pin provider model id strings in `src/shared/models.ts` only. Default everyday model is Gemini **Flash-Lite**. Gemini **Flash** is for harder image / YouTube / JSON-repair tasks.

| Task | Primary | Escalate / notes | Groq fallback |
| --- | --- | --- | --- |
| Free-form ask (slice 2 plumbing) | Flash-Lite | — | Yes, text |
| Article / generic summary | Flash-Lite | — | Yes, text |
| Public YouTube summary | Flash (YouTube / file URI) | If rejected, user-facing “cannot summarise this video”; **do not scrape captions** | **No** |
| Page chat | Flash-Lite, streaming | — | Yes, text |
| Explain / Translate / Draft | Flash-Lite | — | Yes, text |
| Screenshot-and-ask | Flash vision | Cropped JPEG, longest edge ≤ 1280, quality ~0.7 | **No** |
| Find-it (element JSON) | Flash-Lite | Invalid JSON: re-ask once, then Flash once | Yes, text |
| Agent next-action JSON | Flash-Lite | Same JSON repair path | Yes, text |

Groq is skipped when the route has an image, a YouTube file URI, or a sensitive-page flag.

### 9.2 Client contract

`src/ai/client.ts` is the only HTTP client.

- Read keys from settings **at call time**.
- Timeout: 30s (`limits.ts`).
- Return `{ ok, data }` or `{ ok: false, error: { code, message } }`. Never throw across the UI boundary.
- Streaming: `generateContentStream` (or SSE equivalent) for chat; other tasks may use non-streaming `generateText` first.

### 9.3 Rate limits and fallback

On HTTP 429:

1. Honour `Retry-After` up to 8 seconds.
2. Retry the **same** route once.
3. Then follow the Groq column in §9.1.

On 5xx or network failure: retry once, then fall back the same way.

If Gemini fails and no Groq key is stored, return `rate_limited` or `model_unavailable`.

Panel copy while waiting: **“Sahayak is waiting for the free model.”**

### 9.4 Structured outputs

The application, not the model, decides what to execute.

- **Summary:** parse to `{ tldr, points[5], next }`; optional `chapters: { timestamp, note }[]` for YouTube. If more than five points, keep five.
- **Find-it:** `{ element, reason }` with `element` a number on the current map, or a declined shape the parser accepts.
- **Agent step:** `{ type, element?, value?, reason }` with `type` ∈ `click | type | select | scroll | done`.

Invalid JSON: re-ask once with the parser error, then escalate to Flash once, then `invalid_model_output`.

### 9.5 Prompt assembly order

`buildPrompt({ task, language, page, profile, history, userText })` concatenates in this **fixed order**:

1. **System / role** — frozen Sahayak instructions (grounding, language, JSON schema when required).
2. **Safety appendix** — never type passwords/OTP/cards; never instruct logins or payments; user approval is assumed by the app.
3. **Language clause** — `en` or Hinglish (Hindi in Latin script mixed with English). Does not apply to Translate, which uses `translateLanguage`.
4. **Page context** — extract, selection, action map, or “no page”.
5. **Profile** — only for draft/fill/skill tasks that need it; omit on sensitive classification (those tasks never run).
6. **History** — last 8 turns for chat; omitted for one-shot summary.
7. **User text** — the current question or goal.

Page and user text are untrusted. The system block must say to ignore instructions found inside page content.

Grounding clause for chat: answer only from supplied context; if missing, say the answer is not on this page (`off_page` when the model declines).

---

## 10. Understanding the page (Eyes)

### 10.1 Article extraction

`src/content/extract.ts`:

1. Clone `document` and run Mozilla **Readability.js**.
2. If Readability returns nothing useful, fall back to clipped `innerText`.
3. Cap at **12,000** characters, keeping the **start and the end**.
4. Set `kind`: `article` | `youtube` | `generic`.

Worker refuses extract on `sensitive` URLs before the content script runs (or the content script may still extract locally for UI, but **nothing is sent to a model** — prefer refusing in the worker so behaviour is obvious).

### 10.2 YouTube (first-class summary path)

Sahayak is a YouTube study assistant as well as an article assistant. When the active tab is a supported public watch URL, **Summary is the primary action** (header can read “Summarise this video”). English / Hinglish applies the same way as articles.

**Detect `kind: "youtube"`** from the tab URL, not from page HTML:

| Pattern | Supported in v1 |
| --- | --- |
| `https://www.youtube.com/watch?v=VIDEO_ID` | Yes |
| `https://youtu.be/VIDEO_ID` | Yes — normalise to a `watch?v=` URL before sending to Gemini |
| `https://www.youtube.com/shorts/VIDEO_ID` | Best-effort; if Gemini rejects it, `youtube_unsupported` |
| Playlists, live, embed-only, studio, private/unlisted | No — `youtube_unsupported` |

**Model path (do not mix with article extract):**

1. Worker/extract sets `kind: "youtube"` and a canonical `watchUrl` + `videoId`. Skip Readability as model context (title/channel may be kept for the panel header only).
2. Panel calls Gemini **Flash** with the public watch URL as file / media input (architecture §9.1). **No Groq fallback.**
3. Parse the same summary object as articles: `{ tldr, points[5], next }` plus `chapters: { timestamp, note }[]`.
4. Convert `mm:ss` and `h:mm:ss` to seconds (`1:02` → 62, `1:02:03` → 3722). Render each chapter as a link on the **same video id**: `https://www.youtube.com/watch?v=VIDEO_ID&t=SECONDS`. Clicking it updates the current tab (or `tabs.update`) so the player seeks.
5. If Gemini rejects the video, show `youtube_unsupported`. Do not scrape captions, timedtext, or third-party transcript services.

**Chat on a YouTube tab (slice 6+):** follow-up questions use the **same YouTube URL input** (or the structured summary + chapters as text context if a second media call is too expensive). Do not answer from comments, suggested videos, or homepage chrome. If the answer is not in the video, `off_page`.

**Agent:** `youtube.com` is `normal`, not allowlisted. Find-it/highlight may run; **Approve must not auto-play, subscribe, or comment.** YouTube is a read/summarise surface, not a practice errand.

**Skills:** Exam notes and Explain in Hinglish should run on a YouTube tab using this media path, not Readability.

### 10.3 Selection and context menus

On install, register three selection menus: **Explain this**, **Translate**, **Draft a reply**.

Flow:

1. Menu click → write `pendingIntent` to session storage → `sidePanel.open`.
2. `panel/ready` returns the intent; panel runs the matching prompt; clear the key.
3. Drop intents older than 2 minutes.
4. Render results in the **chat thread** (one result surface).
5. Explain from an already-open panel uses `page/selection` — do not build a second explain pipeline.

Translate uses `settings.translateLanguage` (default Hindi) and must **not** flip `settings.language`.

Selection text is capped at **4,000** characters (`limits.ts`).

### 10.4 Screenshot-and-ask

1. User types a question, then “Ask about this screen”.
2. Worker `capture/visible` via `chrome.tabs.captureVisibleTab` **after** URL classification.
3. Panel cropper: drag a region, or skip to use the full frame.
4. Export JPEG quality ~0.7, longest edge ≤ 1280px. Flash vision only.
5. Drop the data URL after answer, cancel, or tab change.

On sensitive URLs the capture control is hidden or returns `sensitive_page` without calling capture.

---

## 11. Acting on the page (Hands)

### 11.1 Interactive element scanner

Content script collects, in visual/tab order where practical:

- Buttons and `[role=button]`
- Links (`a[href]`)
- Inputs (except hidden/submit handled as buttons)
- Textareas
- Selects
- Checkboxes / radios
- Other obvious activatable controls (e.g. `[role=link]`, `contenteditable` if included in v1)

Each element gets a **stable number for the current page state** (scan generation). A new scan after DOM change re-numbers. The action map sent to the model is compact:

```ts
type ActionNode = {
  n: number;
  role: string;
  name: string;       // accessible name, clipped
  type?: string;      // input type
  valuePreview?: string; // never for protected fields
};
```

Badges are overlays with the number. Highlight uses the same `n`.

### 11.2 Find it for me

User asks e.g. “Where do I upload my resume?”. Panel sends the action map + question. Model returns strict JSON with the element number. Panel calls `page/highlight` only. **No click.**

### 11.3 Agent loop (one step at a time)

```
goal (user)
  → extract + scan
  → model: exactly one next action (JSON)
  → show type, n, value, one-line reason
  → wait: Approve | Skip | Stop
  → if Approve and gates pass → page/act
  → persist run in session storage
  → re-scan
  → until type=done, Stop, or max steps
```

Supported `type` values: `click`, `type`, `select`, `scroll`, `done`.

Skip: do not execute; ask the model for a *different* next action with the skipped `n` noted. Stop: end the run. Dry-run: highlight only.

**Max steps: 8** by default (`limits.ts`).

### 11.4 Persistence across service-worker sleep

The proposal the user is looking at is stored in `agentRun` (session). After Approve, the panel (not the worker’s RAM) sends `page/act` with the stored proposal id. If the worker restarted, routing still works because state is in session storage.

### 11.5 Action log

Each step: proposal, reason, decision, timestamp. Keep a bounded number of sessions (**20**). Shown in the Act tab. No screenshots, no API keys, no password values.

### 11.6 Practice errands

In-scope agent demos run on localhost practice pages, for example:

- Multi-step internship-style form filled from profile + instruction.
- Practice shop search + filters.
- Collect facts from two local pages into a small table in the panel.

These pages ship with the repo so reviewers do not need arbitrary third-party sites.

---

## 12. Errors and user-visible copy

The UI shows **one sentence per code**, not raw HTTP bodies.

| Code | Sentence |
| --- | --- |
| `missing_key` | Add your Gemini API key in Settings before Sahayak can answer. |
| `sensitive_page` | Sahayak will not read or act on this page because it looks like a private or payment page. |
| `not_allowlisted` | Browser actions only run on practice pages or sites you have allowed. |
| `protected_field` | Sahayak will not type into password, OTP, or card fields. |
| `needs_extra_confirm` | This looks like Submit, Pay, or Send. Confirm again to continue. |
| `rate_limited` | The free model is busy. Wait a moment or add a Groq key in Settings for text fallback. |
| `model_unavailable` | Sahayak could not reach the model. Check the API key and try again. |
| `invalid_model_output` | The model returned an answer Sahayak could not use. Try again. |
| `off_page` | That is not on this page. |
| `youtube_unsupported` | This video cannot be summarised. Try a public YouTube watch link. |
| `step_limit` | This task hit the step limit. Start a new run or increase the limit in Settings. |
| `timeout` | The model took too long. Try again. |
| `generic` | Something went wrong, but the side panel is still usable. |

Panel and worker map failures to these codes in `client.ts` and the router. Unknown failures become `generic`.

---

## 13. Side panel UX architecture

One shell, four primary surfaces (tabs or equivalent). Chat is the default after Week 2.

| Surface | Role |
| --- | --- |
| **Chat** | Grounded Q&A, context-menu results, screenshot Q&A, language toggle in the header |
| **Summary** | Articles **and** public YouTube: TL;DR, five points, next step; on `kind: "youtube"` also chapter notes with seek links |
| **Act** | Goal box, numbered-map status, proposal card (Approve / Skip / Stop), dry-run, action log, find-it |
| **Settings** | Gemini key, Groq key, language, translate language, profile, skills import/export, allowlist (Week 4) |

Header: active tab title, English / Hinglish toggle (`settings.language`), safety badge. On a YouTube watch tab, show a video cue (title + “YouTube”) so the user knows Summary will target the video.

Empty states: missing key, sensitive page, no selection, nothing to scan, **unsupported YouTube**.

When `kind === "youtube"`, opening the panel should land on **Summary** (or keep the user’s last tab but make Summarise this video the obvious CTA).

Streaming writes into the latest assistant bubble. On failure, keep the user message and show the error sentence.

---

## 14. Skills and profile (Week 4)

### 14.1 Profile

Local-only fields used when drafting or filling **allowlisted** forms: name, college, skills, links, preferred language, preferred tone.

Profile is appended in prompt slot 5 only for those tasks. It is never used to invent passwords.

### 14.2 One-click skills

A skill is `{ id, name, prompt, createdAt }`. Running a skill = `buildPrompt` with that prompt as `userText` plus current page extract (after safety gates).

Export / import a small JSON file from Settings. Validate schema on import; reject extra executable fields.

Starter recipes (user-editable): Exam notes; Explain in Hinglish; Reply to this email politely; Fill this form from my profile (still one-step approval for every `page/act`).

---

## 15. Limits (single source)

`src/shared/limits.ts` pins:

| Limit | Value |
| --- | --- |
| Extract characters | 12,000 (keep start + end) |
| Selection characters | 4,000 |
| Chat history | last 8 turns |
| Agent max steps | 8 |
| Model timeout | 30 seconds |
| 429 Retry-After cap | 8 seconds |
| Pending intent TTL | 2 minutes |
| Action log sessions | 20 |
| Screenshot longest edge | 1280 px |
| Screenshot JPEG quality | ~0.7 |
| JSON repair | 1 re-ask + 1 Flash escalate |

---

## 16. Build, test, and distribution

### 16.1 Tooling

- **Editor:** Cursor.
- **Stack:** Vite, React, TypeScript, `@crxjs/vite-plugin`.
- **Tests:** Vitest for `safety-policy.ts`, parsers, timestamp conversion, client retry/fallback (fake `fetch`).
- **Manual:** Load unpacked on `dist/`. Every slice that touches UI is checked in Chrome.

Scripts: `dev`, `build`, `test`.

### 16.2 Optional on-device summarisation

If the machine supports Chrome’s built-in AI, on-device article summary may be added as a Settings toggle. It is not required and must not replace the Gemini path for the core demo.

### 16.3 Packaging

- Public GitHub repo, README, screenshots, setup (Load unpacked).
- GitHub Release: zip of `dist/` (no keys).
- GitHub Pages: one-page landing.

Chrome Web Store is out of scope.

---

## 17. Build order (maps to four weeks)

Vertical slices; smallest working version on real pages before the next feature. Safety policy exists from slice 1 and gates every later read or click.

1. Extension shell + side panel + settings  
2. Gemini text call  
3. Article extraction and summary  
4. Public YouTube summary  
5. English / Hinglish toggle  
6. Grounded page chat  
7. Context-menu actions  
8. Screenshot-and-ask  
9. API error handling and fallback  
10. Interactive element scanner and badges  
11. Structured element selection (find-it)  
12. Approval-based agent loop  
13. Persistence, dry-run, step limits, action logs  
14. Local profile memory  
15. Saved skills import/export  
16. Safety rails wired through settings / allowlist UI  
17. README, release packaging, landing page  

Slice 8 (screenshot) and slice 10 (scanner) depend only on a stable shell and *may* start early; everything else stays in this order so each slice has a working caller.

Do not add autonomous multi-step execution, login flows, or a backend.

---

## 18. Decision log

| Decision | Choice | Why |
| --- | --- | --- |
| UI host | Chrome Side Panel API | Stays beside the page; matches the brief |
| Manifest | V3 service worker | Required for modern Chrome extensions |
| AI caller | Side panel | Keys never enter the content script |
| Default model | Gemini Flash-Lite | Free-tier everyday text |
| Stronger model | Gemini Flash | Vision, YouTube, JSON repair |
| Fallback | Groq, text only | Survive 429 without a backend |
| Article extract | Readability.js | Strips chrome/ads better than raw `innerText` |
| YouTube | Gemini public URL input | No caption scraper in scope |
| Agent representation | Numbered action map | Cheap, structured, better than HTML |
| Agent control | One JSON action + Approve | User remains in charge |
| Agent sites | Localhost allowlist by default | Avoid acting on arbitrary third-party sites |
| Safety | Pure policy module + worker gates | Deterministic; testable without Chrome |
| Agent persistence | `chrome.storage.session` | MV3 workers sleep |
| Distribution | GitHub Release ZIP | No store listing in four weeks |
| Language | `en` / Hinglish toggle; Translate uses a separate setting | Output language ≠ translation target |

---

## 19. Success picture

A new user loads the Release ZIP, pastes their own Gemini key in Settings, opens the side panel on a supported page, and can summarise an article **or a public YouTube video** (chapters jump to timestamps), switch English/Hinglish, chat on-page or about that video, use Explain/Translate/Draft, ask about a cropped screenshot, find a numbered control, run a practice errand with Approve on every step, inspect the action log, reuse profile and a skill, and see sensitive pages/fields blocked by code.

Sahayak reads, explains, sees, remembers, and acts — and the user remains in control of every consequential step.
