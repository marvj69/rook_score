# Rook Score bug list

From the app scan on 2026-11-13 (tests, a hands-on pass at phone size, and a code read of every module).

**Status key:** ✅ fixed · 🔧 in progress · ⬜ open

**Progress:** 20 of 20 fixed (last updated 2026-11-18)

| Area | Fixed | Open |
| --- | --- | --- |
| Scoring | 2 | 0 |
| Cloud sync | 6 | 0 |
| Voice and photo (experimental) | 6 | 0 |
| Game flow | 4 | 0 |
| Other | 2 | 0 |

How each bug was confirmed is noted in its row: **browser** (reproduced by hand in the app), **simulator** (reproduced in Node against the real module with a fake Firestore or DOM), or **read** (traced in the code only).

## Scoring

| # | Status | Severity | Bug | Confirmed | Where |
| --- | --- | --- | --- | --- | --- |
| 1 | ✅ | High | Typing 0 for the **bidding** team opens "Did the Bidding team score 180 or 360?" and either choice gives the bidder those points. The live preview shows the opposite (bidder set). | browser | `js/modules/08-game-actions-logic.js` `submitRoundFromCurrentInputs` |
| 2 | ✅ | Medium | Rematch saves the finished game with a guessed "Us" pair (seats 1 & 3) when a dealing order exists but teams were never named. Save and Freeze ask; Rematch does not, so the win lands on the wrong players half the time. | read (a test asserts it) | `js/modules/08-game-actions-logic.js` `startRematchWithFirstDealer` |

## Cloud sync

| # | Status | Severity | Bug | Confirmed | Where |
| --- | --- | --- | --- | --- | --- |
| 3 | ✅ | High | Deleting one game, or resuming a frozen one, is undone by the next merge. Saved and frozen lists merge as a union with no per-game delete record, so a second device (or a delete made offline) brings the game back. | simulator | `js/firebase-init.js` `mergeLocalStorageWithFirestore` |
| 4 | ✅ | High | A failed startup merge does not stop later saves, so the next save writes this device's shorter list over the cloud copy. | simulator | `js/firebase-init.js` `flushPendingSync` |
| 5 | ✅ | Medium | Default rule settings overwrite the cloud copy on a new device. Every launch writes the table-talk penalty type, and closing Settings writes the other rule toggles; at sign-in the local value wins. | browser (the writes), read (the merge) | `js/modules/13-settings-loading.js`, `js/modules/09-settings-validation-misc.js` |
| 6 | ✅ | Medium | A save, delete, freeze or resume made while the startup merge is writing replaces the just-merged cloud lists with the local-only list. | simulator | `js/firebase-init.js` (changes-during-merge write) |
| 7 | ✅ | Medium | All synced data lives in one Firestore document. Past 1 MiB (roughly 370–560 saved games) every sync write fails, and nothing tells the user. | read plus size arithmetic | `js/firebase-init.js` |
| 8 | ✅ | Low | Delete All Game Data is rejected, and the data comes back, when the account's existing delete marker is ahead of this device's clock. | simulator | `js/modules/13-delete-game-data.js` `nextGameDataResetMarker` |

## Voice and photo (experimental)

| # | Status | Severity | Bug | Confirmed | Where |
| --- | --- | --- | --- | --- | --- |
| 9 | ✅ | High | A "clarify" or "unsupported" voice plan that carries actions is executed, so a hand can be recorded while the app is asking a question. | simulator | `api/voice-score-command.js` `normalizePlan`, `js/modules/09-voice-scoring.js` |
| 10 | ✅ | Medium | `null` / `""` fields from the voice model are applied as 0: a round's totals are zeroed, a 0-point set is recorded, or the delete dialog opens for the first saved game. | simulator | `js/modules/09-voice-scoring.js` |
| 11 | ✅ | Medium | Voice "start paper game" and "rematch, X deals first" wipe an in-progress game with no confirmation. | simulator | `js/modules/09-voice-scoring.js` |
| 12 | ✅ | Medium | Paper photo: unreadable (`null`) cells are imported as a score of 0. | simulator | `api/paper-game-photo.js`, `js/modules/07-paper-game-photo.js` |
| 13 | ✅ | Low | The photo button cannot choose an existing image on phones: `capture="environment"` opens the camera directly despite the "Choose Image" label. | read (not tried on a device) | `index.html` `#resumePaperPhotoInput` |
| 14 | ✅ | Low | Smaller voice gaps: "stats" plus a player name appends "show X's stats" to unrelated plans; voice can freeze a finished game; voice dealer order wipes recorded misdeals. | simulator | `api/voice-score-command.js`, `js/modules/09-voice-scoring.js` |

## Game flow

| # | Status | Severity | Bug | Confirmed | Where |
| --- | --- | --- | --- | --- | --- |
| 15 | ✅ | Low | Home's "New Game" skips the reset when only leftovers remain, so an old Redo stack or a running clock carries into the new game. | simulator | `js/modules/13-home-screen.js` `homeStartNewGame` |
| 16 | ✅ | Low | Undoing the only round zeroes the game clock, and Redo does not bring it back. | simulator | `js/modules/08-game-actions-logic.js` `handleUndo` |
| 17 | ✅ | Low | Misdeal has no confirmation, and Undo does not revert it. | simulator | `js/modules/08-game-actions-logic.js` |
| 18 | ✅ | Low | "Fix Score" after a typo in a History correction removes the last round instead of the typo, and correcting the cell then clears Redo. | simulator | `js/modules/08-game-actions-logic.js`, `js/modules/11-rendering.js` |

## Other

| # | Status | Severity | Bug | Confirmed | Where |
| --- | --- | --- | --- | --- | --- |
| 19 | ✅ | Low | After an update, an already-open page can load new Statistics / voice / probability code against the old core until the app is relaunched. | read | `service-worker.js`, lazy bundle loaders |
| 20 | ✅ | Low | Odds and ends: Pro Mode win % favours the trailing team when both totals are negative; startup throws and the loading veil never lifts when the browser blocks site storage; the probability timeline starts a paper game at 0–0. | simulator | `js/modules/02-win-prob-engine.js`, `js/modules/04-theme-ui-helpers.js`, `js/modules/10-probability-explanation.js` |

## Fix log

### 2026-11-18

- **#8 and concurrent cloud saves.** A full deletion advances past the account's last acknowledged reset even on a slow clock. Queued writes retain their original account. Saved games, frozen games and individual deletions are reconciled in a Firestore transaction. Verified simultaneous saves, a deletion during another save, recovery on a fresh device, and an account-specific reset with the Firestore emulator and the project's rules.
- **#12–14, voice and photo.** An unreadable final score asks for another photo. An incomplete history imports only the readable final pair. A genuine zero remains a score, and the image picker accepts existing photos. Named statistics requests, dealer changes and freezing now respect the same game state as their manual controls. A spoken confirmation applies only to the dialog that was open when recording began.
- **#15–18, game recovery.** Starting fresh clears the prior clock and redo history. Undo and Redo preserve elapsed time and reverse newly recorded misdeals in sequence with the hands. Fix Score reverses the History correction that ended the game, including after a reload. Resuming a frozen game keeps the frozen copy until the active scoreboard has been saved successfully.
- **#19, offline updates.** Each release caches the scoreboard and its optional modules together. Tested in Chromium and WebKit with two successive releases. A tab kept its own Statistics module while an update waited, and the next release reopened the saved game with the origin offline.
- **#20, odds and startup.** The probability timeline shows the actual paper starting totals and begins its estimates at the first tracked hand. Below the model's observed combined-score minimum of −300, the score interactions use that lower bound. The app can also open when the browser blocks site storage.

### 2026-11-15

- **#7 The cloud document's 1 MiB limit.** The finished-games list, which is nearly all of the document, is now uploaded gzipped in a new field (`savedGamesPacked`), about an eighth to a tenth of the size: 520 games that take 1.10 MB as plain JSON make a 107 KB document. The limit moves from roughly 370–560 games to several thousand, past what a browser's own storage holds. The pack is a list of 1,000-character pieces, because Firestore limits an indexed value to 1,500 bytes. The plain `savedGames` field stays readable: older app versions (and browsers without `CompressionStream`) still write it, and the next merge joins those games into the pack and empties the field. A pack written before an older version's "Delete All Game Data" keeps only the games stamped after that delete. A pack this version cannot read stops the merge, so nothing is uploaded over it. If Firestore refuses a packed write as invalid, the session falls back to the plain list at once, which is the behaviour from before this change. If a write is still refused for size, a signed-in player is told once per session ("Cloud sync is full. New games stay on this device."); an anonymous session is not. The training export script reads the pack too. No Firestore rule change was needed. Checked by running the shipped `js/firebase-init.js` in Chromium and in WebKit against a fake Firestore that enforces the 1 MiB limit: 520 games merge, read back byte for byte, a later save reaches the pack, and a second empty device receives every game with no write. Tests: `saved games sync packed, so a list past the 1 MiB document limit still uploads and reads back whole`, `games an older app version uploads after the pack exists are joined into it`, `an unchanged packed list costs no write, and removals and mid-merge saves reach the pack`, `Delete All Game Data clears the packed list, also when an older app version made the delete`, `a packed list this version cannot read stops the merge instead of being overwritten`, `a browser that cannot pack keeps the plain list and never touches the pack`, `a cloud copy that is full says so once to a signed-in player and never to an anonymous session`, `if the cloud refuses the packed list, the session falls back to the plain list instead of stalling`, `a list too large even when packed is reported once, after the plain retry also fails`.
- **#10 Empty voice fields applied as 0.** A field the voice model leaves `null` or `""` is now dropped, on the server and again in the app, and every number a voice action uses is read strictly (`null`, `""` and `false` are "not given", not 0). A hand, a correction or a bid without its number is refused with what to say ("Say how many points were made."). A round edit changes only the totals that were given. Delete, view and resume need a game number, so no dialog opens for the first saved game. A setting with no value is refused instead of being switched off. A spoken zero still counts: "made 0" records a set and "change the total to 0" applies. Checked in Chromium and WebKit against the shipped voice bundle. Tests: `the voice planner's empty fields are dropped on the server and in the app`, `a voice hand, correction or bid with a missing number is refused instead of recorded as 0`, `a voice round edit changes only the totals that were given`, `voice does not pick the first saved game, start a paper game, or change a setting from an empty field`.
- **#11 Voice replacing a game with no confirmation.** A voice paper game over a scoreboard that has hands on it, and a voice rematch over a game that is still being played, now open the same "This replaces the game on the scoreboard, including its N hands of history" question the Paper Game form uses, and nothing changes until it is answered. Cancel keeps every hand. The voice reply says "Confirm replacing the current game." instead of the model's "started" wording, and any later action in the same plan is not run on the old game. A plan the player already confirmed by voice does not ask twice, a paper game with no hands on the board starts at once, and a rematch of a finished game still saves it and starts with no extra question. Checked in Chromium and WebKit at phone size for both flows: ask, Cancel, confirm. Tests: `a voice paper game asks before replacing hands on the scoreboard, and waits for the answer`, `a voice paper game already confirmed by voice does not ask a second time`, `a voice rematch asks before discarding a game that is still being played`, `a voice rematch of a finished game still saves it and starts without an extra question`.

Known limits of the #7 fix: it was not run against the real Firestore database (the local preview has no Firebase), so the first sync on a signed-in device after this ships is the real test; the plain-list fallback covers a refusal there. Until every device has updated, an older version keeps re-uploading its plain list at each launch and the next updated device packs and empties it again; an older version does not receive games that only exist in the pack until it updates. The browser's own storage is now the smaller limit, and a full device already says so when a save fails.

Known limits of the #11 fix: a voice rematch asks only when the game is unfinished, so a finished game goes straight to the saved list as before. Picking a dealer in the Choose First Dealer dialog by hand during an unfinished game is unchanged; voice only reaches that dialog after the question above.

### 2026-11-14

- **#1 Zero points for the bidding team.** The 180/360 choice now goes to the team opposite the one that got 0, and the dialog names that team ("Did Ann & Bo score 180 or 360?"). Checked in the browser for both sides, plus Cancel. Test: `a 0 gives 180 or 360 to the other team, whichever team the 0 was entered for`.
- **#2 Rematch guessing the "Us" pair.** With a dealing order but no team names, Rematch now opens the same "Which pair is Us?" question Save uses, then goes straight on to Choose First Dealer (no name form, since the four players are already known). Nothing is saved until the pair is chosen, and Cancel leaves the finished game on screen. Voice "rematch, X deals first" asks the same question instead of saving. The internal win/loss tally, which had to assume seats 1 & 3 when the game ended, now moves to the chosen pairs (also when names are entered through Save). Checked in the browser at phone size for both pairs, Cancel, a rematch with named teams, and Save. Test: `a rematch asks which pair is "Us" instead of guessing it from the dealing order`.
- **#3 Deleted games coming back.** Deleting a game or resuming a frozen one now writes a small synced record (`removedGames`: list, game key, time). The cloud merge joins the records of both sides and drops a listed game from both, unless the game was stamped later (restored from Recently Deleted). Records expire after 400 days and are capped at 500. No Firestore rule change was needed. Checked in the browser that the records are written; the merge itself is covered by simulator tests only, because the local preview has no Firebase.
- **#4 Failed merge overwriting the cloud.** No list is uploaded until this session has merged with the cloud copy. If the startup merge failed, the next save (or the browser coming back online) runs the merge first and uploads the joined result. Delete All Game Data still writes straight through. Covered by simulator tests only.
- **#9 Voice plans that ask a question but still act.** Only "execute" and "confirm" plans can carry actions now. A "clarify" or "unsupported" plan has its actions removed on the server and again in the app, the same way an "answer" already did, so the question is asked and nothing is recorded. Checked in the browser against the shipped voice bundle: a clarify and an unsupported plan carrying a score (and a new-game) action left the game untouched, and the same action under "execute" recorded the hand. Test: `a voice plan that asks a question or declines never runs the actions it carries`.
- **#5 Default rule settings overwriting the account.** Three changes. Launch no longer stores the table-talk penalty type (loading settings only reads now). Closing Settings stores a rule only if it differs from the value in effect, so untouched defaults are never written. And the first time a device syncs with an account, the account's values for the four rule settings (must win by bid, misdeal handling, penalty type, penalty points) win; this covers devices that already stored defaults under the old version. After that first sync a rule changed on the device wins as before, and a rule changed while that first sync is running is kept. Checked in the browser on a fresh install: launch and opening and closing Settings store no rule, a changed toggle and penalty type are stored and survive a reload. The first-sync rule is covered by simulator tests only. Tests: `loading or closing Settings stores nothing until a rule is actually changed`, `a device joining an account for the first time takes the account's rule settings`.
- **#6 Changes made while the startup merge is writing.** A saved or frozen list that changes mid-merge is now joined with the list the merge just built (and the removal records applied) before it is uploaded, and the joined list is stored on the device too. A delete or resume made in that window stays deleted, and Delete All Game Data still clears the list. The save's own queued upload now sends the stored list, so it cannot take the cloud's games back out a moment later. Covered by simulator tests only. Tests: `a save made while the startup merge is writing keeps the games the merge brought in`, `a delete or resume made while the startup merge is writing stays deleted without losing cloud games`, `Delete All Game Data made while the startup merge is writing is not undone by the merged lists`.

Known limits of the #3 fix: a device still running the old app version ignores the records and can re-upload a deleted game until it updates (the next merge from an updated device removes it again), and importing a backup still replaces the records along with everything else.

Known limits of the #5 fix: a rule changed on a new device before it first signs in to an account that already has that rule set is replaced by the account's value. If a sync lands while the Settings sheet is open, the sheet still shows the old values and closing it stores them.
