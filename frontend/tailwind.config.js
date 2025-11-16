/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Dark Mode - Super Sexy Grayish-Blackish Design
        'dark': {
          'bg-primary': '#0a0b0d',
          'bg-secondary': '#13151a',
          'bg-tertiary': '#1a1d24',
          'bg-hover': '#22252e',
          'surface': '#1e2129',
          'border': '#2d3139',
          'border-light': '#383c47',
          'text-primary': '#e8eaed',
          'text-secondary': '#b4b8c5',
          'text-muted': '#8b8f9b',
        },
        // Light Mode - Beautiful Sophisticated Design
        'light': {
          'bg-primary': '#fafbfc',
          'bg-secondary': '#f5f7fa',
          'bg-tertiary': '#eef1f6',
          'bg-hover': '#e4e8f0',
          'surface': '#ffffff',
          'border': '#d1d9e6',
          'border-light': '#e4e8f0',
          'text-primary': '#111827',
          'text-secondary': '#1f2937',
          'text-muted': '#374151',
        },
        // Shared accent colors
        'accent-primary': '#3b82f6',
        'accent-primary-bright': '#60a5fa',
        'accent-secondary': '#6366f1',
        'accent-success': '#10b981',
        'accent-warning': '#f59e0b',
        'accent-error': '#ef4444',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}
