# Rook Score! - Digital Score Keeper for Rook

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Rook Score!** is a modern, feature-packed web application designed to make score-keeping for the card game Rook effortless and enjoyable. Built with HTML, Tailwind CSS, and vanilla JavaScript, it leverages Firebase for cloud synchronization and offers a Progressive Web App (PWA) experience.

## ✨ Features

*   **Effortless Scoring:** Intuitive interface for selecting bidding teams, bid amounts (preset or custom), and entering points.
*   **Voice Score Entry:** Enable Experimental Features to complete the microphone-permission onboarding and show the large bottom-right microphone button, then hold it while speaking and release it to process the voice action.
*   **Real-time Score Updates:** Team scores and round numbers update instantly.
*   **Live Game Timer:** Shows the current game's elapsed time, keeps counting through screen locks, app switching, and reloads, and pauses only when a game is frozen or completed.
*   **Detailed Game History:** View a log of all rounds, including bids and running totals.
*   **Undo/Redo Functionality:** Easily correct mistakes in score entry.
*   **Game Management:**
    *   **New Game:** Start fresh with optional custom team names.
    *   **Save & Load Games:** Completed games are automatically saved.
    *   **Game Library:** Browse completed games with search and sort functionality.
    *   **View Game Details:** Review full round-by-round history, duration, and winner for saved games.
    *   **Freezer Games:** Pause an ongoing game to "freeze" it and resume later.
    *   **Resume Paper Games:** Jump into an in-progress paper score sheet by entering current scores and player names. With Experimental Features enabled, take or choose a photo of an `Us | Bid | Dem` sheet to fill the current scores from its bottom completed row.
*   **Cloud Synchronization (Firebase):**
    *   Sign in with Google to securely back up your game data (active game, saved games, freezer games, settings) to the cloud.
    *   Access your data across multiple devices.
    *   Anonymous sign-in is supported for local play, with an option to upgrade to a Google account and merge data.
*   **Team & Player Management:**
    *   Use default "Us" & "Dem" or set custom team names, with optional player names for each side.
    *   Track both **team** and **individual player** statistics: wins, losses, games played, average bid, bid success percentage, 360s, and sandbagger detection.
    *   Delete team statistics (including associated player stats) and associated game data.
*   **Customization:**
    *   **Always-On Dark Theme:** Optimized visuals for low-light environments.
    *   **Customizable Team Colors:** Personalize the "Us" and "Dem" team colors.
    *   **Editable Bid Presets:** Customize the quick bid buttons to your common bid values.
*   **Advanced Gameplay Features:**
    *   **Dealer Tracking:** Enter a four-player dealing order, auto-set teams by pairing with the dealer across the table, and see a dealer badge during play.
    *   **Misdeal Handling:** Optional setting adds a Misdeal button to move to the next dealer without affecting the score.
    *   **Voice Scoring:** Transcribes short score phrases, infers team, bid, points, made/set status, misdeal, and undo actions, and asks for confirmation when the phrase is incomplete.
    *   **Voice Follow-ups:** Remembers the original voice request and the LLM's clarification question so short answers can complete the same request.
    *   **Optional Improvement Sharing:** With Experimental Features enabled, users can separately opt in to share redacted command text, sanitized structured action targets, limited game context, and outcomes for future model improvement. Raw audio and real player/team names are never stored by Rook Score.
    *   **"Must Win By Making Bid" Rule:** Optional game rule setting.
    *   **Pro Mode:** Enables win probability display during active games.
    *   **0-Point Handling:** Smart popup to confirm 180 or 360-point bonus for the bidding team if the opposing team scores 0.
    *   **Table-Talk/Cheating Penalty:** Flag a team for table-talk with configurable penalties (deduct bid amount or a fixed point value).
*   **User Experience:**
    *   Responsive design for all screen sizes (desktop, tablet, mobile).
    *   Smooth animations and transitions.
    *   Confetti celebration on game win!
    *   Save indicator for data persistence.
    *   Hamburger menu with swipe gesture support.
*   **Progressive Web App (PWA):**
    *   Installable on your device for an app-like experience.
    *   Offline capabilities (once cached by the service worker).
*   **Bug Reporting:** In-app issue form with optional privacy-conscious diagnostics and backend email delivery.
*   **Version Tracking:** Displays current app version.

## 🚀 What's New in 2.1

*   **Cartoony Glass Theme:** The default app style now uses the new cartoony 3-D glass treatment.
*   **Bolder Game Cards:** Team cards, round cards, score entry, history, and game-over views have stronger depth, glow, and motion.
*   **Polished Controls:** Buttons, inputs, navigation, color pickers, and modal surfaces now share the same bouncy interaction language.
*   **Statistics Refresh:** Statistics rows, chips, segmented controls, KPI cards, and entity details were restyled to match the new theme.
*   **PWA Color Update:** Theme and background colors were updated so installed/mobile app chrome matches the new visual direction.

## 🛠️ Tech Stack

*   **Frontend:**
    *   HTML5
    *   CSS3 (Tailwind CSS for utility-first styling, custom CSS for theming and animations)
    *   Vanilla JavaScript (ES6+ Modules)
*   **Backend & Services:**
    *   Firebase
        *   Firebase Authentication (Google Sign-In, Anonymous Sign-In)
        *   Firestore (Cloud database for game data synchronization)
    *   Resend
        *   Backend delivery for in-app bug reports
*   **Libraries:**
    *   Canvas Confetti (for win celebrations)
*   **PWA Features:**
    *   Manifest File (`manifest.json`)
    *   Service Worker (`service-worker.js`) for caching and offline capabilities.

## ▶️ Getting Started

### Accessing the App
Simply open the `index.html` file in your web browser, or deploy it to a web server.
For the best experience, access the live deployed version.

### Installation (as a PWA)
Most modern browsers (Chrome, Edge, Safari on iOS) will allow you to "install" the web app to your home screen or desktop:

1.  Open the app in your browser.
2.  Look for an "Install" icon in the address bar or an "Add to Home Screen" option in the browser menu.
3.  Follow the prompts.

This will provide an app-like experience with an icon and potentially offline access.

## 📖 How to Play / Usage

1.  **Start a Game:**
    *   The app loads into an active game state.
    *   To start fresh, open the **menu** (hamburger icon ☰) and select "**New Game**". Confirm if you want to discard any unsaved progress.
    *   If you're continuing from paper scores, use **Menu -> Resume Paper Game** to enter current scores, player names, and dealer order before scoring digitally.
2.  **Team Names (Optional):**
    *   By default, teams are "Us" and "Dem".
    *   To set custom names, you'll be prompted when saving a game for the first time or when freezing a game. You can also proactively set them if you start a "New Game" and then try to save/freeze it immediately.
    *   Alternatively, if you want to set names *before* any rounds are played, start a "New Game", then go to the menu -> "Freeze Game". This will trigger the team name selection. After setting names, you can choose to cancel the freeze if you just wanted to set names.
    *   When dealer order is entered, the app can auto-create teams by pairing players across the table.
3.  **Select Bidding Team:**
    *   Tap on the team card ("Us" or "Dem") that won the bid for the current round. The selected team's card will appear "sunken".
4.  **Enter Bid Amount:**
    *   A panel will appear below the team cards.
    *   Use the **preset bid buttons** (e.g., 120, 125, etc.) or tap "**Other**" and use the in-app number pad for a custom bid amount.
    *   Custom bids must be positive, multiples of 5, and not exceed 360.
5.  **Enter Points Scored:**
    *   Once a valid bid is selected/entered, options to input points will appear.
    *   First, select **whose points you are entering**: the bidding team or the non-bidding team.
    *   Tap the points field to slide the in-app number pad up from the bottom; the app does not open the device keyboard for scoring. Points must be multiples of 5, between 0-180, or exactly 360.
    *   The Us and Dem score cards show the projected totals as the number is entered.
    *   **0-Point Special Handling:** If you enter '0' for a team, a modal will pop up asking if the bidding team should receive a 180 or 360 point bonus (standard Rook rules for "shooting the moon" or taking all points). You can also choose to keep it as 0.
    *   Click "**Submit**".
    *   Alternatively, press and hold the bottom-right microphone while saying a short command like "Dem bid 125 and made 145", "Us bid 130 and got set", "Misdeal, next dealer", "Undo that last hand", "Show Alice's stats", or "Show Alice and Bob's team stats", then release it to process the command. Named statistics commands open the matching saved player or team details. If a set bid omits the other team's points, the app asks before recording the default set score.
6.  **Scoring Logic:**
    *   If the bidding team makes their bid, they get the points they took. The other team gets (180 - points bidding team took).
    *   If the bidding team *fails* to make their bid, they are set back by the amount of their bid (negative points), and the other team scores the points they took.
    *   The total points in a standard hand (excluding the Rook card value if counted separately) are 180. A 360 input implies all points were taken by one team.
7.  **Table-Talk Penalty:**
    *   If a team engages in table-talk/cheating during a hand they bid, click the "📣" (megaphone/shout) icon next to the Undo/Redo buttons while their score input card is active.
    *   Confirm the penalty. Penalties can deduct either the bid amount or a fixed point value (configurable in Settings).
8.  **Game Continues:**
    *   Scores update, the round number increments, and the round details are added to the History card.
    *   The input panel resets for the next round.
9.  **Game Over:**
    *   The game ends when a team reaches 500 points (or more, depending on the "Must win by making bid" setting).
    *   A "Game Over!" overlay appears with the winner and an option to "Save Game" or start a "New Game".
    *   If "Save Game" is clicked, you might be prompted for team names if not already set. The game is then saved to the "Game Library".

### Menu Options
Accessible via the hamburger icon (☰) in the top-left:

*   **View Games:** Opens the "Game Library" modal to browse completed and freezer games.
*   **Resume Paper Game:** Enter existing scores, players, and dealer order to pick up a game from paper tracking.
*   **New Game:** Starts a new game, discarding current progress (with confirmation).
*   **Freeze Game:** Saves the current game state to "Freezer Games" and starts a new game. Useful for pausing a game to resume later.
*   **Settings:** Opens the settings modal (see "Settings & Customization" below).
*   **About:** Shows information about the app, features, and a bug report option.
*   **Statistics:** Displays overall and team-specific statistics.
*   **Sign in/out with Google:** Manages Firebase cloud synchronization.

### Key Modals

*   **Game Library (`View Games`):**
    *   Tabs for "Completed Games" and "Freezer Games".
    *   Search and sort functionality.
    *   View details of completed games or load/delete freezer games.
*   **Resume Paper Game:** A guided modal to enter current scores and player names so you can keep playing digitally. Its experimental photo reader uses the app's configured OpenRouter model to read the bottom completed `Us | Bid | Dem` row; the user reviews the filled scores before starting.
*   **View Saved Game Details:** A read-only detailed view of a completed game's rounds and stats.
*   **Team Selection:** Prompts for "Us" and "Dem" team names, allowing selection from previously used names or adding new ones. Dealer entry can auto-create the two teams.
*   **Settings:** Configure game rules, Pro Mode, Experimental Features, table-talk penalties, misdeal handling, theme colors, and bid presets.
*   **Theme Customization:** Pick custom primary (Us) and accent (Dem) colors.
*   **Confirmation:** A generic modal to confirm actions like starting a new game, deleting items, etc.
*   **Zero Points Helper:** Assists in correctly scoring when one team gets 0 points.
*   **About:** App information, changelog, and bug report link.
*   **Statistics:** View various game, team, and individual player statistics.

## ⚙️ Settings & Customization

Access these via **Menu -> Settings**:

*   **Game Rules:**
    *   **Must win by making bid:** If enabled, the bidding team must achieve their bid value to win the game, even if their total score is over 500 but they failed their last bid.
    *   **Misdeal Handling:** Show a Misdeal button to skip to the next dealer without changing scores.
*   **Appearance & Features:**
    *   **Pro Mode:** Toggle to enable/disable the win probability display during active games.
    *   **Experimental Features:** Show preview controls such as the microphone-powered voice actions. This is off by default.
    *   **Help improve voice actions:** When Experimental Features is on, separately opt in or out of sharing redacted command text, sanitized structured action targets, limited game context, and action outcomes. This control is hidden when Experimental Features is off.
    *   **Customize Theme Colors:** Opens a modal to pick custom colors for "Us" and "Dem" teams using color pickers. Includes options to randomize or reset to defaults.
    *   **Edit Bid Presets:** Opens a modal to customize the values for the quick bid buttons. Values must be multiples of 5.
    *   **Table-Talk Penalties:** Choose whether penalties subtract the bid amount or a custom point value (multiples of 5).

## 🔥 Firebase Cloud Sync

*   **Sign In:** Use the "Sign in with Google" option in the menu.
*   **Benefits:**
    *   Your active game state, saved games, freezer games, team names, and appearance settings (theme colors, pro mode, bid presets) are automatically backed up to Firebase.
    *   Access your data seamlessly across different devices by signing in with the same Google account.
*   **Anonymous Users:** If you don't sign in, the app will use anonymous Firebase authentication. Your data is still saved locally. If you later sign in with Google, your local data will be merged with any existing cloud data.
*   **Data Merging:** When signing in or switching accounts, the app attempts to intelligently merge local and cloud data, prioritizing local data for the active game to prevent overwriting unsaved changes and merging arrays of games.

## 📱 Progressive Web App (PWA)

Rook Score! is a PWA, offering:
*   **Installability:** Add it to your home screen on mobile or desktop for quick access.
*   **Offline Access:** Once the app and its assets are cached by the service worker, you can use it even without an internet connection (Firebase sync will resume when connectivity is restored).
*   **App-like Experience:** Runs in its own window, providing a more focused experience.

## 🔧 Development

### Prerequisites
A modern web browser. No complex build steps are required for local development of this single `index.html` file.

### Running Locally
1.  Clone or download this repository.
2.  Simply open the `index.html` file in your web browser for local-only scoring.
3.  To test Firebase cloud sync locally, run the app through Vercel with the Firebase environment variables below.

### Vercel Environment Variables
Firebase cloud sync and AI voice scoring are configured through Vercel serverless endpoints instead of hardcoded source values. Add these variables in Vercel for Production, Preview, and Development as needed:

```text
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
OPENROUTER_API_KEY
OPENROUTER_MODEL
VOICE_SCORE_OPENROUTER_MODEL
OPENROUTER_FALLBACK_MODELS
OPENROUTER_SITE_URL
OPENROUTER_APP_TITLE
VOICE_SCORE_COMMAND_LOCAL_FALLBACK
RESEND_API_KEY
BUG_REPORT_TO_EMAIL
BUG_REPORT_FROM_EMAIL
BUG_REPORT_ALLOWED_ORIGINS
```

The in-app bug report endpoint sends through Resend. `BUG_REPORT_TO_EMAIL` defaults to `heinonenmh@gmail.com`, and `BUG_REPORT_FROM_EMAIL` defaults to `Rook Score <onboarding@resend.dev>`. The Resend onboarding sender is suitable while testing with the email address associated with the Resend account. For general production delivery, verify a sending domain in Resend and set `BUG_REPORT_FROM_EMAIL` to an address on that domain.

Voice recordings are captured as compact mono speech audio and uploaded as binary data to the OpenRouter chat model (no separate transcription step or phone-side Base64 conversion). `VOICE_SCORE_OPENROUTER_MODEL` is optional; the voice command planner defaults to `thinkingmachines/inkling-small:free` with low reasoning effort. The paper-game photo endpoint continues to use `OPENROUTER_MODEL`, which defaults to `google/gemini-3.1-flash-lite`. `OPENROUTER_FALLBACK_MODELS` is an optional comma-separated model list and defaults to `google/gemini-2.5-flash` for automatic model failover. `OPENROUTER_SITE_URL` and `OPENROUTER_APP_TITLE` are optional OpenRouter attribution headers.
`VOICE_SCORE_COMMAND_LOCAL_FALLBACK` is optional; local development enables a narrow fallback planner by default so provider 502s do not block voice-action testing. Set it to `false` to test provider-only failures.

Enabling Experimental Features opens a one-time, device-local onboarding dialog. Continuing requests microphone permission and immediately stops the permission-check stream without recording. Optional model-improvement consent is stored separately from the Experimental Features setting and defaults to off. Its Settings control is visible only while Experimental Features is enabled, and submissions require both settings to be on.

When improvement sharing is enabled, the existing planner response supplies a text transcription without a second model call. Before one Firestore document is created, Rook Score replaces known player/team names and common email/phone patterns. Schema version 2 stores the redacted command, the planner's sanitized structured target (`status`, confirmation requirement, and full whitelisted action arguments), the final execution outcome, and a pre-execution snapshot of limited game state. That context uses placeholders such as `Player 1`, keeps only the scoring/dealer/statistics identifiers needed to resolve the command, and omits real names and unrelated game-library details. Raw audio, Base64 audio, account profile fields, and unsanitized action or game payloads are never stored.

The voice LLM uses a fixed, server-validated catalog of 27 safe app actions:

- Scoring and game state: score or edit a round, undo, redo, record a misdeal, start/reset, freeze, save, or rematch a game.
- Setup and gameplay: set teams or dealer order, start from paper scores, choose the dealer pair or bid, change rules, and apply a table-talk penalty.
- Navigation and account: open or close app panels, toggle the menu, sign in or out, confirm or cancel a visible prompt, and view/search/sort/delete/resume games.
- Personalization and statistics: set theme colors, randomize/reset/apply the theme, edit bid presets, and change statistics view, metric, sort, or selected entity.
- `noop` safely records that no action should be taken.

The planner can return up to five ordered actions for one compound request. It cannot execute arbitrary JavaScript, access unrelated device data, grant microphone permission, or submit the bug-report form; those remain explicit user actions.

For local Vercel development, copy `.env.example` to `.env.local`, fill in the values from your Firebase web app config, and run:

```bash
npx vercel dev
```

Opening `index.html` directly still works for local scoring. LLM voice actions, Google sign-in, and Firestore sync require the Vercel `/api` endpoints.

### Google Analytics
Google Analytics is loaded from `js/analytics.js` on the GitHub Pages host for `https://marvj69.github.io/rook_score/` using the GA4 web stream Measurement ID `G-MCY1GMM4L5`.

### Firestore Rules

The checked-in `firestore.rules` keeps existing `rookData/{userId}` documents owner-only and permits authenticated users to create strictly validated samples under `voiceImprovement/{userId}/samples/{sampleId}`. Client reads, updates, and deletes of improvement samples are denied. Deploy the rules with:

```bash
npx firebase-tools deploy --only firestore:rules --project YOUR_FIREBASE_PROJECT_ID
```

### GitHub Pages
The GitHub Pages build stays fully static. When the app runs from `https://marvj69.github.io/rook_score/`, it uses `https://rook-score.vercel.app` for Firebase config, LLM voice actions, experimental paper-game photo reading, and in-app bug-report delivery. Those endpoints use separate CORS allowlists. If you move the Pages site to a different account or custom domain, add that origin to the Vercel endpoint allowlists or set `FIREBASE_CONFIG_ALLOWED_ORIGINS`, `VOICE_SCORE_ALLOWED_ORIGINS`, `PAPER_GAME_PHOTO_ALLOWED_ORIGINS`, and `BUG_REPORT_ALLOWED_ORIGINS` in Vercel.

### Firebase Setup (If forking or self-hosting with cloud sync)
If you want to use your own Firebase backend:
1.  Go to the [Firebase Console](https://console.firebase.google.com/).
2.  Create a new Firebase project.
3.  Add a Web app to your project.
4.  Copy the Firebase configuration values into the matching Vercel environment variables listed above.
5.  **Enable Firebase Services:**
    *   **Authentication:** Enable "Google" and "Anonymous" sign-in methods in the Firebase Authentication section.
    *   **Firestore:** Create a Firestore database in "Production mode".
        *   **Security Rules:** Deploy the checked-in `firestore.rules`, which covers both owner-only cloud sync and create-only voice-improvement samples. You can use the Firebase CLI command in the Firestore Rules section above or paste the file into the Firebase Console Rules tab.
    *   **API key restriction:** Firebase web app API keys are visible to browsers at runtime. In Google Cloud Console, restrict the key to the required Firebase APIs and your approved HTTP referrers, then rotate any key that was previously committed or deployed publicly.

## Contributing

Contributions are welcome! If you have ideas for improvements or find bugs:
1.  Fork the repository.
2.  Create a new branch (`git checkout -b feature/AmazingFeature`).
3.  Make your changes.
4.  Commit your changes (`git commit -m 'Add some AmazingFeature'`).
5.  Push to the branch (`git push origin feature/AmazingFeature`).
6.  Open a Pull Request.

## Bug Reports & Feedback

Found a bug or have a suggestion?
*   Use the "**Report an Issue**" button in the "About" modal.
*   Complete the in-app form and optionally include diagnostics. Diagnostics exclude player names, team names, saved games, and account IDs.
*   The Vercel backend validates the report and sends it to the configured owner email through Resend; the user's email app never opens.
*   Alternatively, open an issue on this GitHub repository. Please include steps to reproduce the bug and any relevant console errors.

## 📝 License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details (if you create one, otherwise state MIT License).

## 🧑‍💻 Author

Mark Heinonen
*   Email: `heinonenmh@gmail.com`

---
Enjoy keeping score for your Rook games!
