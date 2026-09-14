import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}

export const panelClass =
  "rounded-lg border border-slate-900/10 bg-white/75 p-4 shadow-[0_20px_50px_rgba(33,51,63,0.08)] backdrop-blur";
export const panelTitleRowClass = "mb-3 flex items-center justify-between gap-2";
export const secondaryButtonClass =
  "inline-flex h-9 items-center justify-center rounded-ui-md border-0 bg-surface-muted px-ui-4 text-[length:var(--font-size-ui-md)] font-semibold leading-[var(--line-height-ui-md)] text-foreground transition-colors duration-ui-normal ease-ui-standard hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none";
export const primaryButtonClass =
  "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-ui-md border border-transparent bg-primary px-ui-4 text-[length:var(--font-size-ui-md)] font-semibold leading-[var(--line-height-ui-md)] text-primary-foreground outline-none transition-colors duration-ui-normal ease-ui-standard hover:bg-primary-hover active:bg-primary-active focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none";
export const formRowClass = "mb-3 grid gap-1.5";
export const formLabelClass = "text-sm font-semibold text-foreground";
export const inputClass =
  "rounded-lg border border-ui-border bg-surface px-3 py-2 outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10";
export const emptyBlockClass =
  "rounded-lg border border-dashed border-ui-border bg-surface-subtle p-4 text-center text-subtle-foreground";
export const editorSurfaceHeightClass = "h-full min-h-0 overflow-auto";
export const workspaceWindowClass =
  "h-full min-h-0 overflow-hidden";
