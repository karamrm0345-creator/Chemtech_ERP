import type { Config } from "tailwindcss";

// Palette derived from the reference screenshot (Daftra): brand blue for
// navigation/links, solid green for primary calls to action, navy text and a
// light grey-blue canvas.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4fe", 100: "#d9e6fc", 200: "#b4cdf9", 300: "#84adf4",
          400: "#4f87ed", 500: "#1f6fe5", 600: "#1659c4", 700: "#13479c",
          800: "#123b7e", 900: "#112f63",
        },
        action: { 500: "#21a611", 600: "#1b8e0e", 700: "#16740c" },
        ink: { DEFAULT: "#1b2a3a", soft: "#4a5b6d", muted: "#7b8a9a" },
        canvas: "#f1f4f9",
        panel: "#e9eef5",
        line: "#d7dee8",
        sidebar: { DEFAULT: "#15233a", hover: "#1e3150", active: "#1f6fe5" },
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
      boxShadow: { card: "0 1px 2px rgba(16,33,58,.06), 0 1px 3px rgba(16,33,58,.08)" },
    },
  },
  plugins: [],
} satisfies Config;
