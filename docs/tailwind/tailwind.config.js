// Config for the prebuilt Tailwind CSS that is inlined into index.html.
// This is the SAME config that used to be handed to the Tailwind Play CDN at
// runtime — it is kept here so the stylesheet can be regenerated instead of
// being compiled in every student's browser on every page load.
//
// See README.md in this folder for the one command that rebuilds it.
const theme = {
  darkMode: "class",
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        "outline": "#717971",
        "surface-dim": "#dcdad5",
        "surface-container-highest": "#e5e2dd",
        "on-surface-variant": "#414942",
        "surface-container": "#f0ede8",
        "on-secondary": "#ffffff",
        "on-background": "#1c1c19",
        "surface-container-high": "#ebe8e3",
        "on-surface": "#1c1c19",
        "tertiary": "#535b56",
        "on-secondary-container": "#65625e",
        "on-primary-fixed": "#00210e",
        "primary-container": "#4a7c59",
        "on-error": "#ffffff",
        "surface-container-lowest": "#ffffff",
        "surface-container-low": "#f6f3ee",
        "on-primary": "#ffffff",
        "background": "#fcf9f4",
        "surface-bright": "#fcf9f4",
        "primary": "#316342",
        "on-primary-container": "#e1ffe5",
        "secondary-container": "#e4dfda",
        "secondary": "#615e5a",
        "primary-fixed": "#b9efc5",
        "outline-variant": "#c1c9bf",
        "tertiary-container": "#6b736e",
        "inverse-on-surface": "#f3f0eb",
        "inverse-primary": "#9dd3aa",
        "primary-fixed-dim": "#9dd3aa",
        "on-primary-fixed-variant": "#1e5031",
        "inverse-surface": "#31302d",
        "surface": "#fcf9f4",
        "surface-variant": "#e5e2dd"
      },
      fontFamily: {
        "headline": ["Space Grotesk", "sans-serif"],
        "body": ["Plus Jakarta Sans", "sans-serif"],
        "label": ["Inter", "sans-serif"]
      },
      borderRadius: { "DEFAULT": "0.125rem", "lg": "0.25rem", "xl": "0.5rem", "full": "0.75rem" }
    }
  }
};

module.exports = {
  // Scan both halves of the app: the markup and the module that builds markup.
  content: ['../../index.html', '../../app.js'],
  darkMode: theme.darkMode,
  corePlugins: theme.corePlugins,   // preflight stays off — the app has its own reset
  theme: theme.theme,
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/container-queries')],
};
