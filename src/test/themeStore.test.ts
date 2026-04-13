import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useThemeStore, CatppuccinFlavor, ACCENT_NAMES } from "../stores/themeStore";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Reset the store to default state and clear localStorage. */
function resetStore() {
  useThemeStore.setState({ flavor: "mocha", accent: "lavender" });
  try {
    localStorage.removeItem("catppuccin-flavor");
  } catch {
    // ignore
  }
  try {
    localStorage.removeItem("catppuccin-accent");
  } catch {
    // ignore
  }
  // Remove data-theme and data-accent from document if present
  if (typeof document !== "undefined") {
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.accent;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("themeStore", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetStore();
  });

  // ── Initial State ─────────────────────────────────────────────────────────

  it("has mocha as the default flavor before init", () => {
    const state = useThemeStore.getState();
    expect(state.flavor).toBe("mocha");
  });

  it("has lavender as the default accent before init", () => {
    const state = useThemeStore.getState();
    expect(state.accent).toBe("lavender");
  });

  // ── setFlavor ─────────────────────────────────────────────────────────────

  it("setFlavor updates the store flavor", () => {
    useThemeStore.getState().setFlavor("latte");
    expect(useThemeStore.getState().flavor).toBe("latte");
  });

  it("setFlavor sets data-theme on document.documentElement", () => {
    useThemeStore.getState().setFlavor("frappe");
    expect(document.documentElement.dataset.theme).toBe("frappe");
  });

  it("setFlavor persists flavor to localStorage", () => {
    useThemeStore.getState().setFlavor("macchiato");
    expect(localStorage.getItem("catppuccin-flavor")).toBe("macchiato");
  });

  it("setFlavor works for all four flavors", () => {
    const flavors: CatppuccinFlavor[] = ["mocha", "macchiato", "frappe", "latte"];
    for (const flavor of flavors) {
      useThemeStore.getState().setFlavor(flavor);
      expect(useThemeStore.getState().flavor).toBe(flavor);
      expect(document.documentElement.dataset.theme).toBe(flavor);
      expect(localStorage.getItem("catppuccin-flavor")).toBe(flavor);
    }
  });

  // ── setAccent ─────────────────────────────────────────────────────────────

  it("setAccent updates the store accent", () => {
    useThemeStore.getState().setAccent("green");
    expect(useThemeStore.getState().accent).toBe("green");
  });

  it("setAccent sets data-accent on document.documentElement", () => {
    useThemeStore.getState().setAccent("mauve");
    expect(document.documentElement.dataset.accent).toBe("mauve");
  });

  it("setAccent persists accent to localStorage", () => {
    useThemeStore.getState().setAccent("peach");
    expect(localStorage.getItem("catppuccin-accent")).toBe("peach");
  });

  it("setAccent works for all 14 accent colors", () => {
    for (const accent of ACCENT_NAMES) {
      useThemeStore.getState().setAccent(accent);
      expect(useThemeStore.getState().accent).toBe(accent);
      expect(document.documentElement.dataset.accent).toBe(accent);
      expect(localStorage.getItem("catppuccin-accent")).toBe(accent);
    }
  });

  // ── init ──────────────────────────────────────────────────────────────────

  it("init applies stored flavor from localStorage", () => {
    localStorage.setItem("catppuccin-flavor", "macchiato");
    useThemeStore.getState().init();
    expect(useThemeStore.getState().flavor).toBe("macchiato");
    expect(document.documentElement.dataset.theme).toBe("macchiato");
  });

  it("init applies stored accent from localStorage", () => {
    localStorage.setItem("catppuccin-accent", "green");
    const spy = vi.spyOn(window, "matchMedia");
    spy.mockReturnValue({ matches: false } as MediaQueryList);
    useThemeStore.getState().init();
    expect(useThemeStore.getState().accent).toBe("green");
    expect(document.documentElement.dataset.accent).toBe("green");
    spy.mockRestore();
  });

  it("init falls back to lavender accent when no stored accent", () => {
    const spy = vi.spyOn(window, "matchMedia");
    spy.mockReturnValue({ matches: false } as MediaQueryList);
    useThemeStore.getState().init();
    expect(useThemeStore.getState().accent).toBe("lavender");
    expect(document.documentElement.dataset.accent).toBe("lavender");
    spy.mockRestore();
  });

  it("init falls back to system preference when no stored flavor", () => {
    // No localStorage value set — should use system preference
    const spy = vi.spyOn(window, "matchMedia");
    spy.mockReturnValue({ matches: true } as MediaQueryList);
    useThemeStore.getState().init();
    // light preference → latte
    expect(useThemeStore.getState().flavor).toBe("latte");

    spy.mockRestore();
  });

  it("init defaults to mocha for dark system preference", () => {
    const spy = vi.spyOn(window, "matchMedia");
    spy.mockReturnValue({ matches: false } as MediaQueryList);
    useThemeStore.getState().init();
    // dark preference → mocha
    expect(useThemeStore.getState().flavor).toBe("mocha");

    spy.mockRestore();
  });

  it("init writes flavor to localStorage", () => {
    // Mock matchMedia for jsdom
    const spy = vi.spyOn(window, "matchMedia");
    spy.mockReturnValue({ matches: false } as MediaQueryList);

    useThemeStore.getState().init();
    const stored = localStorage.getItem("catppuccin-flavor");
    expect(stored).toBeTruthy();
    expect(["mocha", "macchiato", "frappe", "latte"]).toContain(stored);

    spy.mockRestore();
  });

  it("init writes accent to localStorage", () => {
    const spy = vi.spyOn(window, "matchMedia");
    spy.mockReturnValue({ matches: false } as MediaQueryList);

    useThemeStore.getState().init();
    const stored = localStorage.getItem("catppuccin-accent");
    expect(stored).toBe("lavender");

    spy.mockRestore();
  });

  it("init sets data-theme on document.documentElement", () => {
    localStorage.setItem("catppuccin-flavor", "frappe");
    useThemeStore.getState().init();
    expect(document.documentElement.dataset.theme).toBe("frappe");
  });

  it("init sets data-accent on document.documentElement", () => {
    localStorage.setItem("catppuccin-accent", "sky");
    const spy = vi.spyOn(window, "matchMedia");
    spy.mockReturnValue({ matches: false } as MediaQueryList);
    useThemeStore.getState().init();
    expect(document.documentElement.dataset.accent).toBe("sky");
    spy.mockRestore();
  });

  it("stored flavor takes priority over system preference", () => {
    // System prefers light (→ latte), but stored is macchiato
    localStorage.setItem("catppuccin-flavor", "macchiato");
    const spy = vi.spyOn(window, "matchMedia");
    spy.mockReturnValue({ matches: true } as MediaQueryList);

    useThemeStore.getState().init();
    expect(useThemeStore.getState().flavor).toBe("macchiato");

    spy.mockRestore();
  });

  it("invalid localStorage flavor is ignored, falls back to system preference", () => {
    localStorage.setItem("catppuccin-flavor", "invalid-flavor");
    const spy = vi.spyOn(window, "matchMedia");
    spy.mockReturnValue({ matches: false } as MediaQueryList);

    useThemeStore.getState().init();
    // Falls back to system: dark → mocha
    expect(useThemeStore.getState().flavor).toBe("mocha");

    spy.mockRestore();
  });

  it("invalid localStorage accent is ignored, falls back to lavender", () => {
    localStorage.setItem("catppuccin-accent", "invalid-accent");
    const spy = vi.spyOn(window, "matchMedia");
    spy.mockReturnValue({ matches: false } as MediaQueryList);
    useThemeStore.getState().init();
    expect(useThemeStore.getState().accent).toBe("lavender");
    spy.mockRestore();
  });

  // ── ACCENT_NAMES constant ────────────────────────────────────────────────

  it("ACCENT_NAMES contains all 14 accent color names", () => {
    expect(ACCENT_NAMES).toHaveLength(14);
    expect(ACCENT_NAMES).toContain("rosewater");
    expect(ACCENT_NAMES).toContain("flamingo");
    expect(ACCENT_NAMES).toContain("pink");
    expect(ACCENT_NAMES).toContain("mauve");
    expect(ACCENT_NAMES).toContain("red");
    expect(ACCENT_NAMES).toContain("maroon");
    expect(ACCENT_NAMES).toContain("peach");
    expect(ACCENT_NAMES).toContain("yellow");
    expect(ACCENT_NAMES).toContain("green");
    expect(ACCENT_NAMES).toContain("teal");
    expect(ACCENT_NAMES).toContain("sky");
    expect(ACCENT_NAMES).toContain("sapphire");
    expect(ACCENT_NAMES).toContain("blue");
    expect(ACCENT_NAMES).toContain("lavender");
  });
});
