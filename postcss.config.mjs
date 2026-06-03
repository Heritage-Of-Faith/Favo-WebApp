// PostCSS config for Tailwind v4 CSS-first mode.
// Required — without this, @theme tokens are never output and no utility classes are generated.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
