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
        "outline": "#8a9089",
        "surface-dim": "#e3e6e4",
        "surface-container-highest": "#eef1ef",
        "on-surface-variant": "#4a5158",
        "surface-container": "#eef1ef",
        "on-secondary": "#ffffff",
        "on-background": "#14161a",
        "surface-container-high": "#f2f4f3",
        "on-surface": "#14161a",
        "tertiary": "#4a5158",
        "on-secondary-container": "#666c71",
        "on-primary-fixed": "#04241a",
        "primary-container": "#0b6b4f",
        "on-error": "#ffffff",
        "surface-container-lowest": "#ffffff",
        "surface-container-low": "#f7f9f8",
        "on-primary": "#ffffff",
        "background": "#fafbfa",
        "surface-bright": "#fafbfa",
        "primary": "#0b6b4f",
        "on-primary-container": "#e4f1ec",
        "secondary-container": "#eef1ef",
        "secondary": "#666c71",
        "primary-fixed": "#bfe6d7",
        "outline-variant": "#e3e6e4",
        "tertiary-container": "#5d646a",
        "inverse-on-surface": "#f7f9f8",
        "inverse-primary": "#5fb597",
        "primary-fixed-dim": "#5fb597",
        "on-primary-fixed-variant": "#085740",
        "inverse-surface": "#22262a",
        "surface": "#fafbfa",
        "surface-variant": "#eef1ef"
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
