/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        fpl: {
          green:  '#00ff85',
          purple: '#37003c',
          light:  '#f6f7f8',
        },
      },
    },
  },
  plugins: [],
};
