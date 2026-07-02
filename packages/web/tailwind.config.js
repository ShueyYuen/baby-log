/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#fef7ee',
          100: '#fdedd3',
          200: '#fad7a5',
          300: '#f6b96d',
          400: '#f19232',
          500: '#ee7711',
          600: '#df5d07',
          700: '#b94509',
          800: '#93370e',
          900: '#77300f',
        },
        baby: {
          pink: '#fce4ec',
          blue: '#e3f2fd',
          green: '#e8f5e9',
          purple: '#f3e5f5',
          yellow: '#fff8e1',
        },
      },
    },
  },
  plugins: [],
};
