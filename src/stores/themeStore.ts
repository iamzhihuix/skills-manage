import { create } from "zustand";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CatppuccinFlavor = "mocha" | "macchiato" | "frappe" | "latte";

/** The 14 Catppuccin accent color names (same order as the Obsidian theme). */
export type CatppuccinAccent =
  | "rosewater"
  | "flamingo"
  | "pink"
  | "mauve"
  | "red"
  | "maroon"
  | "peach"
  | "yellow"
  | "green"
  | "teal"
  | "sky"
  | "sapphire"
  | "blue"
  | "lavender";

/** Ordered list of all accent names — used by the accent picker UI. */
export const ACCENT_NAMES: CatppuccinAccent[] = [
  "rosewater",
  "flamingo",
  "pink",
  "mauve",
  "red",
  "maroon",
  "peach",
  "yellow",
  "green",
  "teal",
  "sky",
  "sapphire",
  "blue",
  "lavender",
];

const FLAVOR_STORAGE_KEY = "catppuccin-flavor";
const ACCENT_STORAGE_KEY = "catppuccin-accent";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Detect system color-scheme preference. Returns "latte" for light, "mocha" for dark. */
function systemFlavor(): CatppuccinFlavor {
  if (typeof window === "undefined") return "mocha";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "latte"
    : "mocha";
}

/** Read persisted flavor from localStorage (returns null if not set). */
function readStoredFlavor(): CatppuccinFlavor | null {
  try {
    const stored = localStorage.getItem(FLAVOR_STORAGE_KEY);
    if (
      stored === "mocha" ||
      stored === "macchiato" ||
      stored === "frappe" ||
      stored === "latte"
    ) {
      return stored;
    }
  } catch {
    // localStorage unavailable (SSR, privacy mode, etc.)
  }
  return null;
}

/** Read persisted accent from localStorage (returns null if not set or invalid). */
function readStoredAccent(): CatppuccinAccent | null {
  try {
    const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
    if (ACCENT_NAMES.includes(stored as CatppuccinAccent)) {
      return stored as CatppuccinAccent;
    }
  } catch {
    // localStorage unavailable
  }
  return null;
}

/** Apply flavor to the DOM — sets data-theme on <html> and persists to localStorage. */
function applyFlavor(flavor: CatppuccinFlavor): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = flavor;
  }
  try {
    localStorage.setItem(FLAVOR_STORAGE_KEY, flavor);
  } catch {
    // Silently ignore storage errors
  }
}

/** Apply accent to the DOM — sets data-accent on <html> and persists to localStorage. */
function applyAccent(accent: CatppuccinAccent): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.accent = accent;
  }
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  } catch {
    // Silently ignore storage errors
  }
}

// ─── State ────────────────────────────────────────────────────────────────────

interface ThemeState {
  flavor: CatppuccinFlavor;
  accent: CatppuccinAccent;

  // Actions
  setFlavor: (flavor: CatppuccinFlavor) => void;
  setAccent: (accent: CatppuccinAccent) => void;
  /** Initialize theme — call once before React renders to prevent flash. */
  init: () => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useThemeStore = create<ThemeState>((set) => ({
  flavor: "mocha", // safe default; init() overrides
  accent: "lavender", // safe default; init() overrides

  setFlavor: (flavor) => {
    applyFlavor(flavor);
    set({ flavor });
  },

  setAccent: (accent) => {
    applyAccent(accent);
    set({ accent });
  },

  init: () => {
    const flavor = readStoredFlavor() ?? systemFlavor();
    const accent = readStoredAccent() ?? "lavender";
    applyFlavor(flavor);
    applyAccent(accent);
    set({ flavor, accent });
  },
}));
