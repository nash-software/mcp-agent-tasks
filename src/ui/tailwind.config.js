/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#09090B',
        surface: {
          1: '#111113',
          2: '#18181B',
          3: '#27272A',
        },
        ink: {
          DEFAULT: '#FAFAFA',
          2: '#A1A1AA',
          muted: '#71717A',
          faint: '#52525B',
        },
        accent: {
          DEFAULT: 'var(--accent, #0070F3)',
          hover: 'var(--accent-hover, #0062D6)',
        },
        status: {
          red: '#EF4444',
          amber: '#F59E0B',
          green: '#22C55E',
          blue: '#3B82F6',
        },
        area: {
          client: '#F59E0B',
          personal: '#22C55E',
          outsource: '#8B5CF6',
          internal: '#6B7280',
        },
      },
      fontFamily: {
        sans: ['Geist Variable', 'Geist', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['Geist Mono Variable', 'Geist Mono', 'ui-monospace', '"SF Mono"', 'monospace'],
      },
      borderRadius: {
        card: '8px',
        input: '6px',
        badge: '4px',
        drawer: '12px',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.16,1,0.3,1)',
      },
    },
  },
  plugins: [],
}
