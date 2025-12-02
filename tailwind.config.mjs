/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,js,jsx}'],
  darkMode: 'media',      // or 'class' if you prefer manual toggle
  theme: {
    extend: {
      fontFamily: {
        poppins: ["Poppins", "sans-serif"],
        DM: ["DM Sans", "sans-serif"],
        clash: ["Clash Display", "sans-serif"],
        clashDisplay: ['var(--font-clashDisplay)'],
        opensauce: ['var(--font-opensauce)']
      },
      borderRadius: { lg: 'var(--radius)' },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card:       'hsl(var(--card))',
        border:     'hsl(var(--border))',
        primary:    'hsl(var(--primary))',
        secondary:  'hsl(var(--secondary))',
      },
    },
  },
  plugins: [],
}
