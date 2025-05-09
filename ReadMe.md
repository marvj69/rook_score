# Rook Score! - Digital Score Keeper for Rook

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Rook Score!** is a modern, feature-packed web application designed to make score-keeping for the card game Rook effortless and enjoyable. Built with HTML, Tailwind CSS, and vanilla JavaScript, it leverages Firebase for cloud synchronization and offers a Progressive Web App (PWA) experience.

## ✨ Features

*   **Effortless Scoring:** Intuitive interface for selecting bidding teams, bid amounts (preset or custom), and entering points.
*   **Real-time Score Updates:** Team scores and round numbers update instantly.
*   **Detailed Game History:** View a log of all rounds, including bids and running totals.
*   **Undo/Redo Functionality:** Easily correct mistakes in score entry.
*   **Game Management:**
    *   **New Game:** Start fresh with optional custom team names.
    *   **Save & Load Games:** Completed games are automatically saved.
    *   **Game Library:** Browse completed games with search and sort functionality.
    *   **View Game Details:** Review full round-by-round history, duration, and winner for saved games.
    *   **Freezer Games:** Pause an ongoing game to "freeze" it and resume later.
*   **Cloud Synchronization (Firebase):**
    *   Sign in with Google to securely back up your game data (active game, saved games, freezer games, settings) to the cloud.
    *   Access your data across multiple devices.
    *   Anonymous sign-in is supported for local play, with an option to upgrade to a Google account and merge data.
*   **Team Management & Statistics:**
    *   Use default "Us" & "Dem" or set custom team names.
    *   Track team statistics: wins, losses, games played, average bid, bid success percentage, 360s, and sandbagger detection.
    *   Delete team statistics and associated game data.
*   **Customization:**
    *   **Dark Mode:** Sleek dark theme for comfortable viewing.
    *   **Customizable Team Colors:** Personalize the "Us" and "Dem" team colors.
    *   **Editable Bid Presets:** Customize the quick bid buttons to your common bid values.
*   **Advanced Gameplay Features:**
    *   **"Must Win By Making Bid" Rule:** Optional game rule setting.
    *   **Pro Mode:** Enables win probability display during active games.
    *   **0-Point Handling:** Smart popup to confirm 180 or 360-point bonus for the bidding team if the opposing team scores 0.
    *   **Table-Talk/Cheating Penalty:** Flag a team for table-talk, automatically making them lose their bid for that hand.
*   **User Experience:**
    *   Responsive design for all screen sizes (desktop, tablet, mobile).
    *   Smooth animations and transitions.
    *   Confetti celebration on game win!
    *   Save indicator for data persistence.
    *   Hamburger menu with swipe gesture support.
*   **Progressive Web App (PWA):**
    *   Installable on your device for an app-like experience.
    *   Offline capabilities (once cached by the service worker).
*   **Bug Reporting:** Easy "Create Bug Report Email" option with pre-filled device and app state info.
*   **Version Tracking:** Displays current app version.

## 🚀 What's New in v1.4.5

*   **Improved 0-Point Handling:** Added a smart popup to confirm if a 0-point team should trigger a 180 or 360-point bonus to the bidding team.
*   **Table-Talk Feature:** New "Table-Talk" button lets you penalize the offending team by removing their bid for the current hand.
*   **Pro Mode:** Unlock win probability display during games.
*   **Sandbagger Statistic:** Identifies teams who frequently "sandbag" based on game history.
*   **Unified Settings Modal:** Access game rules, Pro Mode, theme color customization, and bid presets from a new centralized settings menu.
    *   **Game Rules:** Toggle "Must win by making bid" to require the bidder to make their bid to win, even if over 500 points.
    *   **Customize Theme Colors:** Personalize team colors for "Us" and "Dem".
    *   **Edit Bid Presets:** Change the quick bid buttons to your preferred values.
*   **UI Overhaul:** Major visual and usability improvements throughout the app for a cleaner, more modern experience.
*   **Enhanced Game Library:** Separate tabs for "Completed Games" and "Freezer Games" with individual counts, search, and sort functionality.
*   Various bug fixes and performance enhancements.

## 🛠️ Tech Stack

*   **Frontend:**
    *   HTML5
    *   CSS3 (Tailwind CSS for utility-first styling, custom CSS for theming and animations)
    *   Vanilla JavaScript (ES6+ Modules)
*   **Backend & Services:**
    *   Firebase
        *   Firebase Authentication (Google Sign-In, Anonymous Sign-In)
        *   Firestore (Cloud database for game data synchronization)
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
2.  **Team Names (Optional):**
    *   By default, teams are "Us" and "Dem".
    *   To set custom names, you'll be prompted when saving a game for the first time or when freezing a game. You can also proactively set them if you start a "New Game" and then try to save/freeze it immediately.
    *   Alternatively, if you want to set names *before* any rounds are played, start a "New Game", then go to the menu -> "Freeze Game". This will trigger the team name selection. After setting names, you can choose to cancel the freeze if you just wanted to set names.
3.  **Select Bidding Team:**
    *   Tap on the team card ("Us" or "Dem") that won the bid for the current round. The selected team's card will appear "sunken".
4.  **Enter Bid Amount:**
    *   A panel will appear below the team cards.
    *   Use the **preset bid buttons** (e.g., 120, 125, etc.) or tap "**Other**" to enter a custom bid amount.
    *   Custom bids must be positive, multiples of 5, and not exceed 360.
5.  **Enter Points Scored:**
    *   Once a valid bid is selected/entered, options to input points will appear.
    *   First, select **whose points you are entering**: the bidding team or the non-bidding team.
    *   Enter the points in the input field. Points must be multiples of 5, between 0-180, or exactly 360.
    *   **0-Point Special Handling:** If you enter '0' for a team, a modal will pop up asking if the bidding team should receive a 180 or 360 point bonus (standard Rook rules for "shooting the moon" or taking all points). You can also choose to keep it as 0.
    *   Click "**Submit**".
6.  **Scoring Logic:**
    *   If the bidding team makes their bid, they get the points they took. The other team gets (180 - points bidding team took).
    *   If the bidding team *fails* to make their bid, they are set back by the amount of their bid (negative points), and the other team scores the points they took.
    *   The total points in a standard hand (excluding the Rook card value if counted separately) are 180. A 360 input implies all points were taken by one team.
7.  **Table-Talk Penalty:**
    *   If a team engages in table-talk/cheating during a hand they bid, click the "📣" (megaphone/shout) icon next to the Undo/Redo buttons while their score input card is active.
    *   Confirm the penalty. The bidding team will automatically lose their bid amount for that hand.
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
*   **New Game:** Starts a new game, discarding current progress (with confirmation).
*   **Freeze Game:** Saves the current game state to "Freezer Games" and starts a new game. Useful for pausing a game to resume later.
*   **Settings:** Opens the settings modal (see "Settings & Customization" below).
*   **About:** Shows information about the app, features, and a bug report option.
*   **Statistics:** Displays overall and team-specific statistics.
*   **Dark Mode:** Toggles between light and dark themes.
*   **Sign in/out with Google:** Manages Firebase cloud synchronization.

### Key Modals

*   **Game Library (`View Games`):**
    *   Tabs for "Completed Games" and "Freezer Games".
    *   Search and sort functionality.
    *   View details of completed games or load/delete freezer games.
*   **View Saved Game Details:** A read-only detailed view of a completed game's rounds and stats.
*   **Team Selection:** Prompts for "Us" and "Dem" team names, allowing selection from previously used names or adding new ones.
*   **Settings:** Configure game rules, Pro Mode, theme colors, and bid presets.
*   **Theme Customization:** Pick custom primary (Us) and accent (Dem) colors.
*   **Confirmation:** A generic modal to confirm actions like starting a new game, deleting items, etc.
*   **Zero Points Helper:** Assists in correctly scoring when one team gets 0 points.
*   **About:** App information, changelog, and bug report link.
*   **Statistics:** View various game and team statistics.

## ⚙️ Settings & Customization

Access these via **Menu -> Settings**:

*   **Game Rules:**
    *   **Must win by making bid:** If enabled, the bidding team must achieve their bid value to win the game, even if their total score is over 500 but they failed their last bid.
*   **Appearance & Features:**
    *   **Pro Mode:** Toggle to enable/disable the win probability display during active games.
    *   **Customize Theme Colors:** Opens a modal to pick custom colors for "Us" and "Dem" teams using color pickers. Includes options to randomize or reset to defaults.
    *   **Edit Bid Presets:** Opens a modal to customize the values for the quick bid buttons. Values must be multiples of 5.

## 🔥 Firebase Cloud Sync

*   **Sign In:** Use the "Sign in with Google" option in the menu.
*   **Benefits:**
    *   Your active game state, saved games, freezer games, team names, and settings (dark mode, pro mode, custom theme, bid presets) are automatically backed up to Firebase.
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
2.  Simply open the `index.html` file in your web browser.

### Firebase Setup (If forking or self-hosting with cloud sync)
If you want to use your own Firebase backend:
1.  Go to the [Firebase Console](https://console.firebase.google.com/).
2.  Create a new Firebase project.
3.  Add a Web app to your project.
4.  Copy the Firebase configuration object provided.
5.  In `index.html`, find the `firebaseConfig` object (around line 700) and replace it with your project's configuration.
    ```javascript
    const firebaseConfig = {
      apiKey: "YOUR_API_KEY",
      authDomain: "YOUR_AUTH_DOMAIN",
      projectId: "YOUR_PROJECT_ID",
      storageBucket: "YOUR_STORAGE_BUCKET",
      messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
      appId: "YOUR_APP_ID"
    };
    ```
6.  **Enable Firebase Services:**
    *   **Authentication:** Enable "Google" and "Anonymous" sign-in methods in the Firebase Authentication section.
    *   **Firestore:** Create a Firestore database in "Production mode".
        *   **Security Rules:** For basic functionality, you can start with rules that allow authenticated users to read/write their own data. A common pattern is:
            ```json
            rules_version = '2';
            service cloud.firestore {
              match /databases/{database}/documents {
                // Allow users to read and write only their own data in the 'rookData' collection
                match /rookData/{userId} {
                  allow read, write: if request.auth != null && request.auth.uid == userId;
                }
              }
            }
            ```
            Apply these rules in the "Rules" tab of your Firestore database.

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
*   Use the "**Create Bug Report Email**" button in the "About" modal in the app.
*   Alternatively, open an issue on this GitHub repository. Please include steps to reproduce the bug and any relevant console errors.

## 📝 License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details (if you create one, otherwise state MIT License).

## 🧑‍💻 Author

Mark Heinonen
*   Email: `heinonenmh@gmail.com`

---
Enjoy keeping score for your Rook games!
