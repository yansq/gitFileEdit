import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/ui";
import type { RepoEnvironmentOption } from "../types";

function EnvironmentGlyph({ fragment }: { fragment: boolean }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-ui-sm bg-workspace-soft text-workspace"
    >
      {fragment ? (
        <svg className="h-[17px] w-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3m13 5h3a2 2 0 0 0 2-2v-3M8 8h8v8H8z" strokeWidth="1.8" />
        </svg>
      ) : (
        <svg className="h-[17px] w-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="m4 7 8-4 8 4-8 4-8-4Z" strokeWidth="1.8" />
          <path d="m4 12 8 4 8-4M4 17l8 4 8-4" strokeWidth="1.8" />
        </svg>
      )}
    </span>
  );
}

function EnvironmentTypeBadge({ fragment }: { fragment: boolean }): JSX.Element {
  return (
    <span
      className="shrink-0 rounded-ui-full bg-workspace-soft px-2 py-0.5 text-[11px] font-medium leading-4 text-workspace"
    >
      {fragment ? "片段库" : "配置"}
    </span>
  );
}

export function EnvironmentSwitcher(props: {
  environments: RepoEnvironmentOption[];
  onValueChange: (environmentId: string) => void;
  value: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeEnvironment =
    props.environments.find((environment) => environment.id === props.value) ??
    props.environments[0];
  const activeIsFragment = activeEnvironment?.kind === "fragment-library";

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePress(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="relative mb-ui-3" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "group flex min-h-14 w-full items-center gap-ui-3 rounded-ui-md border bg-surface py-ui-2 pl-ui-3 pr-ui-4 text-left shadow-ui-xs outline-none transition-[border-color,box-shadow,background-color] duration-ui-normal ease-ui-standard hover:border-ui-border-strong hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-primary/20 motion-reduce:transition-none",
          open ? "border-primary/25 bg-surface-raised shadow-ui-sm" : "border-ui-border",
        )}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <EnvironmentGlyph fragment={activeIsFragment} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-ui-1.5">
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {activeEnvironment?.label ?? "选择环境"}
            </span>
            {activeEnvironment ? <EnvironmentTypeBadge fragment={activeIsFragment} /> : null}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-subtle-foreground">
            {activeEnvironment?.root ?? "请选择工作区"}
          </span>
        </span>
        <svg
          aria-hidden="true"
          className={cn(
            "h-4 w-4 shrink-0 text-subtle-foreground transition-transform duration-ui-normal motion-reduce:transition-none",
            open && "rotate-180",
          )}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="m7 9 5 5 5-5" />
        </svg>
      </button>

      {open ? (
        <div
          aria-label="切换环境"
          className="absolute inset-x-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-ui-md border border-ui-border bg-surface-raised p-ui-1.5 shadow-ui-overlay"
          role="menu"
        >
          <div className="px-ui-3 pb-ui-1.5 pt-ui-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle-foreground">
            切换工作区
          </div>
          <div className="grid gap-ui-1">
            {props.environments.map((environment) => {
              const selected = environment.id === activeEnvironment?.id;
              const fragment = environment.kind === "fragment-library";
              return (
                <button
                  aria-checked={selected}
                  className={cn(
                    "group/item flex min-h-14 w-full items-center gap-ui-3 rounded-ui-sm py-ui-2 pl-ui-3 pr-ui-2 text-left outline-none transition-colors duration-ui-fast focus-visible:ring-2 focus-visible:ring-primary/20 motion-reduce:transition-none",
                    selected ? "bg-primary-soft" : "hover:bg-surface-muted",
                  )}
                  key={environment.id}
                  onClick={() => {
                    props.onValueChange(environment.id);
                    setOpen(false);
                  }}
                  role="menuitemradio"
                  type="button"
                >
                  <EnvironmentGlyph fragment={fragment} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-ui-1.5">
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">
                        {environment.label}
                      </span>
                      <EnvironmentTypeBadge fragment={fragment} />
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-subtle-foreground">
                      {environment.root}
                    </span>
                  </span>
                  <svg
                    aria-hidden="true"
                    className={cn(
                      "h-4 w-4 shrink-0 transition-opacity duration-ui-fast motion-reduce:transition-none",
                      selected
                        ? "text-primary opacity-100"
                        : "text-muted-foreground opacity-0 group-hover/item:opacity-30",
                    )}
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.2"
                    viewBox="0 0 24 24"
                  >
                    <path d="m5 12 4 4L19 6" />
                  </svg>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
