/** @type {import('tailwindcss').Config} */
// Design tokens. Neutral foundation + one accent (Midea-adjacent blue).
// Strong colors only for state: approved (green), pending (amber),
// rejected (red). Hierarchy comes from weight/size/spacing, not color.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        ink: { DEFAULT: '#1d1d1f', 2: '#3a3a3c', 3: '#5f5f64', 4: '#8e8e93' },
        line: { DEFAULT: '#e3e3e8', strong: '#c7c7cc' },
        canvas: '#f6f6f8',
        accent: { DEFAULT: '#0A5CC2', hover: '#084c9f', soft: '#eaf1fb', ring: '#7fa8e0' },
        ok: { DEFAULT: '#1e7d43', soft: '#e8f4ec' },
        warn: { DEFAULT: '#9a6200', soft: '#fdf3e1' },
        bad: { DEFAULT: '#b3261e', soft: '#fbeaea' },
      },
      fontSize: {
        '2xs': ['11px', '16px'],
      },
      borderRadius: { DEFAULT: '6px', md: '8px', lg: '10px' },
      boxShadow: {
        pop: '0 12px 32px -12px rgba(0,0,0,.22), 0 0 0 1px rgba(0,0,0,.06)',
      },
      transitionTimingFunction: { 'out-strong': 'cubic-bezier(0.23, 1, 0.32, 1)' },
    },
  },
  plugins: [],
}
