/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./client/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "rgb(var(--color-canvas) / <alpha-value>)",
        surface: {
          DEFAULT: "rgb(var(--color-surface) / <alpha-value>)",
          raised: "rgb(var(--color-surface-raised) / <alpha-value>)",
          subtle: "rgb(var(--color-surface-subtle) / <alpha-value>)",
          muted: "rgb(var(--color-surface-muted) / <alpha-value>)"
        },
        foreground: "rgb(var(--color-foreground) / <alpha-value>)",
        "muted-foreground": "rgb(var(--color-muted-foreground) / <alpha-value>)",
        "subtle-foreground": "rgb(var(--color-subtle-foreground) / <alpha-value>)",
        "ui-border": {
          DEFAULT: "rgb(var(--color-border) / <alpha-value>)",
          strong: "rgb(var(--color-border-strong) / <alpha-value>)"
        },
        primary: {
          DEFAULT: "rgb(var(--color-primary) / <alpha-value>)",
          hover: "rgb(var(--color-primary-hover) / <alpha-value>)",
          active: "rgb(var(--color-primary-active) / <alpha-value>)",
          foreground: "rgb(var(--color-primary-foreground) / <alpha-value>)",
          soft: "rgb(var(--color-primary-soft) / <alpha-value>)"
        },
        success: {
          DEFAULT: "rgb(var(--color-success) / <alpha-value>)",
          soft: "rgb(var(--color-success-soft) / <alpha-value>)"
        },
        warning: {
          DEFAULT: "rgb(var(--color-warning) / <alpha-value>)",
          soft: "rgb(var(--color-warning-soft) / <alpha-value>)"
        },
        danger: {
          DEFAULT: "rgb(var(--color-danger) / <alpha-value>)",
          hover: "rgb(var(--color-danger-hover) / <alpha-value>)",
          soft: "rgb(var(--color-danger-soft) / <alpha-value>)"
        }
      },
      borderRadius: {
        "ui-xs": "var(--radius-ui-xs)",
        "ui-sm": "var(--radius-ui-sm)",
        "ui-md": "var(--radius-ui-md)",
        "ui-lg": "var(--radius-ui-lg)",
        "ui-full": "var(--radius-ui-full)"
      },
      spacing: {
        "ui-1": "var(--space-ui-1)",
        "ui-2": "var(--space-ui-2)",
        "ui-3": "var(--space-ui-3)",
        "ui-4": "var(--space-ui-4)",
        "ui-5": "var(--space-ui-5)",
        "ui-6": "var(--space-ui-6)",
        "ui-8": "var(--space-ui-8)",
        "ui-10": "var(--space-ui-10)"
      },
      fontSize: {
        "ui-xs": ["var(--font-size-ui-xs)", { lineHeight: "var(--line-height-ui-xs)" }],
        "ui-sm": ["var(--font-size-ui-sm)", { lineHeight: "var(--line-height-ui-sm)" }],
        "ui-md": ["var(--font-size-ui-md)", { lineHeight: "var(--line-height-ui-md)" }],
        "ui-lg": ["var(--font-size-ui-lg)", { lineHeight: "var(--line-height-ui-lg)" }],
        "ui-xl": ["var(--font-size-ui-xl)", { lineHeight: "var(--line-height-ui-xl)" }]
      },
      boxShadow: {
        "ui-xs": "var(--shadow-ui-xs)",
        "ui-sm": "var(--shadow-ui-sm)",
        "ui-overlay": "var(--shadow-ui-overlay)",
        "ui-inset": "var(--shadow-ui-inset)"
      },
      transitionDuration: {
        "ui-fast": "var(--motion-duration-fast)",
        "ui-normal": "var(--motion-duration-normal)",
        "ui-slow": "var(--motion-duration-slow)"
      },
      transitionTimingFunction: {
        "ui-standard": "var(--motion-ease-standard)",
        "ui-emphasized": "var(--motion-ease-emphasized)"
      },
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI Variable Text",
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
          "Cascadia Mono",
          "Cascadia Code",
          "JetBrains Mono",
          "SFMono-Regular",
          "Consolas",
          "Microsoft YaHei UI",
          "Microsoft YaHei",
          "Liberation Mono",
          "monospace"
        ]
      }
    }
  },
  plugins: []
};
