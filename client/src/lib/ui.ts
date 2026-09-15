import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}

export const panelClass =
  "rounded-ui-lg border border-ui-border bg-surface/75 p-ui-4 shadow-ui-sm backdrop-blur";
export const panelTitleRowClass = "mb-3 flex items-center justify-between gap-2";
export const formRowClass = "mb-3 grid gap-1.5";
export const formLabelClass = "text-sm font-semibold text-foreground";
export const inputClass =
  "rounded-lg border border-ui-border bg-surface px-3 py-2 outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10";
export const emptyBlockClass =
  "rounded-lg border border-dashed border-ui-border bg-surface-subtle p-4 text-center text-subtle-foreground";
export const editorSurfaceHeightClass = "h-full min-h-0 overflow-auto";
export const workspaceWindowClass =
  "h-full min-h-0 overflow-hidden";
