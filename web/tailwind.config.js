/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        heading: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        body: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
      },
      colors: {
        bg: '#080808',
        panel: '#111111',
        'panel-alt': '#171717',
        surface: '#141414',
        border: '#303030',
        text: '#ffffff',
        muted: '#a0a0a0',
        subtle: '#777777',
      }
    },
  },
  plugins: [],
};
