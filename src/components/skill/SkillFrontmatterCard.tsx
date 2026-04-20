import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { FrontmatterValue } from "@/lib/frontmatter";

interface SkillFrontmatterCardProps {
  data: Record<string, FrontmatterValue>;
  raw?: string;
  className?: string;
}

function FrontmatterValueView({
  label,
  value,
  depth = 0,
}: {
  label: string;
  value: FrontmatterValue;
  depth?: number;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const isArray = Array.isArray(value);
  const isObject = typeof value === "object" && value !== null && !isArray;
  const isNested = isArray || isObject;

  if (isArray) {
    const items = value as FrontmatterValue[];
    return (
      <div className="space-y-2">
        <button
          type="button"
          className="flex items-center gap-1.5 text-left"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <span className="font-medium text-foreground">{label}</span>
          <span className="text-xs text-muted-foreground">
            {t("detail.frontmatterItems", { count: items.length })}
          </span>
        </button>
        {expanded && (
          <div className={cn("space-y-2 border-l border-border/60 pl-4", depth > 0 && "ml-1")}>
            {items.map((item, index) => (
              <FrontmatterValueView
                key={`${label}-${index}`}
                label={`${index + 1}`}
                value={item}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (isObject) {
    const entries = Object.entries(value as Record<string, FrontmatterValue>);
    return (
      <div className="space-y-2">
        <button
          type="button"
          className="flex items-center gap-1.5 text-left"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <span className="font-medium text-foreground">{label}</span>
        </button>
        {expanded && (
          <div className={cn("space-y-2 border-l border-border/60 pl-4", depth > 0 && "ml-1")}>
            {entries.map(([key, entryValue]) => (
              <FrontmatterValueView
                key={`${label}-${key}`}
                label={key}
                value={entryValue}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-1 sm:grid-cols-[minmax(9rem,12rem)_minmax(0,1fr)] sm:gap-3">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("text-sm leading-6 text-foreground break-words", isNested && "font-mono")}>
        {value === null ? "null" : String(value)}
      </div>
    </div>
  );
}

function summarizeFrontmatterValue(value: FrontmatterValue | undefined) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

export function SkillFrontmatterCard({ data, raw, className }: SkillFrontmatterCardProps) {
  const { t } = useTranslation();
  const entries = Object.entries(data);
  const trimmedRaw = raw?.trim();
  const summaryName = summarizeFrontmatterValue(data.name);
  const summaryDescription = summarizeFrontmatterValue(data.description);
  const summaryVersion = summarizeFrontmatterValue(data.version);
  const additionalEntries = entries.filter(([key]) => !["name", "description", "version"].includes(key));

  if (entries.length === 0 && !trimmedRaw) {
    return null;
  }

  return (
    <section
      aria-label={t("detail.frontmatter")}
      className={cn("rounded-xl border border-border/70 bg-muted/20 p-5 space-y-4", className)}
    >
      <div className="sr-only">
        <h2>{t("detail.frontmatter")}</h2>
        <p>{t("detail.frontmatterDesc")}</p>
      </div>
      {entries.length > 0 ? (
        <div className="space-y-4">
          {(summaryName || summaryDescription || summaryVersion) && (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                {summaryName && (
                  <div className="text-2xl font-semibold tracking-tight text-foreground break-all">
                    {summaryName}
                  </div>
                )}
                {summaryDescription && (
                  <p className="max-w-4xl text-sm leading-7 text-muted-foreground">
                    {summaryDescription}
                  </p>
                )}
              </div>
              {summaryVersion && (
                <span className="inline-flex items-center rounded-full border border-border/70 bg-background/75 px-2.5 py-1 text-[11px] font-medium tracking-wide text-foreground/80">
                  v{summaryVersion}
                </span>
              )}
            </div>
          )}

          {additionalEntries.length > 0 && (
            <section className="space-y-3 border-t border-border/60 pt-4">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {t("detail.frontmatterAdditional")}
              </div>
              <div className="space-y-3">
                {additionalEntries.map(([key, value]) => (
                  <FrontmatterValueView key={key} label={key} value={value} />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t("detail.frontmatterRawFallback")}</p>
          <pre className="overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-background/70 p-3 text-[12px] leading-5 text-foreground/80">
            {trimmedRaw}
          </pre>
        </div>
      )}
    </section>
  );
}
