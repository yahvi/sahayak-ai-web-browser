# Sahayak Implementation Plan

This plan turns `docs/problemstatement.md` and `docs/architecture.md` into build phases. Work **one slice at a time**. A slice is done only when it runs in Chrome under **Load unpacked** and the checks in this document pass.

The four phases match the four-week spec. The slices inside them match architecture §17. Safety code starts in Phase 1 as a pure module and gates every later path that reads a page or clicks.

Keys: [Google AI Studio](https://aistudio.google.com/) (Gemini) and optionally [Groq](https://groq.com/). Store them in extension Settings (`chrome.storage.local`), not in source.

---

## How to use this plan

1. Finish the current slice before starting the next.
2. Keep the **side panel as the only caller** of Gemini and Groq. The content script never sees the API key.
3. Persist approval state in `chrome.storage.session`. Do not leave it in service-worker memory.
4. When a slice touches the panel UI, exercise it in Chrome: open the panel, run the action, and check the empty and error states listed for that slice.
5. Add the unit tests named in the slice in the **same change** as the code they lock down.
6. Do not build later features early. In particular, do not add autonomous multi-step execution, login flows, or a backend.

Definition of done for the whole project is problem statement §9. Each phase has its own exit list below.

---

## Phase map

| Phase | Week | Outcome | Slices |
| --- | --- | --- | --- |
| 1. Eyes | Week 1 | Extension loads, summarises **articles and public YouTube videos**, switches English / Hinglish | 1–5 |
| 2. Brain | Week 2 | Grounded chat, context-menu actions, screenshot questions, rate-limit fallback | 6–9 |
| 3. Hands | Week 3 | Numbered action map, find-it, approval loop, persistence, practice errands | 10–13 |
| 4. Memory and ship | Week 4 | Profile, skills, full safety wiring, README, zip, landing page | 14–17 |

Slice 8 (screenshot) and slice 10 (scanner) depend only on a stable shell, so they *may* start once slice 1 is stable. Everything else stays in the order below so each slice has a working caller.

```
Phase 1 Eyes → Phase 2 Brain → Phase 3 Hands → Phase 4 Ship
```

---

## Shared foundations

These files exist from slice 1 and grow in place. Later slices fill functions; they do not invent a second protocol.

| File | Created | Responsibility |
| --- | --- | --- |
| `manifest.json` | Slice 1 | MV3 surface from architecture §5 |
| `src/shared/protocol.ts` | Slice 1 | Envelope, command names, record types |
| `src/shared/storage.ts` | Slice 1 | local and session getters/setters |
| `src/shared/limits.ts` | Slice 1 | Caps: 12k extract, 4k selection, 8 steps, 30s timeout, 20 log sessions |
| `src/shared/youtube.ts` | Slice 4 | Watch URL detect, `videoId`, timestamp → seconds |
| `src/shared/safety-policy.ts` | Slice 1 | URL class, field class, consequential names. Pure, no Chrome APIs |
| `src/shared/models.ts` | Slice 2 | Task to model route |
| `src/ai/client.ts` | Slice 2 | One HTTP client for Gemini and Groq |
| `src/ai/prompts.ts` | Slice 2 | Prompt assembly order from architecture §9.5 |
| `src/ai/parse.ts` | Slice 3 | Summary, find-it, and agent JSON parsers |
| `src/background/messaging.ts` | Slice 1 | Panel → worker → content router |
| `src/content/index.ts` | Slice 3 | Content-script dispatcher |

Default agent allowlist, hard-coded until the settings UI in slice 16:

- `http://localhost:*`
- `http://127.0.0.1:*`

A sensitive host stays blocked even if it is later added to the allowlist.

Error sentences for the panel are architecture §12. Do not show raw HTTP bodies.

---

## Phase 1 — The Eyes (Week 1)

The user can load the extension, open the side panel, save a Gemini key, summarise an article, **summarise the public YouTube video in the current tab** (TL;DR, five points, next step, clickable chapters), and switch the output language. YouTube is a core Week 1 product path, not a stretch goal.

### Slice 1 — Extension shell, panel, settings

**Outcome.** Chrome loads the unpacked build. The toolbar icon opens the side panel. Settings save a Gemini key in `chrome.storage.local`.

**Create**

- `package.json`, `vite.config.ts`, `tsconfig.json`
- `manifest.json` with the permissions in architecture §5.1
- `src/background/index.ts` — install handler, `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`
- `src/background/messaging.ts` — `panel/ready`, `tab/getActive`
- `src/background/tab-tracker.ts` — active tab id, url, title
- `src/sidepanel/index.html`, `main.tsx`, `app.tsx`
- `src/sidepanel/components/settings.tsx` — Gemini key, optional Groq key
- `src/shared/protocol.ts`, `storage.ts`, `limits.ts`, `safety-policy.ts`
- `.gitignore` including `dist/`, `node_modules/`, `.env*`
- `assets/` icons referenced by the manifest

**Steps**

1. Scaffold Vite + React + TypeScript + `@crxjs/vite-plugin`. Scripts: `dev`, `build`, `test`.
2. Register the side panel and the empty content-script entry so the manifest is valid. The content script can no-op until slice 3.
3. On panel load, send `panel/ready` and `tab/getActive`. Show the active tab title in the header.
4. Settings form reads and writes settings. Empty key shows the missing-key empty state and does not call the network.
5. Add `safety-policy.ts` with `classifyUrl(url)` returning `sensitive`, `allowlisted`, or `normal`, plus `classifyField` and `isConsequentialName`. Ship the denylist and field rules from architecture §8. No UI yet.
6. Add Vitest and the policy tests below.

**Tests**

- URL matrix: a bank host, a `/checkout` path, `http://127.0.0.1:4173/apply.html`, a normal news URL.
- A bank host that was added to a user allowlist is still sensitive.
- Field fixtures: `type=password`, `autocomplete=one-time-code`, `autocomplete=cc-number`, name `otp`, a plain text input.
- Consequential names: Submit, Pay, Send, and a harmless “Next”.

**Chrome check**

- `npm run dev`, Load unpacked on `dist/`.
- Icon opens the panel beside a normal page and shows that page's title.
- Reload the panel and confirm the key is still there.
- Confirm the key is absent from the repo.

**Stop.** Do not call Gemini in this slice.

---

### Slice 2 — First Gemini text call

**Outcome.** With a key saved, a text box in the panel sends a prompt to Flash-Lite and renders the reply.

**Create**

- `src/shared/models.ts` — routes from architecture §9.1. Pin model id strings in this file only.
- `src/ai/client.ts` — non-streaming `generateText` first. Read the key from settings at call time. 30s timeout. Return `{ ok, data }` or `{ ok: false, error: { code, message } }`.
- `src/ai/prompts.ts` — `buildPrompt({ task, language, page, profile, history, userText })`. Language and grounding clauses can be stubs until slices 5 and 6.
- `src/sidepanel/components/ask-box.tsx` — temporary until chat replaces it in slice 6.

**Steps**

1. Implement Gemini `generateContent` for text. No Groq yet.
2. Map missing key to `missing_key`, HTTP errors to `model_unavailable`. Show the sentence from architecture §12, not the raw body.
3. Wire the ask box. This is the plumbing test, not the grounded chat feature.

**Chrome check**

- Save a key, ask a short question, see a reply in the panel.
- Clear the key, ask again, see the settings prompt and no request.

API keys belong in Settings. Do not commit `.env` files. If a local `.env` is used only for developer convenience, it must stay gitignored and must not be the runtime path for the packed extension.

---

### Slice 3 — Article extraction and structured summary

**Outcome.** On a normal article, Summary shows a one-line TL;DR, five key points, and a next step.

**Create**

- `src/content/extract.ts` — Readability on a cloned document; fallback to clipped `innerText`; `kind` is `article`, `youtube`, or `generic`
- `src/content/index.ts` — handle `page/extract`
- `src/ai/parse.ts` — `parseSummary`
- `src/sidepanel/components/summary.tsx`
- Summary mode in the panel tabs (Chat and Act can be disabled placeholders)

**Steps**

1. Worker forwards `page/extract` only after `classifyUrl`. Sensitive URLs return `sensitive_page` and do not call the model.
2. Cap extracted text at 12,000 characters, keeping the start and the end.
3. Detect YouTube watch URLs and set `kind: "youtube"` without sending the transcript anywhere yet. Do not summarise a YouTube tab as if it were an article (that is slice 4).
4. Call Flash-Lite with the summary schema. Parse before render. If the model returns more than five points, keep five.
5. If Readability returns nothing, still summarise the generic extract and label it as a generic page.

**Tests**

- `parseSummary` accepts a valid object and rejects missing `tldr`.
- Extract truncation keeps both ends. Use a fixture string in unit tests; DOM extraction is checked manually.

**Chrome check**

- Summarise a news article. Navigation, ads, and footer text should not dominate the points.
- Open a sensitive URL, run Summary, and confirm the blocked message. Do not verify by watching the network only; the panel must show `sensitive_page`.

---

### Slice 4 — Public YouTube video summary

**Outcome.** With a **public YouTube watch tab** open, the user clicks Summarise this video and gets the same structure as an article (TL;DR, five points, what to do next) **plus chapter-style notes**. Each timestamp seeks the player on that video. This is a required Week 1 feature.

**Create**

- `src/shared/youtube.ts` — detect watch / `youtu.be` URLs, parse `videoId`, canonical `watch?v=` URL, `timestampToSeconds`
- `src/ai/client.ts` — Gemini Flash generate with YouTube / file URI (no Groq)
- Summary UI: video header, chapter list, seek links

**Steps**

1. Detect `kind: "youtube"` from the **tab URL** (`youtube.com/watch?v=`, `youtu.be/`). Normalise `youtu.be` to `https://www.youtube.com/watch?v=VIDEO_ID` before the model call.
2. Skip Readability text as the model context. Send the canonical watch URL as Gemini file / media input on the **Flash** route from `models.ts` (architecture §10.2).
3. Extend `parseSummary` with optional `chapters: { timestamp, note }[]`. Keep five key points max.
4. Convert `mm:ss` and `h:mm:ss` into `&t=` seconds on the **same** `videoId`. Clicking a chapter calls `tabs.update` (or equivalent) so the current tab seeks.
5. Language from `settings.language` (English / Hinglish) is included in the summary prompt.
6. If Gemini rejects the video (private, live, unsupported), show `youtube_unsupported`. **Do not** scrape captions, timedtext, or any transcript API.
7. Playlists, YouTube homepage, and Studio are not videos: show a clear empty state, not a fake article summary from the sidebar.

**Tests**

- URL detect: watch URL and `youtu.be` → `videoId`; a news URL is not YouTube.
- Timestamp conversion: `1:02` → 62, `1:02:03` → 3722.
- A non-YouTube summary does not render a chapter list.

**Chrome check**

- Open a **public** lecture or explainer on youtube.com, open the panel, summarise: TL;DR + five points + at least one chapter link that jumps the video.
- Repeat in Hinglish after slice 5 (or use a stub language clause here if slice 5 is not done).
- An unlisted/private or non-watch YouTube URL: `youtube_unsupported`, panel still usable.
- Confirm the request used the watch URL, not a dump of comments/HTML.

---

### Slice 5 — English / Hinglish toggle

**Outcome.** The header toggle sets `settings.language`. The next summary uses that language. Older messages stay as rendered.

**Steps**

1. Add the toggle. Values: `en`, `hinglish`.
2. Thread language through `buildPrompt`. Hinglish means Hindi in Latin script mixed with English.
3. Re-run summary after a toggle and confirm the new reply follows the new language.

**Chrome check**

- Summarise the same article in both languages.
- Summarise the same public YouTube video in both languages.
- Reload the panel and confirm the choice persisted.

---

### Phase 1 exit

Week 1 acceptance in the problem statement is met:

- Unpacked load works.
- Side panel opens beside a normal page.
- Key is entered in settings, not hard-coded.
- Article summary has TL;DR, five points, and a next step.
- A public YouTube **watch tab** summarises (TL;DR, five points, next step) with timestamp links when chapters exist.
- English / Hinglish switching works for **both** articles and YouTube.

Selected-text explain is completed in **slice 7**, which is the first Week 2 slice that needs the chat surface. If Phase 1 must demo explain before Phase 2 starts, point the slice 2 ask box at `page/selection` as a temporary path and replace it in slice 7. **Do not build a second explain pipeline.**

Optional stretch (not required): Chrome built-in on-device article summarisation behind a Settings toggle. Must not replace the Gemini path.

---

## Phase 2 — The Brain (Week 2)

The panel can chat with the current page **or the public YouTube video in the tab**, act on a selection from the context menu, answer a question about a cropped screenshot, and survive model errors.

### Slice 6 — Grounded page chat

**Outcome.** Chat answers from the current page, says when the answer is not on the page, keeps history for the active tab, and streams tokens.

**Create**

- `src/sidepanel/components/chat.tsx`
- Streaming method on `ai/client.ts` (`generateContentStream` or equivalent SSE)

**Steps**

1. Replace the slice 2 ask box with the chat composer.
2. On each send, refresh `page/extract`. Refuse sensitive URLs before the stream starts. If `kind === "youtube"`, ground chat in the YouTube media URL (or the last structured video summary), not comments or homepage chrome.
3. Assemble prompts in the order from architecture §9.5. Cap history at the last 8 turns.
4. Store the transcript in React state keyed by `tabId`. A tab change clears it and shows the new title.
5. System prompt: answer only from the supplied context; if it is missing, say the answer is not on this page. Surface that as `off_page` when the model declines.
6. Stream into the latest assistant bubble. On failure, leave the user message in place and show the error code's sentence.

**Chrome check**

- Ask something answered by the article. The reply matches the page.
- Ask something absent from the page. The reply says it is not on the page.
- On a summarised YouTube tab, ask a follow-up about the video; the reply stays on the video. Ask something not in the video; `off_page`.
- Switch tabs. The transcript resets.
- Start a stream and confirm tokens appear before the full reply finishes.

---

### Slice 7 — Context-menu actions

**Outcome.** Selecting text and choosing Explain this, Translate, or Draft a reply opens the panel and shows the result.

**Create**

- `src/background/context-menus.ts`
- `src/content/selection.ts` — `page/selection` for the panel's own explain path
- Pending-intent helpers in `storage.ts`

**Steps**

1. Create three selection context menus on install.
2. On click, write `pendingIntent` (`kind`, `selectionText`, `tabId`, `url`, `createdAt`) to `chrome.storage.session`, then open the side panel.
3. `panel/ready` returns the intent. The panel runs the matching prompt and clears the key. Drop intents older than 2 minutes.
4. Explain simplifies the selection. Translate uses `settings.translateLanguage` (default `hi`) and does not change `settings.language`. Draft a reply writes a reply in the active output language.
5. Render results in the chat thread so there is one result surface.
6. Also support Explain from the panel using `page/selection` when the user has a selection and the panel is already open.
7. Cap selection at 4,000 characters. Sensitive URLs: no model call.

**Chrome check**

- Each menu item, with the panel closed, opens the panel and shows a result.
- Translate stays on the translate language after the global toggle is flipped to the other output language.
- A sensitive page selection does not produce a model call.

---

### Slice 8 — Screenshot and ask

**Outcome.** The user captures the visible tab, crops a region, asks a question, and gets an answer about that image.

**Create**

- `src/sidepanel/components/cropper.tsx`

**Steps**

1. Add “Ask about this screen” on Chat. The question can be typed before capture.
2. Worker handles `capture/visible` via `chrome.tabs.captureVisibleTab`. Refuse sensitive URLs before capture.
3. Draw the PNG on a canvas. A drag sets the crop. Skip uses the full frame.
4. Export JPEG at quality about 0.7 with the longest edge at most 1280px. Send it on the Flash vision route. No Groq path.
5. Drop the data URL when the answer arrives, the user cancels, or the tab changes. Do not write it to storage or the action log.

**Chrome check**

- Crop a chart or error message and ask a question that needs the pixels.
- Cancel the crop and confirm nothing is sent.
- On a sensitive URL the capture button is hidden or the click returns `sensitive_page` without a capture call.

---

### Slice 9 — Errors, retry, and fallback

**Outcome.** HTTP 429 and 5xx do not crash the panel. Text tasks fall back to Groq. Image and YouTube tasks show a clear error instead.

**Steps**

1. In `ai/client.ts`: on 429, honour `Retry-After` up to 8 seconds, retry the same route once, then follow the fallback column in architecture §9.1.
2. On 5xx or network failure, retry once, then fall back.
3. Groq is text-only. Skip it when the route has an image, a YouTube file URI, or a sensitive-page flag.
4. Optional Groq key in settings. If Gemini fails and no Groq key is stored, return `rate_limited` or `model_unavailable`.
5. Panel copy while waiting: “Sahayak is waiting for the free model.”
6. Invalid JSON is not handled here except for a client hook used in slice 11: re-ask once with the parser error, then escalate to Flash once.

**Tests**

- A fake `fetch` that returns 429 then 200 calls the primary twice and not Groq.
- A fake `fetch` that returns 429 twice calls Groq for a text task and does not call Groq for an image task.

**Chrome check**

- Force a bad key and confirm the panel shows `model_unavailable` and still accepts a new prompt.
- With a Groq key saved, confirm a text fallback path is wired (use a temporary forced-fallback flag in dev only, and remove it before release).

---

### Phase 2 exit

- Chat stays on the page and admits missing answers.
- Explain, Translate, and Draft a reply work from the context menu.
- A cropped screenshot question returns an answer.
- Rate limits and model errors do not crash the extension.

---

## Phase 3 — The Hands (Week 3)

Sahayak can see numbered interactive elements, point at one, and execute a single approved action. No click happens before Approve. Agent demos run on localhost practice pages.

### Slice 10 — Interactive element scanner and badges

**Outcome.** On a supported page, interactive controls receive stable numbers for the current scan, badges overlay them, and the panel shows a compact action map.

**Create**

- `src/content/scan.ts` — collect buttons, links, inputs, textareas, selects, checkboxes/radios, `[role=button]` / `[role=link]`
- `src/content/overlay.ts` — numbered badges with a Sahayak prefix so they are excluded from later scans
- `src/content/index.ts` — handle `page/scan` and `page/highlight`
- `src/sidepanel/components/action-map.tsx` — compact list in the Act tab
- Practice pages under `src/practice/` or `practice/` served locally (form + shop stubs can be empty shells until slice 13)

**Steps**

1. Enable the Act tab as a visible surface (goal box can wait until slice 12).
2. Worker forwards `page/scan` after `classifyUrl`. Sensitive → `sensitive_page`. Scan for display is allowed on `normal` pages; **execution** still requires allowlist (slice 12).
3. Assign `n` in visual/tab order for this scan generation. Re-scan re-numbers.
4. Build `ActionNode[]` from architecture §11.1. Never put protected-field values in `valuePreview`.
5. `page/highlight` scrolls the element into view and outlines it. No click.
6. Hidden, disabled, and zero-size controls are skipped.

**Tests**

- Fixture HTML: one of each control type is numbered; `type=password` is present in the map but marked protected and has no value preview.
- Overlay nodes with the Sahayak prefix are not counted as interactive elements.

**Chrome check**

- Open a dense page (or the practice form). Badges appear and match the panel list.
- Highlight from the panel focuses the matching control.
- Sensitive URL: scan is refused with the blocked sentence.

---

### Slice 11 — Find it for me (structured element selection)

**Outcome.** A natural-language question such as “Where do I upload my resume?” returns strict JSON, highlights that number, and does not click.

**Create**

- `parseFindIt` in `src/ai/parse.ts`
- Find-it composer on the Act tab (or Chat, if it forwards to Act highlight)

**Steps**

1. Refresh `page/scan`, send the compact map + question to Flash-Lite with a JSON schema `{ element, reason }`.
2. Validate `element` is an integer present on the **current** map. Otherwise `invalid_model_output`.
3. JSON repair hook from slice 9: re-ask once with the parser error, then escalate to Flash once.
4. On success, `page/highlight` only.

**Tests**

- Valid `{ element: 3, reason: "..." }` accepted.
- Missing `element`, non-integer, or `element` not in the map rejected.
- Repair: first response invalid, second valid → one re-ask, then success.

**Chrome check**

- On the practice form, ask where to upload a resume (or the labelled file input). The correct badge highlights.
- Ask for something that does not exist. The panel says it is not on this page / cannot find it, and nothing is clicked.

---

### Slice 12 — Approval-based agent loop

**Outcome.** The user gives a goal. Sahayak proposes exactly one next action as JSON. Nothing executes until Approve. Skip asks for a different action. Stop ends the run.

**Create**

- `src/ai/parse.ts` — `parseAgentStep` for `{ type, element?, value?, reason }` with `type` ∈ `click | type | select | scroll | done`
- `src/content/act.ts` — execute one action by `n`
- `src/sidepanel/components/proposal.tsx` — type, target, value, reason, Approve / Skip / Stop
- `src/sidepanel/components/agent.tsx` — goal box, run state
- Worker: `page/act` only after allowlist + recorded approval id

**Steps**

1. Loop from architecture §11.3: extract + scan → model → show proposal → wait → maybe `page/act` → persist → repeat.
2. `page/act` is refused unless every gate in architecture §8.4 holds. Dry-run can wait until slice 13; in this slice, Approve must still be required.
3. `type` on a protected field returns `protected_field` and is not executed.
4. Consequential names require a second confirm (`needs_extra_confirm`) after Approve.
5. `done` ends the run without a DOM action.
6. Cap at 8 steps (`limits.ts`). Hitting the cap shows `step_limit`.
7. Non-allowlisted `normal` pages: propose/find-it/highlight may work; **Approve → `page/act` returns `not_allowlisted`.**

**Tests**

- Parser accepts `click` with `element`, `type` with `value`, `done` without element; rejects unknown `type` and missing `reason`.
- Policy: password field never receives a type action even if JSON asks for it.

**Chrome check**

- On `http://127.0.0.1` practice form: type a short goal, see a proposal, Approve, watch one field fill or one click. Repeat.
- Skip: the skipped `n` is not executed; a new proposal appears.
- Stop: no further acts for that run.
- On a news article (not allowlisted): Approve does not click; panel shows `not_allowlisted`.
- Confirm **no action runs if the user never presses Approve**.

---

### Slice 13 — Persistence, dry-run, logs, practice errands

**Outcome.** A paused approval survives service-worker sleep. Dry-run highlights only. The Act tab shows an action log. At least two practice errands complete with approval at every step.

**Create**

- Session helpers for `agentRun` and `actionLog:{sessionId}` (architecture §7.2)
- Dry-run toggle on Act (default from settings)
- `src/practice/` pages, served so they match the allowlist:
  1. **Apply** — multi-step internship-style form (name, college, skills, file-looking input, Submit)
  2. **Shop** — search + filter + result list
  3. Optional **Collect** — two local pages with facts to gather into a panel table
- Script or README snippet: `npx serve practice` or Vite multi-page so URLs are `http://127.0.0.1:<port>/...`

**Steps**

1. Write `agentRun` on every proposal and every decision. After worker restart, the panel still shows the same pending proposal and Approve still sends that `proposalId`.
2. Dry-run: Approve calls `page/highlight` only, logs `dry_run`, never `click`/`type`.
3. Log: proposal, reason, decision (`approved` | `skipped` | `stopped` | `blocked`), timestamp. Cap 20 sessions. No screenshots, keys, or password values.
4. Kill switch remains visible for the whole run (architecture §8.5).
5. Complete two errands on the practice pages with a real Gemini key and Approve on every step.

**Tests**

- Serialising `agentRun` round-trips proposal id and step index.
- Log index evicts past 20 sessions.

**Chrome check**

- Start a run, wait until the service worker is inactive (or reload the extension), reopen the panel: pending Approve is still there; approving executes the stored step (unless dry-run).
- Dry-run: badges highlight, form fields stay empty.
- Action log shows proposed steps and decisions after Skip/Stop/Approve.
- Apply errand and Shop errand both finish with `done` or a clear stop, never more than 8 unsupervised steps (each step still approved).

---

### Phase 3 exit

Week 3 acceptance:

- Interactive elements are detected and numbered on supported pages.
- Find-it highlights the right control from a natural-language request.
- Next action is strict JSON.
- No browser action before user approval.
- Approve, Skip, Stop, step limit, and dry-run work.
- Agent survives service-worker sleep via session storage.
- Action log is preserved for the task.
- At least two practice errands complete with approval at every step.

---

## Phase 4 — Memory, safety, and shipping (Week 4)

Sahayak becomes personal, reusable, fully gated, and installable by another user from GitHub.

### Slice 14 — Local profile memory

**Outcome.** The user stores name, college, skills, links, preferred language, and tone on the device. Drafts and allowlisted form-fills can use it.

**Create**

- Profile fields in `chrome.storage.local` via `storage.ts`
- `src/sidepanel/components/profile.tsx` in Settings

**Steps**

1. Form read/write profile. Never include password fields.
2. `buildPrompt` slot 5 (architecture §9.5) includes profile only for draft, fill, and matching skills — and never when the URL is `sensitive`.
3. On the practice Apply page, a fill goal may propose typing profile values; the user still Approves each step.

**Chrome check**

- Save profile, reload the panel, values remain.
- Draft a reply uses name/tone when relevant.
- Sensitive page: profile is not sent (blocked before the model).

---

### Slice 15 — One-click skills

**Outcome.** The user saves, runs, exports, and imports prompt recipes.

**Create**

- Skills list in Settings and a one-click row on Chat/Act
- Schema `{ id, name, prompt, createdAt }`
- Export/import JSON file picker

**Steps**

1. Ship starter skills: Exam notes; Explain in Hinglish; Reply to this email politely; Fill this form from my profile.
2. Running a skill = current page extract (after safety) + skill prompt as `userText`. On `kind: "youtube"`, Exam notes / Explain in Hinglish use the YouTube media path, not Readability. Fill-form still uses the slice 12 loop (one Approve per act).
3. Validate import; reject unknown executable fields.
4. Skills stay in `chrome.storage.local`.

**Chrome check**

- Create a custom skill, run it on an article, see the result in chat.
- Export, clear, import, list matches.
- Fill-from-profile skill on practice Apply still requires Approve per step.

---

### Slice 16 — Safety rails wired through UI

**Outcome.** Denylist, protected fields, extra confirm, kill switch, and allowlist are visible and enforced. Keys never appear in git.

**Steps**

1. Settings: optional extra allowlist hosts (user-owned pages). Denylist still wins (architecture §8.1).
2. Header safety badge on `sensitive` URLs. Hide capture and disable Act execution.
3. Confirm that `page/extract`, `capture/visible`, `page/selection`, and `page/act` all go through worker `classifyUrl`.
4. Extra confirm UI for Submit / Pay / Send on allowlisted pages.
5. Audit: API keys only in `chrome.storage.local`; `.gitignore` covers `.env*`; README says paste keys in Settings.
6. Remove any slice 9 forced-fallback debug flag.

**Tests**

- Allowlist + bank host → still `sensitive`.
- `http://127.0.0.1` Apply Submit button → `isConsequentialName` true.
- OTP/card fixtures still protected.

**Chrome check**

- Banking or `/checkout` URL: summary, chat, screenshot, and act all show `sensitive_page`.
- Practice form Submit: Approve then extra confirm before click.
- Password field: model may propose type; execution is blocked with `protected_field`.
- Stop during a run: no further acts.

---

### Slice 17 — README, release ZIP, landing page

**Outcome.** Another student can install Sahayak from GitHub without reading the source.

**Create**

- `README.md` — what it is, Load unpacked, where to get Gemini/Groq keys, English/Hinglish, safety limits, out of scope
- Screenshots: panel on an article, **YouTube video summary with chapter timestamps**, chat, badges, proposal card, settings
- `scripts/` or `package.json` `zip` that packs `dist/` without `node_modules` or keys
- `docs/` or `site/` GitHub Pages one-pager (problem, install, 30-second demo)
- Practice-page how-to in README

**Steps**

1. `npm run build` produces a clean `dist/`.
2. GitHub Release contains the ZIP. Tag matches the README.
3. Pages site is a single page; no keys, no tracking required.
4. Walk the definition of done (problem statement §9) once on a clean Chrome profile.

**Chrome check (clean profile)**

- Install from the ZIP (Load unpacked).
- Enter a Gemini key in Settings.
- Summarise an article **and** a public YouTube watch page (chapters seek); toggle language; chat (including a video follow-up); Explain/Translate/Draft; screenshot question; find-it; one practice errand with Approve; action log; profile + skill; confirm a sensitive URL is blocked.

---

### Phase 4 exit

Week 4 acceptance:

- User profile memory works locally.
- Saved skills can be created, reused, exported, and imported.
- Restricted pages and protected fields are blocked in code.
- Consequential actions require extra confirmation.
- API key is not committed.
- Another user can install from the release package.
- Setup and usage documentation exist.
- A simple public landing page exists.

---

## Manual testing loop (every slice that touches UI)

1. `npm run dev` or `npm run build`, then **Load unpacked** on `dist/` (reload the extension after each build).
2. Open a normal page, open the side panel from the toolbar icon.
3. Run the slice’s Chrome check, including empty and error states.
4. Paste failures back into Cursor and fix them in the **current slice** before starting the next.

Do not treat a single screenshot of the panel as verification. Click, type, and confirm behaviour.

---

## Explicitly out of scope (do not schedule)

- Chrome on Android or iPhone
- Autonomous execution without user approval
- Banking, payment, login, or OTP automation
- Typing passwords or card information
- Sending private email, banking, or personal-document pages to a free-tier model
- Acting on arbitrary third-party sites for risky workflows
- Chrome Web Store publication
- A Sahayak backend or proxy

---

## Suggested Cursor prompts after this document

Use these in order. Do not skip slice checks.

1. Implement slice 1 of Phase 1 using `@docs/implementation-plan.md`
2. Implement slice 2 of Phase 1 (API key in Settings, not in git)
3. Implement slice 3 of Phase 1
4. Manual test in Chrome; paste errors and fix
5. Implement slices 4 and 5
6. Implement slice 6 of Phase 2, then 7, then 8, then 9
7. Implement slices 10–13 of Phase 3
8. Implement slices 14–17 of Phase 4

Next spec to generate: `docs/edge-case.md` from this plan (corner scenarios per slice).
