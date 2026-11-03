import { defineConfig, presetIcons, presetWind4 } from "unocss";
import transformerDirectives from "@unocss/transformer-directives";

export default defineConfig({
  presets: [presetWind4(), presetIcons()],
  transformers: [transformerDirectives()],
  safelist: [
    "i-fluent-home-16-filled",
    "i-fluent-home-16-regular",
    "i-fluent-settings-16-filled",
    "i-fluent-settings-16-regular",
    "i-fluent-heart-20-filled",
    "i-fluent-heart-20-regular",
    "i-fluent-checkmark-20-filled",
    "i-fluent-square-20-regular",
    "i-fluent-folder-16-filled",
    "i-fluent-folder-16-regular",
    "i-fluent-folder-add-20-filled",
    "i-fluent-folder-add-20-regular",
    "i-fluent-location-20-filled",
    "i-fluent-location-20-regular",
    "i-fluent-location-48-filled",
    "i-fluent-line-horizontal-3-20-filled",
    "i-fluent-panel-left-expand-16-filled",
  ],
  theme: {
    colors: {
      accent: "var(--accent)",
      "accent-strong": "var(--accent-strong)",
      "accent-soft": "var(--accent-soft)",
      bg: "var(--bg)",
      surface: "var(--surface)",
      "surface-alt": "var(--surface-alt)",
      "surface-hover": "var(--surface-hover)",
      "sidebar-hover": "var(--sidebar-hover-background)",
      border: "var(--border)",
      text: "var(--text)",
      muted: "var(--muted)",
    },
    breakpoints: {
      sm: "768px",
      md: "980px",
      lg: "1280px",
    },
  },
  shortcuts: [
    // Card / panel surface
    [
      "card",
      "bg-surface border border-border rounded-[1rem] shadow-[var(--shadow)]",
    ],
    // Primary button
    [
      "btn-primary",
      "inline-flex items-center justify-center gap-[0.45rem] px-[0.8rem] py-[0.5rem] min-h-[2.2rem] rounded-[0.6rem] bg-accent text-white text-[0.8rem] font-semibold cursor-pointer border border-transparent transition-all duration-150 hover:opacity-92 hover:-translate-y-px disabled:opacity-70 disabled:cursor-wait",
    ],
    // Secondary/ghost button
    [
      "btn-ghost",
      "inline-flex items-center justify-center gap-[0.45rem] px-[0.8rem] py-[0.5rem] min-h-[2.2rem] rounded-[0.6rem] bg-surface-hover text-text text-[0.8rem] font-semibold cursor-pointer border border-transparent transition-all duration-150 hover:opacity-92 disabled:opacity-70 disabled:cursor-wait",
    ],
    // Icon button (transparent)
    [
      "btn-icon",
      "inline-flex items-center justify-center border-0 bg-transparent cursor-pointer color-inherit",
    ],
    // Nav link/button in sidebar
    [
      "sidebar-item",
      "flex items-center gap-4 min-h-[3rem] px-[0.75rem] py-[0.7rem] border-0 rounded-[1rem] color-inherit bg-transparent cursor-pointer transition-colors duration-150 hover:bg-sidebar-hover",
    ],
    // Avatar circle base
    [
      "avatar-base",
      "rounded-full grid place-items-center overflow-hidden text-white font-bold shrink-0 bg-[var(--avatar-fallback)]",
    ],
    // Skeleton shimmer element
    [
      "shimmer-bg",
      "bg-[linear-gradient(90deg,rgba(160,160,160,0.14)_0%,rgba(160,160,160,0.24)_50%,rgba(160,160,160,0.14)_100%)] bg-[length:200%_100%] animate-shimmer",
    ],
    // Eyebrow badge
    [
      "eyebrow",
      "inline-flex items-center px-[0.68rem] py-[0.32rem] rounded-full bg-accent-soft text-accent-strong text-[0.78rem] font-semibold",
    ],
    // Scrollable area, thin scrollbar
    [
      "scroll-thin",
      "overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent]",
    ],
  ],
  preflights: [],
});
