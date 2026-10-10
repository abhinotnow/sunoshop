// Tailwind CSS configuration for Coral Red / Black / Grey Brutalist accessible UI
// Exports default Tailwind CSS Config
// Depends on tailwindcss
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        coral: {
          50: '#fff1f1',
          100: '#ffe1e1',
          200: '#ffc7c7',
          300: '#ffa0a0',
          400: '#ff6b6b',
          500: '#ff4d4d', // Signature vibrant brutalist coral red
          600: '#e63939',
          700: '#cc2929',
          800: '#991f1f',
          900: '#591111',
          950: '#2b0808',
        },
        brutal: {
          black: '#09090b',
          surface: '#121215',
          card: '#18181b',
          border: '#27272a',
          muted: '#3f3f46',
          grey: '#71717a',
          lightGrey: '#a1a1aa',
          white: '#fafafa',
        },
      },
      boxShadow: {
        brutal: '4px 4px 0px 0px #ff4d4d',
        brutalBlack: '4px 4px 0px 0px #09090b',
        brutalGrey: '4px 4px 0px 0px #3f3f46',
        brutalLg: '6px 6px 0px 0px #ff4d4d',
        brutalSm: '2px 2px 0px 0px #ff4d4d',
      },
      minHeight: {
        touch: '48px',
        largeTouch: '72px',
      },
      minWidth: {
        touch: '48px',
        largeTouch: '72px',
      },
    },
  },
  plugins: [],
} satisfies Config;
