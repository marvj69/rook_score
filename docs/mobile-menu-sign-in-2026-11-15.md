# Mobile menu interruptions after sign-in

Reported: after a fresh Google sign-in, the iPhone PWA's hamburger drawer would not stay visible and changed appearance during app switching.

## Confirmed defects

The drawer's document-level touch handler had three related failure paths:

- `touchcancel` ran the same handler as `touchend`, so a gesture handed off to the operating system could open or close the menu instead of being canceled.
- The handler used horizontal distance alone. A mostly vertical scroll or app-switch gesture with sideways drift could move and toggle the drawer.
- An interrupted gesture could leave `transition: none` and an inline `transform` on the drawer. There was no cleanup on lost focus, backgrounding, or page restoration. An ordinary menu action also left the pending gesture armed, allowing a later touchend to undo that action.

All five targeted browser scenarios failed against the previous production bundle in both mobile WebKit and Chromium: canceled opening swipe, canceled closing swipe, vertical swipe, lost focus during a swipe, and an explicit menu close followed by an old touchend.

## Change

Wait for horizontal intent before moving the drawer. Cancellation restores its intended open/closed state. Clear pending gestures and their temporary styles whenever the menu state changes or the page loses focus, goes into the background, or returns. Track a single finger, cancel multi-touch, and leave ordinary taps and native scrolling alone. Touch listeners remain passive.

The generated core bundle and content-derived service-worker cache were rebuilt. The core bundle grew by 759 bytes (220 bytes gzipped); its download budget was adjusted to cover that addition.

## Verification

- `npm test`: 470 passed, including ten new source/bundle regression tests.
- `npm run build`, service-worker stamp verification, JavaScript syntax checks, and `git diff --check` passed.
- Mobile WebKit and Chromium: the five previously failing cases now pass; repeated hamburger taps, Settings navigation, and sign-in from Home and the drawer work.
- iPhone 17 Pro simulator, iOS 26.0: installed the test PWA, restored the account fixture, opened the drawer, went to Home and returned, then used the app switcher and returned. The drawer remained visible and usable.
- Android 15 ARM64 emulator, Chrome: native touch dispatch verified canceled opening/closing swipes, vertical scrolling, horizontal opening/closing, and a native Home/Chrome resume cycle.
- The staged GitHub Pages artifact was tested under a nested `rook_score/` path in both engines, including an activated service worker. All 44 staged runtime files match the checkout.

## Scope and limits

The existing authorized Gmail/Firebase CLI session was used to read the account's cloud document. Its snapshot was replayed through the actual Firebase merge code with a local fake identity provider and Firestore. Library counts remained unchanged. The tests did not write to the production database; private fixtures and screenshots remain in ignored `tmp/mobile-menu-2026-11-15/` files.

These tests reproduce the gesture defects and exercise the installed iPhone app's lifecycle. They do not establish that every step of the original physical-phone incident has been reproduced, and they do not complete real Google OAuth on either simulator.

A separate live configuration problem was observed: Firebase's project-config request returns HTTP 403 for the Vercel referrer (`rook-score.vercel.app`), while the GitHub Pages referrer is accepted. The Vercel browser also reports `auth/requests-from-referer-https://rook-score.vercel.app-are-blocked`. This is outside the drawer fix; no Firebase API-key restrictions were changed.
