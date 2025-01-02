# Rook Game Scoring Application

This web application provides a user-friendly interface for tracking scores in the card game Rook. It features a responsive design, customizable themes, and robust functionality to manage game rounds, bids, and statistics.

## Features

-   **Score Tracking:** Easily input and track scores for each round of a Rook game.
-   **Bid Management:**  Allows users to select bid amounts and specify which team made the bid.
-   **Round History:**  Displays a detailed history of each round, including bids, scores, and running totals.
-   **Game Statistics:**  Calculates and presents statistics such as total games played, wins for each team, victory methods, and average bid.
-   **Game Saving:**
    -   Save completed games with player names, final scores, and detailed round information.
    -   Freeze and resume in-progress games.
-   **User Interface:**
    -   Responsive design that adapts to different screen sizes.
    -   Dark mode support for comfortable viewing in low-light conditions.
    -   Hamburger menu for easy navigation.
    -   Modal windows for viewing saved games, about information, and confirmation dialogs.
-   **Error Handling:** Includes input validation and error alerts to guide users.
-   **Undo Functionality:** Allows users to undo the last round entered.
-   **Confetti Celebration:**  Displays a confetti animation upon game completion.

## Technologies Used

-   **HTML:** Structure and content of the web application.
-   **CSS:** Styling and layout (using Tailwind CSS framework for responsive design).
-   **JavaScript:**  Core logic for game state management, user interactions, and dynamic content updates.
-   **Service Worker:** Enables offline functionality and caching (not fully detailed in the provided code, but mentioned in the script).

## File Structure

The application consists of a single HTML file that includes inline CSS (within `<style>` tags) and JavaScript (within `<script>` tags).

## How to Use

1. **Open the HTML file in a web browser.**
2. **Start a new game:**
    -   Click the hamburger menu (three horizontal lines) in the top left corner.
    -   Select "New Game".
3. **Enter Bids and Scores:**
    -   Click on a team ("Us" or "Dem") to indicate the bidding team.
    -   Select a preset bid amount or choose "Other" to enter a custom bid (must be divisible by 5).
    -   Toggle whether to enter points for the bidding or non-bidding team.
    -   Enter the points earned in the "Points" input field.
    -   Click "Submit".
4. **View Round History:**
    -   The "History" section displays the round-by-round scores and running totals.
5. **Undo a Round:**
    -   Click the "Undo" button in the "Score Input" section to revert the last entered round.
6. **Save a Game:**
    -   Click the hamburger menu.
    -   Select "Save Game".
    -   Enter player names for "Us" and "Dem".
    -   Click "Save".
7. **Freeze a Game:**
    -   Click the hamburger menu.
    -   Select "Freeze Game".
    -   Enter a name for the frozen game.
    -   Click "Freeze".
8. **View Saved Games:**
    -   Click the hamburger menu.
    -   Select "View Saved Games".
    -   Choose to view either "Completed Games" or "Freezer Games".
    -   Click "View" to see details of a saved game or "Load" to resume a frozen game.
    -   Click the "Trash" icon to delete a saved game.
9. **View Statistics:**
    -   The "Statistics" section displays overall game data (toggle its visibility by clicking on "Statistics").
10. **About:**
    -   Click the hamburger menu.
    -   Select "About" to learn more about the application.

## Code Explanation

### JavaScript

The JavaScript code manages the application's state and handles user interactions. Here's a breakdown of key parts:

-   **`state` Object:** Stores the current game state, including rounds, bidding team, bid amount, points, error messages, and game over status.
-   **`DEFAULT_STATE`:** A constant object representing the initial state of a new game.
-   **`getLocalStorage`, `setLocalStorage`:** Functions to interact with the browser's local storage for saving and retrieving game data.
-   **Event Handlers:** Functions like `handleTeamClick`, `handleBidSelect`, `handleFormSubmit`, `handleUndo`, `handleNewGame`, `handleSaveGameFormSubmit`, `handleFreezeGameFormSubmit` respond to user actions.
-   **Validation Functions:** `validateBid` and `validatePoints` ensure that user input is valid.
-   **Rendering Functions:** Functions like `renderTeamCard`, `renderRoundCard`, `renderScoreInputCard`, `renderHistoryCard`, `renderStatisticsCard`, `renderGameOverOverlay`, and `renderApp` generate HTML content based on the current state.
-   **Dark Mode:** `toggleDarkMode`, `updateDarkModeButton`, and `initializeDarkMode` handle switching between light and dark themes.
-   **Modals:** Functions like `openSavedGamesModal`, `closeSavedGamesModal`, `openSaveGameModal`, etc., control the display of modal windows.
-   **Confirmation Modal:** `openConfirmationModal` and `closeConfirmationModal` manage a reusable confirmation dialog.

### CSS (Tailwind CSS)

The code uses Tailwind CSS utility classes for styling. Key aspects include:

-   **Responsive Design:** Classes like `sm:`, `md:`, `lg:`, and `xl:` are used to apply different styles based on screen size.
-   **Flexbox and Grid:**  `flex`, `flex-col`, `grid`, `grid-cols-` are used for layout.
-   **Spacing:**  `p-`, `px-`, `py-`, `m-`, `mx-`, `my-`, `space-x-`, `space-y-` control padding, margins, and spacing between elements.
-   **Colors:** `bg-`, `text-`, `border-` classes set background, text, and border colors.
-   **Typography:** `text-`, `font-` classes define text size and font weight.
-   **Shadows:** `shadow`, `shadow-md`, `shadow-lg` add box shadows.
-   **Transitions:** `transition`, `duration-` create smooth visual transitions.
-   **Dark Mode:** `dark:` prefix is used to apply styles specifically in dark mode.

### HTML

The HTML defines the structure of the application:

-   **`app` div:** The main container for the game content.
-   **Team Cards:** divs for "Us" and "Dem" teams.
-   **Score Input Card:** Contains elements for entering bids and points.
-   **History Card:** Displays the round history.
-   **Statistics Card:** Shows game statistics.
-   **Game Over Overlay:** Shown when a game ends.
-   **Modals:** Hidden divs that are displayed as modal windows for various purposes (saved games, about, confirmation).
-   **Hamburger Menu:** A `nav` element that provides navigation options.

## Potential Improvements

-   **Service Worker Implementation:**  The code mentions a service worker but doesn't provide its implementation. Adding the `service-worker.js` file would enable offline functionality.
-   **Enhanced Statistics:**  More detailed statistics could be tracked and displayed (e.g., individual player performance, bid success rates).
-   **Accessibility:** Further improvements could be made to enhance accessibility (e.g., more descriptive ARIA attributes, keyboard navigation enhancements).
-   **Code Organization:** The code could be modularized into separate JavaScript files for better organization and maintainability as it grows.
-   **Testing:**  Adding unit tests would help ensure code quality and prevent regressions.

## Conclusion

This Rook game scoring application provides a solid foundation for tracking scores and managing games. It's well-structured, user-friendly, and demonstrates good use of HTML, CSS (Tailwind), and JavaScript. With some further development and enhancements, it could become an even more powerful and feature-rich tool for Rook players.
