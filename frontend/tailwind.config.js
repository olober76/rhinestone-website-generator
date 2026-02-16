/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f4ff",
          100: "#dbe4ff",
          500: "#4c6ef5",
          600: "#3b5bdb",
          700: "#364fc7",
          900: "#1b2a6b",
        },
        surface: {
          DEFAULT: "#1a1a2e",
          light: "#232340",
          lighter: "#2d2d50",
        },
      },
    },
  },
  plugins: [],
};
