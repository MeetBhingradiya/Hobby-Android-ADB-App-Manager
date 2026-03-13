import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: 'rgb(24 24 27)',    // zinc-900
        panel:   'rgb(39 39 42)',    // zinc-800
        card:    'rgb(52 52 56)',    // zinc-700-ish
        border:  'rgb(63 63 70)',    // zinc-700
        muted:   'rgb(113 113 122)', // zinc-500
        accent:  'rgb(99 102 241)',  // indigo-500
        success: 'rgb(34 197 94)',   // green-500
        danger:  'rgb(239 68 68)',   // red-500
      },
    },
  },
  plugins: [],
}

export default config
