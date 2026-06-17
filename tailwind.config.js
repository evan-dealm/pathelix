module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/providers/**/*.{js,ts,jsx,tsx,mdx}',
    './src/hooks/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['var(--font-inter)',  'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['var(--font-geist)', 'var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50:  '#EEF3FF',
          100: '#DDEAFF',
          200: '#BBCFFF',
          300: '#88AAFF',
          400: '#6692FF',
          500: '#4C7DFF',
          600: '#3568E6',
          700: '#2653C4',
          800: '#1A3FA3',
          900: '#102D84',
        },
        surface: {
          0:   '#FFFFFF',
          50:  '#F7F7F4',
          100: '#F1F2F4',
          200: '#E6E8EC',
          300: '#D7DBE0',
          400: '#8B93A1',
          500: '#5B616E',
          600: '#4A4F5A',
          700: '#373B44',
          800: '#272A30',
          900: '#0F1115',
        },
        success: {
          50:  '#E8F7F1',
          500: '#1F9D66',
          600: '#19855A',
        },
        warning: {
          50:  '#FFF8E6',
          500: '#E6A700',
          600: '#C98F00',
        },
        danger: {
          50:  '#FDE8E8',
          500: '#D64545',
          600: '#C03333',
        },
      },
      boxShadow: {
        'soft':    '0 1px 2px 0 rgb(0 0 0 / 0.04)',
        'card':    '0 1px 4px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.03)',
        'elevated':'0 4px 12px -2px rgb(0 0 0 / 0.07), 0 2px 6px -2px rgb(0 0 0 / 0.04)',
        'modal':   '0 20px 60px -12px rgb(0 0 0 / 0.12), 0 8px 20px -8px rgb(0 0 0 / 0.07)',
        'sidebar': '2px 0 12px -2px rgb(0 0 0 / 0.05)',
      },
      borderRadius: {
        'xl':  '0.75rem',
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
      transitionDuration: {
        '120': '120ms',
        '180': '180ms',
        '220': '220ms',
        '250': '250ms',
      },
      keyframes: {
        'loading-bar': {
          '0%':   { width: '0%' },
          '60%':  { width: '75%' },
          '100%': { width: '95%' },
        },
      },
      animation: {
        'loading-bar': 'loading-bar 2.5s ease-out forwards',
      },
    },
  },
  plugins: [],
}
