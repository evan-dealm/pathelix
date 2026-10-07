/**
 * Tailwind configuration of the public website only (src/app/(site), src/components/site).
 * Loaded through `@config` in src/app/(site)/site.css, so the marketing pages ship their own
 * small stylesheet and never inherit the application's tokens (tailwind.config.js) — and the
 * application never inherits these.
 */
module.exports = {
  content: [
    './src/components/site/**/*.{ts,tsx}',
    // Brackets, not backslashes: the spelling of a literal parenthesis that globbing accepts on
    // every OS (a backslash is a path separator on Windows and the pages were silently skipped).
    './src/app/[(]site[)]/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-geist)', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        ink: '#000000',
        paper: '#FFFFFF',
        // Same off-white as the application canvas: the real screenshots sit on it without a seam.
        mist: '#F7F7F4',
        line: '#E2E2DD',
        graphite: '#5F636B',
        ash: '#9A9EA6',
        carbon: '#1F1F1F',
        accent: { DEFAULT: '#0055A4', deep: '#00468A' },
      },
      maxWidth: {
        site: '76rem',
        wide: '92rem',
        prose: '38rem',
      },
      borderRadius: {
        DEFAULT: '4px',
        frame: '6px',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      },
    },
  },
  plugins: [],
}
