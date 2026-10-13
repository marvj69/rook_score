# UI / UX review — October 13, 2026

Reviewed baseline: `c4c0ad2` on `main`. The local checkout was first fast-forwarded from `e709f0a` so the review includes the intervening UI repairs. All 419 baseline tests passed.

The app's main task is recording bids and scores at the card table. This review prioritizes incorrect game context, recovery from a scoring mistake, and access to score entry over cosmetic changes. Checks use synthetic local games; no production game data is changed.

## Findings selected for repair

| Priority | Finding | User impact | Status |
| --- | --- | --- | --- |
| P1 | A new paper game inherits the previous game's dealers and misdeals | The dealer badge names someone who is not playing; subsequent misdeals can be attributed to the wrong people. | Fixed and verified |
| P2 | Undo and Redo disappear between rounds | Immediately after submitting a mistaken score, the user must start another bid to find Undo. Undoing the only hand must also leave Redo available. | Fixed and verified |
| P2 | The scoring keypad loses keyboard focus when it opens and redraws | Entering a custom-bid digit removes the focused button. The next Tab goes to a team behind the keypad instead of continuing number entry. | Fixed and verified |

### 1. Paper-game dealer context

Reproduction: start a game, set the dealing order to Alice / Bob / Carol / Dave, then open Resume Paper Game. Enter Erin & Grace versus Frank & Henry with scores 300–250 and choose Start Tracking. The new scoreboard shows the new teams but still says **Dealer: Alice**. Submitting a hand advances to Bob. Source inspection also confirms that `misdealCount` and `misdealDealers` survive this transition.

Cause: `handleResumeGameSubmit()` replaces the scores, players, rounds, and timer but merges those changes into the previous game without clearing its dealing metadata.

Repair: clear the previous dealing order and misdeal history only when the new paper game is actually started. The previous game stays intact if the replacement confirmation is cancelled. The same reset applies to manual scores and imported photo history.

### 2. Correction controls between rounds

Reproduction: start a game, select Us, bid 120, enter 30 for Dem, and submit. The scoreboard shows 150–30 and History, but neither Undo nor Redo is present. Select Us again and Undo reappears inside the bid card.

Cause: the only normal-play Undo/Redo controls are rendered inside `renderScoreInputCard()`, which returns nothing when no bidding team is selected. Submitting a hand clears that selection.

Repair: expose the same Undo/Redo actions between rounds, without selecting a new bidder. Redo stays available after undoing the only hand, with a single set of controls while a bid is active. Keyboard focus moves to the remaining available correction action when the previous one becomes disabled.

### 3. Keypad keyboard focus

Reproduction: select a team, choose Other, and press Enter on the custom-bid field. Focus falls to the document body when the keypad opens. Focus Number 1 and press Enter: the value becomes 1, but the focused button is removed and focus again falls to the body. Tab then selects a team card behind the open keypad.

Cause: score entry rebuilds `#app` with `innerHTML`. The keypad does not transfer focus on opening, retain it across redraws, contain Tab navigation, or return it on dismissal.

Repair: focus a keypad control on opening, preserve the focused key through redraws and validation errors, keep Tab/Shift+Tab inside the keypad, and return focus to the input on Done/Escape. Confirmations retain focus when they cover the scoreboard. After a successful hand, focus goes to the next scoring action rather than automatically selecting Undo.

## Additional observation

The Game Over overlay exposes its underlying History controls and menu in the accessibility tree and does not move keyboard focus to Save Game. This needs a separate pass through completion-dialog focus and layering. It ranks below the repeated entry and correction issues above and is outside these three repairs.

## Verification

Baseline browser checks covered onboarding, Home, bid selection, custom bid entry, points entry, the zero-point choice, History, dealer setup, paper-game replacement, completion, saving, and populated Statistics/player profiles at 390 × 844.

- `npm test`: **424 passed**, including five new regression cases. The new cases cover manual/photo paper-game replacement and cancellation, saved dealer metadata, Undo/Redo between hands, keypad focus through redraws and validation, modal focus protection, and Tab wrapping.
- `npm run build`: passed; checked-in JavaScript and service-worker fingerprint rebuilt. The core bundle remains below its existing download budgets.
- JavaScript syntax checks, `git diff --check`, and `node scripts/stamp-service-worker.mjs --check`: passed.
- Rebuilt browser checks on a fresh origin: entered custom bid 120 with keyboard controls; verified focus after each digit, Tab and Shift+Tab wrapping, and Escape returning to the custom-bid field. Submitting invalid points 181 retains Submit focus and displays the error inside the keypad.
- Recorded 150–30, used Undo without selecting a bidder, then used Redo with no hands left. The score and dealer returned correctly, with one set of correction controls.
- Cancelled a paper-game replacement and verified the old 150–30 score and Bob dealer were unchanged. Confirmed the replacement with different players and reloaded: scores stayed 300–250 and Enter dealing order replaced the stale dealer badge.
- Layout checks at **320 × 568**, **390 × 844**, **844 × 390**, and **1280 × 800**: no document-width overflow; the keypad's Submit control remained inside the phone viewport, including landscape with a validation message.
- Staged all 44 deployment assets and exercised Home, lazy-loaded Statistics, and scoring at `/rook_score/` on a fresh local server. The final submission returned keyboard focus to the team card for the next bid.
- Browser logs showed no application errors. Plain static local serving produces the expected Firebase configuration 404/local-only warning; authenticated cloud sync, microphone permission, and physical iPhone standalone behavior were not exercised.

Local before/after captures are in `tmp/ui-ux-review-2026-10-13/` (excluded from deployment and Git). The app's existing visual design, scoring arithmetic, saved-game schema, and deployment configuration are preserved.
