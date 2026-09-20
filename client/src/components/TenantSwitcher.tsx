import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/ui";
import type { RepoTenantOption } from "../types";

function TenantGlyph(): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-ui-sm bg-workspace-soft text-workspace"
    >
      <svg className="h-[17px] w-[17px]" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <path d="M4 20V7l8-4 8 4v13M8 10h2m4 0h2M8 14h2m4 0h2M3 20h18" />
      </svg>
    </span>
  );
}

export function TenantSwitcher(props: {
  tenants: RepoTenantOption[];
  onValueChange: (tenantId: string) => void;
  value: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeTenant =
    props.tenants.find((tenant) => tenant.id === props.value) ?? props.tenants[0];

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
    <div className="relative mb-ui-2" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "flex min-h-14 w-full items-center gap-ui-3 rounded-ui-md border bg-surface py-ui-2 pl-ui-3 pr-ui-4 text-left shadow-ui-xs outline-none transition-colors hover:border-ui-border-strong hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-primary/20",
          open ? "border-primary/25 bg-surface-raised" : "border-ui-border",
        )}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <TenantGlyph />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-ui-1.5">
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {activeTenant?.label ?? "选择租户"}
            </span>
            {activeTenant ? (
              <span className="shrink-0 rounded-ui-full bg-workspace-soft px-2 py-0.5 text-[11px] font-medium leading-4 text-workspace">
                租户
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-subtle-foreground">
            {activeTenant?.root ?? "请选择租户"}
          </span>
        </span>
        <svg aria-hidden="true" className={cn("h-4 w-4 shrink-0 text-subtle-foreground transition-transform", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="m7 9 5 5 5-5" />
        </svg>
      </button>

      {open ? (
        <div aria-label="切换租户" className="absolute inset-x-0 top-[calc(100%+6px)] z-50 grid gap-ui-1 rounded-ui-md border border-ui-border bg-surface-raised p-ui-1.5 shadow-ui-overlay" role="menu">
          {props.tenants.map((tenant) => {
            const selected = tenant.id === activeTenant?.id;
            return (
              <button
                aria-checked={selected}
                className={cn("flex min-h-14 items-center gap-ui-3 rounded-ui-sm py-ui-2 pl-ui-3 pr-ui-2 text-left outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-primary/20", selected && "bg-primary-soft")}
                key={tenant.id}
                onClick={() => {
                  props.onValueChange(tenant.id);
                  setOpen(false);
                }}
                role="menuitemradio"
                type="button"
              >
                <TenantGlyph />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{tenant.label}</span>
                  <span className="block truncate text-[11px] text-subtle-foreground">{tenant.root}</span>
                </span>
                {selected ? <span className="text-primary">✓</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
