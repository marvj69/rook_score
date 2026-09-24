# Security, bug, and performance audit (September 2026)

Scope: the whole Rook Score app: client modules, Firebase sync, service worker, Vercel serverless functions, Firestore rules, deployment config, and CSS. Thirteen independent reviewers each took one lens (API security, DOM injection, cloud sync, PWA and supply chain, voice executor, game logic, UI state, persistence, HTML/CSS contract, runtime, load, CSS rendering, async edge cases). Their 126 raw findings were merged per file, and every unique finding was checked by two adversarial verifiers against the original code, with a third vote on ties. 74 findings were confirmed and 27 were refuted. The finished change set was then reviewed by three more independent reviewers, whose 5 confirmed regressions were fixed before release.

Every fix was gated on three checks: the unit suite (210 tests), a Playwright click-through of the scoring, library, freezer, settings, presets, theme, and statistics flows, and a strict per-channel screenshot comparison of 41 screens (phone, small phone, desktop) that must be byte-identical to the pre-change baseline. Blur-reduction experiments that looked identical under a perceptual diff changed hundreds of thousands of pixels under the strict check and were rejected, so the glass theme is untouched.

## Confirmed findings

| Severity | Category | Location (original code) | Finding | Status |
|---|---|---|---|---|
| high | reliability | `js/modules/03-storage-icons-presets.js:21` | localStorage quota failure is swallowed, then the active game is deleted: completed/frozen game lost | Fixed |
| high | privacy | `js/modules/03-storage-icons-presets.js:92` | On GitHub Pages the sync snapshot, export and import operate on the whole shared marvj69.github.io origin, not just Rook keys | Fixed |
| high | privacy | `js/firebase-init.js:439` | Sign-out leaves the user's library in localStorage and the automatic anonymous re-sign-in uploads it to a fresh anonymous account (and into the next Google account on the device) | Not changed (design): Sign-out keeps local data on the device and the next anonymous session backs it up. Anonymous sync is the documented design (README: anonymous sign-in for local play, merge on Google sign-in). Recommendation: add a "sign out and remove data from this device" option. |
| high | bug | `js/firebase-init.js:326` | Firestore merge turns customPresetBids (and any non-game top-level array) into a plain object, so custom bid presets are lost on the next reload for every synced user | Fixed |
| high | privacy | `vercel.json:3` | Vercel deploys the whole repo root as public static files (tests, source modules, firestore.rules, and 645 KB of training data with 194 real player/team names) | Fixed |
| high | security | `api/voice-score-command.js:833` | Voice LLM endpoint has no origin enforcement, authentication, or rate limiting (cost-DoS on OpenRouter) | Fixed |
| high | security | `api/paper-game-photo.js:415` | Paper-game photo LLM endpoint has no origin enforcement and no rate limiting (cost-DoS on OpenRouter vision calls) | Fixed |
| medium | security | `js/modules/09-voice-scoring.js:1062` | Voice plan can click its own confirmation dialog, deleting games / resetting the board with no user consent | Fixed |
| medium | bug | `js/modules/09-voice-scoring.js:1241` | Voice rematch treats the async startRematchWithFirstDealer() Promise as success, so a rejected dealer is reported as "Started rematch." | Fixed |
| medium | bug | `js/modules/09-voice-scoring.js:923` | Voice setSetting writes localStorage only; the next saveSettings() (closing Settings or exporting data) writes the stale DOM back and silently reverts the voice change | Fixed |
| medium | privacy | `js/modules/09-voice-scoring.js:400` | Voice-improvement redaction only replaces names already known to the app, so new names spoken in clarify/unsupported/answer turns are stored verbatim | Documented limitation: Names the app has never seen cannot be recognised for redaction. Sharing is opt-in and capped; known player, team, and dealer names, emails and phone numbers are redacted. |
| medium | privacy | `js/modules/09-voice-scoring.js:418` | Improvement-sample redaction omits context.dealers, so dealer names spoken before teams are set leak into shared samples (and sample.dealers is always empty) | Fixed |
| medium | reliability | `js/modules/04-theme-ui-helpers.js:122` | initializeTheme applies rookSelectedTheme verbatim as body.className: non-string value crashes startup, arbitrary tokens (e.g. `hidden`) blank the app permanently | Fixed |
| medium | reliability | `js/modules/03-storage-icons-presets.js:71` | savedGames / freezerGames are never validated as arrays of objects on load or import; a non-array or null entry crashes the library, statistics, save, freeze and delete paths | Fixed |
| medium | performance | `js/modules/03-storage-icons-presets.js:14` | One Firestore write per localStorage key per change: a single Save Settings click issues 5 writes, finishing a game 4-5, and importing a backup up to 1000 concurrent writes | Fixed |
| medium | bug | `js/modules/05-game-state-management.js:330` | Unguarded JSON.parse of proModeEnabled in load/reset paths; a malformed backup bricks app initialization on every launch | Fixed |
| medium | reliability | `js/modules/05-game-state-management.js:353` | A finished but unsaved game is deleted from storage the moment it ends, so a PWA reload/eviction on the Game Over screen loses the whole game | Fixed |
| medium | bug | `js/modules/08-game-actions-logic.js:185` | handleTeamClick mutates savedScoreInputStates in place, which aliases DEFAULT_STATE, so a stale bid from the previous game is restored after New Game / Save / Freeze | Fixed |
| medium | bug | `js/modules/08-game-actions-logic.js:552` | Undo/redo/history-edit revert team stats with raw state players while game-end records them via getTeamSnapshotForSide (dealer-pair fallback), so stats are never reverted and double-counted on redo | Fixed |
| medium | bug | `js/modules/08-game-actions-logic.js:203` | Re-selecting 'Other' after a preset clears bidAmount while customBidValue stays valid, so the points field renders but cannot be opened and submit says 'Please select bid amount.' | Fixed |
| medium | bug | `js/firebase-init.js:305` | Union merge of savedGames/freezerGames has no tombstones, so games deleted or thawed offline / on another device are resurrected | Documented limitation: Cloud merge is a union without deletion tombstones, so a game deleted while offline can return after the next merge. Fixing it needs a sync-protocol change. |
| medium | reliability | `js/firebase-init.js:481` | All synced keys live in one Firestore document, so libraries past ~1 MiB make every sync and every startup merge fail silently | Documented limitation: All synced data lives in one Firestore document (1 MiB, roughly 700+ games). Splitting it is a data-model change. |
| medium | bug | `js/firebase-init.js:329` | Scalar and object settings (including the voice-data consent flag) never converge across devices: local always wins and overwrites the cloud | Not changed (design): Settings do not converge across devices: the local value wins. |
| medium | privacy | `js/firebase-init.js:792` | Every visitor is given an anonymous Firebase account and has their full localStorage (player names, games) uploaded without ever opting into cloud sync | Not changed (design): Anonymous accounts back up local data without an explicit opt-in, as documented. Recommendation: an explicit cloud-sync switch. |
| medium | performance | `js/firebase-init.js:225` | /api/firebase-config is fetched with cache:'no-store' and served no-store, so every page load invokes a serverless function before Firebase can start | Fixed |
| medium | reliability | `service-worker.js:53` | Service worker overwrites the cached app shell with whatever same-origin resource a navigation hits | Fixed |
| medium | reliability | `service-worker.js:64` | Precache and stale-while-revalidate go through the HTTP cache, so on GitHub Pages (max-age=600) an app update can install a stale or mixed-version asset set | Fixed |
| medium | performance | `service-worker.js:15` | Service worker precaches ~486 KB of icon PNGs the page never requests; atomic install means they also gate offline readiness | Fixed |
| medium | security | `vercel.json:1` | Vercel deployment ships no security response headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) | Fixed |
| medium | reliability | `api/paper-game-photo.js:320` | Photo scan has no provider timeout and no maxDuration, so a hung OpenRouter call pins the function and the user until the platform kills it | Fixed |
| medium | security | `api/bug-report.js:69` | Bug-report email endpoint accepts requests with no Origin header; only a per-instance in-memory limiter guards the Resend quota | Fixed |
| medium | bug | `js/modules/11-rendering.js:419` | History running-total edit: blank input commits as 0 (Number('') === 0) instead of being rejected | Fixed |
| medium | performance | `js/modules/10-probability-breakdown.js:406` | Dealer-name suggestions rescan every saved and frozen game and rebuild the datalist on each keystroke | Fixed |
| medium | bug | `index.html:686` | Resume Paper Game score fields cannot receive a minus sign on iOS (inputmode=numeric) | Fixed |
| low | bug | `js/modules/09-voice-scoring.js:1126` | setThemeColors accepts 3-digit hex (#f00); <input type=color> sanitizes it to #000000 and the theme is applied as black | Fixed |
| low | bug | `js/modules/09-voice-scoring.js:481` | Name redaction regex has no word boundaries, so short player names corrupt stored samples and can mask other names | Fixed |
| low | bug | `js/modules/09-voice-scoring.js:1105` | gameLibraryAction view/delete/resume accept any non-negative index without bounds checking; out-of-range indexes report success or open a no-op delete confirmation | Fixed |
| low | bug | `js/modules/04-theme-ui-helpers.js:197` | initializeCustomThemeColors warns 'Invalid customUsColor' and issues storage removals (and Firestore delete writes) on every run for users with no custom colors | Fixed |
| low | bug | `js/modules/04-theme-ui-helpers.js:244` | Theme 'Reset' applies and persists the default colors immediately, contradicting the sheet's 'Nothing changes until you tap Apply' | Not changed (design): Theme Reset applies immediately although the sheet says nothing changes until Apply; changing it would alter current behavior. |
| low | reliability | `js/modules/04-theme-ui-helpers.js:151` | initializeTheme() re-run after cloud merge overwrites body.className and drops modal-open / overflow-hidden while a modal is open | Fixed |
| low | reliability | `js/modules/05-game-state-management.js:323` | Round entries are not validated when loading the active game or resuming a frozen game; a null/non-object round crashes totals and history rendering | Fixed |
| low | bug | `js/modules/08-game-actions-logic.js:89` | Table-talk penalty silently does nothing (but shows 'Penalty applied') when bidAmount is empty while the flag button is enabled | Fixed |
| low | bug | `js/modules/08-game-actions-logic.js:412` | victoryMethod is set to 'Won on Bid' / 'Penalty: Lost Bid' on every round even when the game is not over | Fixed |
| low | reliability | `js/modules/08-game-actions-logic.js:599` | handleRedo dereferences round.runningTotals without sanitizing (TypeError on imported/merged rounds), and getLastRunningTotals disagrees with getCurrentTotals for such rounds | Fixed |
| low | bug | `js/modules/08-game-actions-logic.js:1102` | deleteGame and loadFreezerGame snapshot the storage list before the confirmation dialog and write the stale array back on confirm, discarding a cloud merge that lands while the dialog is open | Fixed |
| low | performance | `js/firebase-init.js:335` | Startup merge always uploads the entire merged document even when nothing changed, and persists DEFAULT_STATE as a phantom active game | Fixed |
| low | bug | `js/firebase-init.js:776` | Auth-timeout and init-failure fallbacks reload game state from localStorage unconditionally, discarding unsaved in-progress input | Fixed |
| low | performance | `js/firebase-init.js:810` | Firebase config fetch and the three gstatic SDK imports run sequentially although they are independent | Fixed |
| low | reliability | `js/firebase-init.js:6` | Hard 3.5 s timeout on the config fetch disables cloud sync for the whole session on a cold function + slow mobile link, with no automatic retry | Fixed |
| low | bug | `service-worker.js:89` | The .map short-circuit constructs an illegal 204 Response and throws inside the fetch handler | Fixed |
| low | reliability | `service-worker.js:108` | activate deletes every Cache Storage entry on the origin, not just rook-cache-* versions | Fixed |
| low | performance | `service-worker.js:5` | Precache list downloads the same index.html twice ('./' and './index.html') at install | Fixed |
| low | reliability | `service-worker.js:1` | CACHE_NAME must be bumped by hand; a missed bump leaves updates to independent stale-while-revalidate refreshes that can produce a mixed index.html/app.bundle.js version | Fixed |
| low | security | `api/firebase-config.js:52` | Firebase config 500 response enumerates the server's missing environment-variable names | Fixed |
| low | security | `api/firebase-config.js:58` | Firebase web API key is in public git history and is still the live key served by /api/firebase-config | Action for the owner: The Firebase web API key is public by design but appears in old commits: restrict it in Google Cloud Console (HTTP referrers rook-score.vercel.app and marvj69.github.io; Identity Toolkit and Firestore APIs) and rotate it. |
| low | security | `.github/workflows/pages.yml:25` | GitHub Pages workflow pins third-party actions to mutable major tags | Fixed |
| low | privacy | `.gitignore:10` | .gitignore does not exclude local tooling directories (.claude/, tmp/, .ruff_cache/), so a `git add -A` would commit them | Fixed |
| low | security | `api/voice-score-command.js:403` | Saved-game, player, and team names are injected verbatim into the planner prompt without an untrusted-data boundary | Mitigated: The planner prompt now states that names inside the app context are data, never instructions, and the server still whitelists every action the model may return. |
| low | bug | `api/paper-game-photo.js:356` | In-band OpenRouter errors (HTTP 200 + error object) get statusCode 200, so retry/fallback never triggers for them | Fixed |
| low | security | `firestore.rules:80` | rookData Firestore rule accepts any payload from any (anonymous) account with no shape or size validation | Recommended follow-up: A strict key allowlist in the rules would break users whose documents already carry keys from other apps on the shared origin; the client now writes only allowlisted keys. Revisit once existing documents are known clean. |
| low | security | `firestore.rules:59` | voiceImprovement sample rule leaves nested context maps, list elements and action items unbounded, so any anonymous account can create unlimited ~1 MiB create-only documents | Recommended follow-up: voiceImprovement samples validate shape but not every nested size; create-only, per-user, opt-in. |
| low | bug | `js/modules/11-rendering.js:412` | History-cell edit: Escape/cancel can be re-committed through the input's onblur because commitHistoryEdit does not check that the cell is still being edited | Fixed |
| low | bug | `js/modules/11-rendering.js:351` | startHistoryEdit focuses the inline edit input in a setTimeout(0) that usually runs before the rAF-scheduled render creates it | Fixed |
| low | bug | `js/modules/10-probability-breakdown.js:521` | Post-game dealer-pair selection can leave team win/loss counters credited to the wrong pair | Open: Choosing the non-default dealer pair after a game can credit the win to the other pairing in the team counters. Needs a design decision on how pair choice maps to stats. |
| low | bug | `js/modules/10-probability-breakdown.js:554` | Bug report submit throws on iOS < 15.4 because getBugReportDiagnostics uses Array.prototype.at | Fixed |
| low | bug | `index.html:791` | Pro Mode toggle is bound twice (inline onchange + addEventListener) so every flip runs toggleProMode twice | Fixed |
| low | bug | `index.html:62` | Hamburger menu button (role=button, tabindex=0) cannot be activated with the keyboard | Fixed |
| low | bug | `index.html:594` | Team Names modal cannot scroll; buttons unreachable on short viewports | Fixed |
| low | bug | `index.html:5` | Viewport meta disables pinch-zoom (user-scalable=no, maximum-scale=1) | Not changed (design): Pinch zoom stays disabled; the game UI relies on tap-only interaction. |
| low | bug | `index.html:143` | ARIA attributes used on roles that do not permit them (aria-pressed on tab, aria-expanded on textbox) | Not changed (design): The library tabs keep aria-pressed because the CSS keys the active style on it; removing it changed the look. |
| low | reliability | `js/modules/09-settings-validation-misc.js:119` | Voice onboarding: cancelling while the microphone prompt is pending is overridden when the prompt resolves | Open: Cancelling the voice onboarding while the microphone prompt is pending can be overridden when the prompt resolves (experimental feature only). |
| low | reliability | `js/modules/13-settings-loading.js:17` | loadSettings assigns an unvalidated stored penalty type to the <select>, and handleTableTalkPenaltyChange then persists the resulting empty value | Fixed |
| low | performance | `js/modules/12-saved-games-and-stats-modals.js:66` | Library search/sort recomputes new Date().toDateString() ~9,500 times per keystroke at 500 games | Fixed |
| low | performance | `js/modules/12-saved-games-and-stats-modals.js:1369` | Statistics modal renders every team/player twice (card list and table), one copy always display:none | Not changed (design): Statistics render both a card list and a table (one hidden per view) so switching views is instant. |

## Regressions caught by the review of this change set

| Severity | Location | Finding | Status |
|---|---|---|---|
| high | `js/firebase-init.js` | Parallel Firebase init issues the SDK import() while offline, permanently poisoning the module map so a later retry cannot recover | Fixed |
| medium | `js/modules/14-initialization-and-exports.js` | New global Escape handler closes the Dealer Order sheet when the user presses Escape to dismiss the name-suggestion list, discarding typed dealer names | Fixed |
| low | `css/app.css` | Save toast no longer slides in: `#saveIndicator.hidden { display:none }` plus a single rAF collapses un-hide and .show into one style pass | Fixed |
| low | `js/modules/08-game-actions-logic.js` | Rematch ignores the new quota-failure signal and still resets the finished game after telling the user it was not saved | Fixed |
| medium | `css/app.css` | Save toast no longer animates in: `#saveIndicator.hidden { display:none }` defeats the rAF class flip | Fixed |

## Refuted findings (checked and found not to be defects)

- `js/modules/09-voice-scoring.js:1125`: Voice setThemeColors/themeAction/setBidPresets leave the Settings sheet open as a side effect
- `js/modules/09-voice-scoring.js:1651`: Mic button is replaced by innerHTML during pointerdown, dropping pointer capture; a missed pointerup leaves voiceScoreHeldPointerId set and blocks every later press
- `js/modules/09-voice-scoring.js:697`: Clarification/answer memory never expires, so a stale question from long ago is replayed to the planner with an unrelated later command
- `js/modules/09-voice-scoring.js:1058`: Voice "sign in" runs signInWithPopup outside a user gesture; a blocked popup is swallowed and the voice reports "Opening sign in."
- `js/modules/09-voice-scoring.js:1012`: Voice setTeams closes the team-selection modal but ignores a pending save/freeze, leaving pendingGameAction armed for a later surprise save
- `js/modules/14-initialization-and-exports.js:184`: Game-over overlay stays hidden (no Save/Rematch/New Game buttons) after backing out of the team-name prompt
- `js/modules/14-initialization-and-exports.js:120`: Escape only dismisses the notice and confirmation dialogs; every other modal ignores it
- `js/modules/14-initialization-and-exports.js:212`: Left-edge swipe opens the navigation menu underneath an open modal
- `js/modules/14-initialization-and-exports.js:271`: Menu swipe gesture never handles touchcancel, leaving isDragging/transition state stuck so the next unrelated touch drags the menu
- `js/modules/14-initialization-and-exports.js:44`: Startup unconditionally clears the win-probability cache and schedules a second full renderApp() after loading a runtime model identical to the bundled fallback, cutting the card entrance animation short
- `js/modules/14-initialization-and-exports.js:33`: Every launch deep-copies the whole saved/frozen game library in the team migration before the first render
- `js/modules/14-initialization-and-exports.js:175`: registration.update() immediately after register() fetches service-worker.js twice on every load
- `css/app.css:131`: Voice mic button paints over the in-app keypad's Submit Round / backspace area
- `css/app.css:170`: Generic glass card override applies a 28px backdrop blur to every nested card/button on the main screen
- `css/app.css:1534`: Stats rows, spotlight cards, inputs and settings switches re-blur a backdrop the modal shell has already blurred, including while animating
- `css/app.css:1196`: Two full-viewport blur passes on every frame while a sheet is open: #app filter blur(4px) plus the overlay's backdrop-blur-sm on the same pixels
- `css/app.css:72`: Two fixed 100vmax layers with filter: blur(90px) (one screen-blended) are rasterised at full device resolution on phones
- `css/app.css:115`: Desktop blob animations keep re-blurring two 100vmax layers every frame underneath open modals
- `css/app.css:580`: Menu drawer animates the layout property `left` while carrying a 24px backdrop blur and a 35px box-shadow
- `css/app.css:1207`: `.probability-modal` animates an undefined `fadeIn` keyframe, so the intended overlay fade never runs
- `css/app.css:511`: Several entrance animations ignore prefers-reduced-motion while sibling animations honour it
- `css/app.css:575`: Off-screen nav items and the blurred app behind modals stay in the tab / screen-reader order
- `css/app.css:135`: Nav background/border/shadow rules are dead: overridden by `nav.nav-transparent !important`
- `css/app.css:540`: Hamburger and version badge ignore left/right safe-area insets (landscape notch)
- `css/app.css:896`: `#saveIndicator.hidden` never hides the toast, leaving a permanent invisible backdrop-filter layer
- `css/app.css:347`: Phone-size version badge rule is dead (min-width/min-height override width/height)
- `css/app.css:1892`: Library search/sort field resets are silently overridden by generic liquid-glass input rules

## Performance work that kept every screen byte-identical

- Service worker: the cache name is stamped from asset content hashes at build time; the shell is only cached from HTML navigations at the scope root; background refreshes bypass the HTTP cache; only this app's own caches are purged; the 512 px icon (fetched by the OS at install, never by the page) left the precache; both icons were losslessly recompressed (192 px 67 KB to 56 KB, 512 px 419 KB to 335 KB).
- Firebase: the SDK download is warmed while the config request is in flight and imported once the network is proven reachable; the config response is cacheable (max-age 600) so repeat launches skip a serverless invocation; Firestore writes within 250 ms are merged into one document update; an unchanged startup merge writes nothing.
- Startup: the team-data migration walks the library once per storage version instead of on every launch.
- Library and dealer entry: date grouping computes the day key once per render; player-name suggestions are cached and the datalist is only rewritten when it changes.
- Menu drawer: slides with a compositor transform instead of animating `left`; the hidden save toast no longer keeps a blurred layer alive.
- A preconnect hint to the API host shortens the first cloud request from the GitHub Pages site.

## Owner actions that need your accounts

1. Restrict and rotate the Firebase web API key in Google Cloud Console (see the finding above).
2. Consider an explicit cloud-sync switch and a "sign out and remove data from this device" option.
3. `firestore.rules` was not changed in this release; deploy it as before whenever it changes.
