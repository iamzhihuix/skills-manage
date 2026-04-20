import { RefObject, ReactNode, useEffect, useId } from "react";
import {
  Dialog,
  DialogClose,
  DialogOverlay,
  DialogPortal,
} from "@/components/ui/dialog";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { SkillDetailView, type DiscoverMetadata } from "@/components/skill/SkillDetailView";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SkillDetailDrawerProps {
  open: boolean;
  skillId: string | null;
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  children?: ReactNode;
  /** Direct file path for discover non-central skills. */
  filePath?: string | null;
  /** Metadata for discover non-central skills. */
  discoverMetadata?: DiscoverMetadata | null;
}

export function SkillDetailDrawer({
  open,
  skillId,
  onOpenChange,
  returnFocusRef,
  children,
  filePath,
  discoverMetadata,
}: SkillDetailDrawerProps) {
  const titleId = useId();
  const showContent = open && (skillId !== null || filePath != null || children != null);

  useEffect(() => {
    if (open) {
      return;
    }
    const target = returnFocusRef?.current ?? document.body;
    target?.focus?.();
  }, [open, returnFocusRef]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal keepMounted={false}>
        <DialogOverlay
          data-testid="skill-detail-drawer-overlay"
          className="bg-black/30"
        />
        <DialogPrimitive.Popup
          role="dialog"
          aria-modal="true"
          aria-labelledby={showContent ? titleId : undefined}
          data-testid="skill-detail-drawer"
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex h-full w-screen flex-col bg-background shadow-2xl ring-1 ring-border outline-none",
            "md:w-[min(900px,90vw)]"
          )}
        >
          <div className="flex h-10 shrink-0 items-center justify-end border-b border-border px-2">
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close"
                />
              }
            >
              <XIcon />
            </DialogClose>
          </div>
          <div className="min-h-0 flex-1">
            {showContent
              ? (children ?? (
                  <SkillDetailView
                    skillId={skillId ?? undefined}
                    filePath={filePath ?? undefined}
                    discoverMetadata={discoverMetadata ?? undefined}
                    variant="drawer"
                    leading={null}
                    onRequestClose={() => onOpenChange(false)}
                    titleId={titleId}
                  />
                ))
              : null}
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
