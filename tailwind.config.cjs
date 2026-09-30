module.exports = {
  darkMode: "class",
  content: {
    files: [
      "./index.html",
      "./js/**/*.js",
      "!./js/app.bundle.js",
    ],
    transform: {
      // Generated Home CSS must not feed utility extraction on the next build.
      html: content => content.replace(/<style id="rook-startup-styles">[\s\S]*?<\/style>/g, ""),
    },
  },
};
