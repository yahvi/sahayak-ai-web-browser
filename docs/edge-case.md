# Sahayak Edge Cases

Corner scenarios for implementing `docs/implementation-plan.md`, grounded in `docs/architecture.md`. Use this while coding and during each slice’s Chrome check.

**How to use**

- Treat each case as a required behaviour, not a nice-to-have.
- Prefer failing closed (refuse, show an error code sentence, stay usable) over guessing.
- Error codes and panel sentences are architecture §12. Never show raw HTTP bodies.
- Safety is enforced in TypeScript (`safety-policy.ts` + worker gates), not by prompt text alone.

---

## Cross-cutting (every phase)

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| X1 | No Gemini key in Settings | `missing_key`; no network call; panel still usable |
| X2 | Empty / whitespace-only API key | Same as missing key |
| X3 | Invalid or revoked Gemini key | `model_unavailable`; composer accepts a new prompt |
| X4 | Model call exceeds 30s | `timeout`; UI recovers |
| X5 | Both Gemini and Groq unavailable | Clear error; panel does not crash |
| X6 | Active tab has no URL / `chrome://` / extension page | Safe empty or refuse; do not crash messaging |
| X7 | Content script not injected yet (fresh navigation) | Worker injects or retries; user sees a clear failure, not a hang |
| X8 | User switches tabs mid-request | Drop in-flight screenshot data; reset chat for new `tabId`; do not apply results to the wrong tab |
| X9 | Service worker sleeps mid-flow | Agent/approval state survives via `chrome.storage.session`; keys/settings via `local` |
| X10 | Page content contains “ignore previous instructions…” | Treat as untrusted data; system/policy block still wins (architecture §9.5) |
| X11 | Sensitive URL on any read/act path | `sensitive_page` before extract, selection, capture, or act; no model call |
| X12 | Raw model/HTTP error body | Map to a code; show only the §12 sentence |
| X13 | Panel reloads while a stream or agent run is open | Stream may abort cleanly; pending agent proposal still readable from session storage |
| X14 | Multiple rapid clicks on Summarise / Send / Approve | Debounce or ignore duplicates; one proposal / one act per approval |

---

## Phase 1 — The Eyes

### Slice 1 — Shell, panel, settings, safety policy

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| 1.1 | Load unpacked on clean `dist/` | Extension loads; icon opens side panel |
| 1.2 | Panel open with no key saved | Missing-key empty state; no Gemini request |
| 1.3 | Save key, reload panel | Key still present in Settings (`chrome.storage.local`) |
| 1.4 | Key appears in repo / committed `.env` | Must not; `.gitignore` covers `.env*` |
| 1.5 | Active tab title missing or very long | Header still renders; truncate gracefully |
| 1.6 | Bank host URL | `classifyUrl` → `sensitive` |
| 1.7 | Path contains `/checkout`, `/payment`, `/pay`, `/upi`, `/netbanking` | `sensitive` even on an otherwise normal host |
| 1.8 | `http://127.0.0.1:4173/apply.html` | `allowlisted` (default allowlist) |
| 1.9 | Normal news URL | `normal` |
| 1.10 | Bank host added to a user allowlist | Still `sensitive` (denylist wins) |
| 1.11 | Host matches denylist token case-insensitively (`PayPal`, `NETBANKING`) | `sensitive` |
| 1.12 | `type=password` field | `classifyField` → `password` |
| 1.13 | `autocomplete=one-time-code` / name `otp` | `otp` |
| 1.14 | `autocomplete=cc-number` / cvv-like name | `card` |
| 1.15 | Plain text input | `normal` |
| 1.16 | Button labelled Submit / Pay / Send | `isConsequentialName` true |
| 1.17 | Harmless “Next” | Not consequential |
| 1.18 | `panel/ready` when no pending intent | Handshake succeeds; no stale intent |

### Slice 2 — First Gemini text call

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| 2.1 | Valid key + short question | Reply renders in panel |
| 2.2 | Clear key then ask | `missing_key`; zero outbound requests |
| 2.3 | HTTP 4xx/5xx from Gemini | `model_unavailable` (or mapped code); no crash |
| 2.4 | Network offline | Mapped error; panel stays usable |
| 2.5 | Extremely long user prompt | Cap or send clipped; do not freeze UI |
| 2.6 | Key read at call time after Settings change | New key used without requiring extension reload |

### Slice 3 — Article extraction and structured summary

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| 3.1 | Dense news article with ads/nav/footer | Points come from article body, not chrome |
| 3.2 | Readability returns nothing useful | Fallback to clipped `innerText`; `kind: "generic"`; still summarise |
| 3.3 | Extract longer than 12,000 characters | Keep start **and** end; middle clipped |
| 3.4 | Model returns more than five points | Keep five only |
| 3.5 | Model omits `tldr` | `parseSummary` rejects → `invalid_model_output` (or repair path once later slices exist) |
| 3.6 | Sensitive URL + Summary | `sensitive_page`; no model call |
| 3.7 | YouTube watch tab before slice 4 path is complete | Detect `kind: "youtube"`; **do not** summarise as an article via Readability |
| 3.8 | Empty / nearly empty page | Clear empty state; no invented summary |
| 3.9 | SPA that hydrates after load | Extract may be thin; user can re-run Summary after content appears |
| 3.10 | PDF / image-only tab | Generic/empty behaviour; do not crash |
| 3.11 | Non-HTML download URL | Refuse gracefully |

### Slice 4 — Public YouTube video summary

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| 4.1 | Public `youtube.com/watch?v=` | Structured summary; optional chapters; seek works |
| 4.2 | `youtu.be/VIDEO_ID` | Normalise to `watch?v=` before Gemini call |
| 4.3 | Chapter `1:02` / `1:02:03` | Seek `t=62` / `t=3722` on **same** `videoId` |
| 4.4 | Chapter timestamps with wrong or missing video id | Never seek a different video |
| 4.5 | Private / unlisted / age-gated / live (Gemini rejects) | `youtube_unsupported`; **no** caption/timedtext scrape |
| 4.6 | Playlist, YouTube homepage, Studio, embed-only | Clear empty / unsupported — not a fake article summary from sidebar HTML |
| 4.7 | YouTube Shorts | Best-effort; if rejected → `youtube_unsupported` |
| 4.8 | Non-YouTube summary | No chapter list in UI |
| 4.9 | Comments / suggested videos / homepage chrome as context | Must not be model context; watch URL / media path only |
| 4.10 | Groq fallback on YouTube failure | **No** Groq; show `youtube_unsupported` or model error |
| 4.11 | Click chapter while user navigated to another video | Seek only if still same `videoId`; otherwise no-op / refresh |
| 4.12 | Zero chapters from model | Still show TL;DR, five points, next step |

### Slice 5 — English / Hinglish toggle

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| 5.1 | Toggle to Hinglish then summarise article | New reply in Hinglish (Hindi Latin + English) |
| 5.2 | Toggle then summarise public YouTube | Same language behaviour as articles |
| 5.3 | Older messages already rendered | Stay as-is; only new replies follow new language |
| 5.4 | Reload panel | `settings.language` persisted |
| 5.5 | Toggle during an in-flight stream | Current stream may finish in old language; next send uses new |

### Phase 1 exit traps

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| P1.1 | Explain selected text before Week 2 | Only via temporary slice 2 path if needed — **one** explain pipeline (replaced in slice 7) |
| P1.2 | On-device Chrome AI stretch | Optional; must not replace Gemini path |

---

## Phase 2 — The Brain

### Slice 6 — Grounded page chat

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| 6.1 | Question answered by the article | Reply matches page |
| 6.2 | Question absent from page | Admit missing; surface `off_page` when model declines |
| 6.3 | YouTube tab follow-up about the video | Grounded in video / structured summary, not comments |
| 6.4 | YouTube tab ask about something not in the video | `off_page` |
| 6.5 | Sensitive URL chat attempt | Refuse before stream starts |
| 6.6 | Switch tabs | Transcript for previous `tabId` cleared; new title shown |
| 6.7 | History longer than 8 turns | Only last 8 sent |
| 6.8 | Stream fails mid-token | Keep user message; show error sentence; no half-broken crash |
| 6.9 | Tokens appear before full reply | Streaming visible in latest assistant bubble |
| 6.10 | Refresh extract fails mid-chat | Error state; do not answer from stale wrong tab |
| 6.11 | User sends empty message | Ignore or show validation; no model call |

### Slice 7 — Context-menu actions

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| 7.1 | Explain / Translate / Draft with panel closed | Writes `pendingIntent`, opens panel, shows result in chat |
| 7.2 | Intent older than 2 minutes | Dropped; no surprise model call |
| 7.3 | Selection longer than 4,000 characters | Cap at 4,000 |
| 7.4 | No selection / empty selection | Empty state; no model call |
| 7.5 | Sensitive page selection | No model call; `sensitive_page` |
| 7.6 | Translate after flipping global EN/Hinglish | Translate still uses `translateLanguage` (default `hi`); does **not** change `settings.language` |
| 7.7 | Explain from open panel with selection | Uses `page/selection`; same pipeline as context menu |
| 7.8 | Pending intent for a different tab than active | Do not run against the wrong tab; clear or re-validate `tabId`/`url` |
| 7.9 | Two context-menu clicks in quick succession | Last valid intent wins or earlier is cleared; no double-send chaos |
| 7.10 | Draft a reply on non-email content | Still drafts in active output language; no crash |

### Slice 8 — Screenshot and ask

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| 8.1 | Crop chart/error region + question | Answer needs the pixels; Flash vision route |
| 8.2 | Skip crop | Full visible frame sent (after resize/compress) |
| 8.3 | Cancel crop | Nothing sent; data URL dropped |
| 8.4 | Sensitive URL | Capture hidden or `sensitive_page` **without** `captureVisibleTab` |
| 8.5 | Tab changes during crop | Drop data URL; do not send |
| 8.6 | Answer arrives | Drop data URL; never write to storage or action log |
| 8.7 | Image larger than limits | Longest edge ≤ 1280; JPEG ~0.7 |
| 8.8 | Groq fallback for vision | **No**; clear error if Gemini vision fails |
| 8.9 | Capture permission / restricted page | Mapped error; panel usable |
| 8.10 | Question empty | Block send or require question before capture |

### Slice 9 — Errors, retry, fallback

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| 9.1 | HTTP 429 once then 200 | Honour `Retry-After` ≤ 8s; retry same route once; succeed; **no** Groq |
| 9.2 | HTTP 429 twice on text task + Groq key | Fall back to Groq |
| 9.3 | HTTP 429 twice on image / YouTube task | No Groq; `rate_limited` or `model_unavailable` |
| 9.4 | 5xx / network fail once then recover | Retry once, then succeed or fall back |
| 9.5 | Gemini fails, no Groq key | `rate_limited` or `model_unavailable` |
| 9.6 | Waiting on free tier | Copy: “Sahayak is waiting for the free model.” |
| 9.7 | Sensitive-page flag on route | Never call Groq (or Gemini with page payload) |
| 9.8 | Bad key still allows new prompts | Panel does not lock up |
| 9.9 | Forced-fallback debug flag | Dev only; **removed before release** (slice 16) |
| 9.10 | Invalid JSON (find-it / agent, later) | Re-ask once with parser error, then escalate Flash once, then `invalid_model_output` |

### Phase 2 exit traps

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| P2.1 | Rate limit during streaming chat | Abort stream cleanly; show sentence; keep user message |
| P2.2 | Context menu on sensitive page then open panel | Intent may exist but model must not run |

---

## Phase 3 — The Hands

### Slice 10 — Scanner and badges

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| 10.1 | Dense page with many controls | Numbers match panel action map |
| 10.2 | Hidden / disabled / zero-size controls | Skipped |
| 10.3 | Password input | Present in map, marked protected, **no** `valuePreview` |
| 10.4 | OTP / card fields | Same protection rules as password for values |
| 10.5 | Re-scan after DOM change | Re-numbers; old `n` may be invalid |
| 10.6 | Overlay badges with Sahayak prefix | Not counted as interactive elements on later scans |
| 10.7 | Sensitive URL scan | `sensitive_page` |
| 10.8 | `normal` (non-allowlisted) page | Scan/display/highlight OK; execution still blocked later |
| 10.9 | Shadow DOM / iframe-only controls | Document known limits; do not crash; may be incomplete |
| 10.10 | Dynamic list that virtualises rows | Map may miss off-screen nodes; re-scan after scroll |
| 10.11 | Highlight `n` that no longer exists | Clear error; no click |
| 10.12 | Nothing interactive on page | Empty “nothing to scan” state |

### Slice 11 — Find it for me

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| 11.1 | Valid `{ element, reason }` on current map | Highlight only; **no** click |
| 11.2 | Missing `element` / non-integer | Reject → repair or `invalid_model_output` |
| 11.3 | `element` not on **current** map (stale after re-scan) | Reject |
| 11.4 | First JSON invalid, second valid | One re-ask then success |
| 11.5 | Repair fails twice | `invalid_model_output`; nothing clicked |
| 11.6 | Ask for something that does not exist | Not found / off-page style message; no click |
| 11.7 | Ambiguous matches (two “Submit”) | Model picks one with reason; user can re-ask; still highlight-only |
| 11.8 | Sensitive URL | No model call |

### Slice 12 — Approval-based agent loop

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| 12.1 | User never presses Approve | **No** DOM action |
| 12.2 | Approve on allowlisted practice page | Exactly one stored step executes |
| 12.3 | Skip | Skipped `n` not executed; new proposal |
| 12.4 | Stop | No further acts for that run |
| 12.5 | `done` | Ends run without DOM action |
| 12.6 | News / normal non-allowlisted + Approve | `not_allowlisted`; no click |
| 12.7 | `type` targeting password/OTP/card | `protected_field`; not executed even if JSON asks |
| 12.8 | Submit / Pay / Send on allowlisted page | After Approve, `needs_extra_confirm` before act |
| 12.9 | Extra confirm dismissed / cancelled | No act |
| 12.10 | Step count reaches 8 | `step_limit`; no unsupervised continuation |
| 12.11 | Unknown action `type` / missing `reason` | Parser reject; no act |
| 12.12 | `click` without `element` / `type` without `value` | Reject |
| 12.13 | Proposal id mismatch (Approve stale proposal) | Refuse act |
| 12.14 | YouTube.com agent Approve (play/subscribe/comment) | Not allowlisted; **must not** auto-play / subscribe / comment |
| 12.15 | Model proposes two actions in one JSON | Reject or take none; only one next action allowed |
| 12.16 | DOM changes between propose and Approve | Re-validate target; fail closed if `n` invalid |
| 12.17 | Concurrent second goal while run active | Block or require Stop first; one run at a time |

### Slice 13 — Persistence, dry-run, logs, practice errands

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| 13.1 | Service worker inactive / extension reload mid-approval | Pending proposal still shown; Approve uses stored `proposalId` |
| 13.2 | Dry-run Approve | `page/highlight` only; log `dry_run`; fields stay empty |
| 13.3 | Action log contents | Proposal, reason, decision, timestamp only |
| 13.4 | Log must never contain | Screenshots, API keys, password/OTP/card values |
| 13.5 | More than 20 log sessions | Oldest evicted |
| 13.6 | Kill switch visible entire run | Stop always available |
| 13.7 | Apply errand incomplete / user Stops | Clear stopped state; ≤ 8 approved steps never exceeded |
| 13.8 | Shop errand finishes | `done` or clear stop; every step approved |
| 13.9 | Practice pages not served on allowlisted host | Document `127.0.0.1` / localhost requirement |
| 13.10 | `agentRun` serialise/deserialise | Proposal id and step index round-trip |
| 13.11 | Browser restart (session storage cleared) | Run does not falsely resume; user starts fresh |
| 13.12 | Dry-run default from settings | New runs respect setting; toggle mid-run is explicit |

### Phase 3 exit traps

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| P3.1 | Find-it success mistaken for permission to act | Still highlight-only until agent Approve path |
| P3.2 | Allowlist host + denylist path (`/checkout` on localhost) | Sensitive wins if path/host rules match |

---

## Phase 4 — Memory, safety, ship

### Slice 14 — Local profile memory

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| 14.1 | Save profile, reload panel | Values remain |
| 14.2 | Profile includes password-like field | UI must not offer password fields |
| 14.3 | Draft uses name/tone when relevant | Included in prompt slot 5 for draft/fill/skills only |
| 14.4 | Sensitive URL | Profile not sent; task blocked before model |
| 14.5 | Fill goal on practice Apply | May propose typing profile values; user Approves each step |
| 14.6 | Empty profile + fill skill | Clear behaviour; do not invent PII |
| 14.7 | Very long skills/links text | Cap or clip for prompt size |

### Slice 15 — One-click skills

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| 15.1 | Custom skill on article | Extract after safety + skill as `userText`; result in chat |
| 15.2 | Exam notes / Explain in Hinglish on YouTube tab | YouTube media path, **not** Readability |
| 15.3 | Fill-from-profile skill | Slice 12 loop; Approve per act |
| 15.4 | Export → clear → import | List matches |
| 15.5 | Import JSON with unknown executable fields | Reject |
| 15.6 | Import malformed / truncated JSON | Reject with clear message |
| 15.7 | Skill run on sensitive page | Blocked like any other extract |
| 15.8 | Duplicate skill names | Allowed or disambiguated; ids remain unique |
| 15.9 | Starter skills missing after fresh install | Seed Exam notes, Explain in Hinglish, polite reply, fill-from-profile |

### Slice 16 — Safety rails in UI

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| 16.1 | User allowlist + bank host | Still `sensitive` |
| 16.2 | Header safety badge on sensitive URL | Visible; capture hidden; Act execution disabled |
| 16.3 | `page/extract`, `capture/visible`, `page/selection`, `page/act` | All go through worker `classifyUrl` |
| 16.4 | Practice Submit after Approve | Extra confirm before click |
| 16.5 | Password field type proposal | Execution blocked `protected_field` |
| 16.6 | Stop mid-run | No further acts |
| 16.7 | API keys only in `chrome.storage.local` | Not in git, logs, or action log |
| 16.8 | Forced-fallback debug flag still present | Must be removed |
| 16.9 | User allowlist typo / malicious host | Denylist still wins; document that allowlist is for user-owned pages only |
| 16.10 | Allowlist entry for `https://*` wildcard abuse | Reject overly broad entries if validated; prefer exact hosts |

### Slice 17 — README, ZIP, landing page

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| 17.1 | `npm run build` | Clean `dist/` without `node_modules` or keys |
| 17.2 | Release ZIP Load unpacked on clean Chrome profile | Install works |
| 17.3 | Full §9 definition-of-done walk | Article + YouTube + language + chat + menus + screenshot + find-it + practice Approve + log + profile/skill + sensitive block |
| 17.4 | Landing page | No keys, no required tracking |
| 17.5 | README omits practice-page how-to | Must include localhost serve instructions |
| 17.6 | Screenshots missing YouTube chapters | Required screenshot set includes chapter seek UI |

### Phase 4 exit traps

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| P4.1 | Skills import used as RCE / script injection | Treat as data only; no `eval` of skill fields |
| P4.2 | Profile used on third-party site via mistaken allowlist | Execution still needs allowlist + Approve + field gates |

---

## Messaging and storage corners

| ID | Scenario | Expected behaviour |
| --- | --- | --- |
| M1 | Envelope missing `v` / unknown `cmd` | Reject; do not forward |
| M2 | `tabId` on envelope ≠ active tracked tab | Prefer explicit id after classification of **that** tab’s URL |
| M3 | Content script replies after panel closed | Ignore stale correlation ids |
| M4 | `pendingIntent` and `agentRun` mixed into `local` storage | Must not; session only |
| M5 | Screenshot data URL written to storage | Forbidden |
| M6 | Chat transcript expected after panel close | v1: in-memory only; not a product requirement to persist |
| M7 | Content script tries to read API keys | Impossible by design; keys never in content world |
| M8 | Page posts crafted `window.postMessage` to exfiltrate | Content script must not expose keys or proxy arbitrary model calls |

---

## Limits cheat-sheet (breach behaviours)

| Limit | Breach / boundary | Behaviour |
| --- | --- | --- |
| Extract 12k | Oversize article | Keep start + end |
| Selection 4k | Huge highlight | Cap |
| Chat history 8 | Long thread | Send last 8 only |
| Agent steps 8 | Ninth act | `step_limit` |
| Model timeout 30s | Hang | `timeout` |
| 429 Retry-After | Header > 8s | Cap wait at 8s |
| Pending intent TTL | > 2 min | Drop |
| Action log sessions | > 20 | Evict oldest |
| Screenshot | Huge PNG | ≤ 1280 edge, JPEG ~0.7 |
| JSON repair | Still invalid | `invalid_model_output` |

---

## Explicitly out of scope (do not “fix” by building)

These are not edge cases to implement; if they appear, refuse or document as unsupported:

- Chrome on Android / iPhone
- Autonomous multi-step execution without Approve
- Banking, payment, login, or OTP automation
- Typing passwords or card information
- Sending private email / banking / personal-document pages to a free-tier model
- Acting on arbitrary third-party sites for risky workflows
- Caption scraping / youtube-dl / third-party transcript APIs
- Chrome Web Store publication
- Sahayak backend or proxy

---

## Suggested test matrix per phase exit

**Phase 1:** missing key · bank URL · article summary · public watch summary · `youtu.be` · private video · EN/Hinglish both surfaces · extract truncation fixture  

**Phase 2:** on-page vs off-page chat · YouTube follow-up · three context menus · intent TTL · crop cancel · sensitive capture block · 429→retry · 429→Groq text · no Groq for vision/YouTube  

**Phase 3:** protected field in map · badge exclusion · find-it stale `n` · never Approve · Skip/Stop · `not_allowlisted` · consequential double confirm · SW sleep + Approve · dry-run · log eviction · two practice errands  

**Phase 4:** profile omit on sensitive · skill import reject · YouTube skill media path · allowlist vs denylist · ZIP clean profile walkthrough  

---

## Related docs

- `docs/implementation-plan.md` — build slices and Chrome checks  
- `docs/architecture.md` — protocol, safety gates, limits, error sentences  
- `docs/problemstatement.md` — definition of done (§9)
