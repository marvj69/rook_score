# Rook Score bug list

From the app scan on 2026-11-13 (tests, a hands-on pass at phone size, and a code read of every module).

**Status key:** ✅ fixed · 🔧 in progress · ⬜ open

**Progress:** 3 of 20 fixed (last updated 2026-11-14)

| Area | Fixed | Open |
| --- | --- | --- |
| Scoring | 1 | 1 |
| Cloud sync | 2 | 4 |
| Voice and photo (experimental) | 0 | 6 |
| Game flow | 0 | 4 |
| Other | 0 | 2 |

How each bug was confirmed is noted in its row: **browser** (reproduced by hand in the app), **simulator** (reproduced in Node against the real module with a fake Firestore or DOM), or **read** (traced in the code only).

## Scoring

| # | Status | Severity | Bug | Confirmed | Where |
| --- | --- | --- | --- | --- | --- |
| 1 | ✅ | High | Typing 0 for the **bidding** team opens "Did the Bidding team score 180 or 360?" and either choice gives the bidder those points. The live preview shows the opposite (bidder set). | browser | `js/modules/08-game-actions-logic.js` `submitRoundFromCurrentInputs` |
| 2 | ⬜ | Medium | Rematch saves the finished game with a guessed "Us" pair (seats 1 & 3) when a dealing order exists but teams were never named. Save and Freeze ask; Rematch does not, so the win lands on the wrong players half the time. | read (a test asserts it) | `js/modules/08-game-actions-logic.js` `startRematchWithFirstDealer` |

## Cloud sync

| # | Status | Severity | Bug | Confirmed | Where |
| --- | --- | --- | --- | --- | --- |
| 3 | ✅ | High | Deleting one game, or resuming a frozen one, is undone by the next merge. Saved and frozen lists merge as a union with no per-game delete record, so a second device (or a delete made offline) brings the game back. | simulator | `js/firebase-init.js` `mergeLocalStorageWithFirestore` |
| 4 | ✅ | High | A failed startup merge does not stop later saves, so the next save writes this device's shorter list over the cloud copy. | simulator | `js/firebase-init.js` `flushPendingSync` |
| 5 | ⬜ | Medium | Default rule settings overwrite the cloud copy on a new device. Every launch writes the table-talk penalty type, and closing Settings writes the other rule toggles; at sign-in the local value wins. | browser (the writes), read (the merge) | `js/modules/13-settings-loading.js`, `js/modules/09-settings-validation-misc.js` |
| 6 | ⬜ | Medium | A save, delete, freeze or resume made while the startup merge is writing replaces the just-merged cloud lists with the local-only list. | simulator | `js/firebase-init.js` (changes-during-merge write) |
| 7 | ⬜ | Medium | All synced data lives in one Firestore document. Past 1 MiB (roughly 370–560 saved games) every sync write fails, and nothing tells the user. | read plus size arithmetic | `js/firebase-init.js` |
| 8 | ⬜ | Low | Delete All Game Data is rejected, and the data comes back, when the account's existing delete marker is ahead of this device's clock. | simulator | `js/modules/13-delete-game-data.js` `nextGameDataResetMarker` |

## Voice and photo (experimental)

| # | Status | Severity | Bug | Confirmed | Where |
| --- | --- | --- | --- | --- | --- |
| 9 | ⬜ | High | A "clarify" or "unsupported" voice plan that carries actions is executed, so a hand can be recorded while the app is asking a question. | simulator | `api/voice-score-command.js` `normalizePlan`, `js/modules/09-voice-scoring.js` |
| 10 | ⬜ | Medium | `null` / `""` fields from the voice model are applied as 0: a round's totals are zeroed, a 0-point set is recorded, or the delete dialog opens for the first saved game. | simulator | `js/modules/09-voice-scoring.js` |
| 11 | ⬜ | Medium | Voice "start paper game" and "rematch, X deals first" wipe an in-progress game with no confirmation. | simulator | `js/modules/09-voice-scoring.js` |
| 12 | ⬜ | Medium | Paper photo: unreadable (`null`) cells are imported as a score of 0. | simulator | `api/paper-game-photo.js`, `js/modules/07-paper-game-photo.js` |
| 13 | ⬜ | Low | The photo button cannot choose an existing image on phones: `capture="environment"` opens the camera directly despite the "Choose Image" label. | read (not tried on a device) | `index.html` `#resumePaperPhotoInput` |
| 14 | ⬜ | Low | Smaller voice gaps: "stats" plus a player name appends "show X's stats" to unrelated plans; voice can freeze a finished game; voice dealer order wipes recorded misdeals. | simulator | `api/voice-score-command.js`, `js/modules/09-voice-scoring.js` |

## Game flow

| # | Status | Severity | Bug | Confirmed | Where |
| --- | --- | --- | --- | --- | --- |
| 15 | ⬜ | Low | Home's "New Game" skips the reset when only leftovers remain, so an old Redo stack or a running clock carries into the new game. | simulator | `js/modules/13-home-screen.js` `homeStartNewGame` |
| 16 | ⬜ | Low | Undoing the only round zeroes the game clock, and Redo does not bring it back. | simulator | `js/modules/08-game-actions-logic.js` `handleUndo` |
| 17 | ⬜ | Low | Misdeal has no confirmation, and Undo does not revert it. | simulator | `js/modules/08-game-actions-logic.js` |
| 18 | ⬜ | Low | "Fix Score" after a typo in a History correction removes the last round instead of the typo, and correcting the cell then clears Redo. | simulator | `js/modules/08-game-actions-logic.js`, `js/modules/11-rendering.js` |

## Other

| # | Status | Severity | Bug | Confirmed | Where |
| --- | --- | --- | --- | --- | --- |
| 19 | ⬜ | Low | After an update, an already-open page can load new Statistics / voice / probability code against the old core until the app is relaunched. | read | `service-worker.js`, lazy bundle loaders |
| 20 | ⬜ | Low | Odds and ends: Pro Mode win % favours the trailing team when both totals are negative; startup throws and the loading veil never lifts when the browser blocks site storage; the probability timeline starts a paper game at 0–0. | simulator | `js/modules/02-win-prob-engine.js`, `js/modules/04-theme-ui-helpers.js`, `js/modules/10-probability-explanation.js` |

## Fix log

### 2026-11-14

- **#1 Zero points for the bidding team.** The 180/360 choice now goes to the team opposite the one that got 0, and the dialog names that team ("Did Ann & Bo score 180 or 360?"). Checked in the browser for both sides, plus Cancel. Test: `a 0 gives 180 or 360 to the other team, whichever team the 0 was entered for`.
- **#3 Deleted games coming back.** Deleting a game or resuming a frozen one now writes a small synced record (`removedGames`: list, game key, time). The cloud merge joins the records of both sides and drops a listed game from both, unless the game was stamped later (restored from Recently Deleted). Records expire after 400 days and are capped at 500. No Firestore rule change was needed. Checked in the browser that the records are written; the merge itself is covered by simulator tests only, because the local preview has no Firebase.
- **#4 Failed merge overwriting the cloud.** No list is uploaded until this session has merged with the cloud copy. If the startup merge failed, the next save (or the browser coming back online) runs the merge first and uploads the joined result. Delete All Game Data still writes straight through. Covered by simulator tests only.

Known limits of the #3 fix: a device still running the old app version ignores the records and can re-upload a deleted game until it updates (the next merge from an updated device removes it again), and importing a backup still replaces the records along with everything else.
