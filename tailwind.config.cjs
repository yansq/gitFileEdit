/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./client/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "Segoe UI",
          "Microsoft YaHei UI",
          "Microsoft YaHei",
          "PingFang SC",
          "Hiragino Sans GB",
          "Noto Sans CJK SC",
          "Noto Sans SC",
          "sans-serif"
        ],
        mono: [
          "JetBrains Mono",
          "Cascadia Code",
          "SFMono-Regular",
          "Consolas",
          "Liberation Mono",
          "monospace"
        ]
      }
    }
  },
  plugins: []
};
