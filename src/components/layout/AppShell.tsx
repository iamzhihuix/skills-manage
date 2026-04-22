import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { GlobalSearchDialog } from "./GlobalSearchDialog";
import { usePlatformStore } from "@/stores/platformStore";
import { useCentralSkillsStore } from "@/stores/centralSkillsStore";
import { useDiscoverStore } from "@/stores/discoverStore";

/**
 * Top-level app shell: TopBar + icon sidebar + scrollable main content area.
 * Triggers the initial platform scan on mount.
 */
export function AppShell() {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const { pathname } = useLocation();

  const initialize = usePlatformStore((s) => s.initialize);
  const rescan = usePlatformStore((s) => s.rescan);
  const loadCentralSkills = useCentralSkillsStore((s) => s.loadCentralSkills);
  const rescanDiscoverFromDisk = useDiscoverStore((s) => s.rescanFromDisk);

  useEffect(() => {
    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mainRef.current) return;
    mainRef.current.scrollTop = 0;
  }, [pathname]);

  async function handleGlobalRescan() {
    await rescan();
    await Promise.allSettled([
      loadCentralSkills(),
      rescanDiscoverFromDisk(),
    ]);
  }

  function handleAction(action: string) {
    switch (action) {
      case "rescan":
        void handleGlobalRescan();
        break;
    }
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <TopBar onSearchClick={() => setIsSearchOpen(true)} />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main ref={mainRef} className="flex-1 min-h-0 min-w-0 overflow-hidden">
          <Outlet />
        </main>
      </div>
      <GlobalSearchDialog
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        onAction={handleAction}
      />
    </div>
  );
}
