/** @type {import('postcss-load-config').Config} */
export default {
  plugins: {
    // 👉 point to the new package, not "tailwindcss"
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
}