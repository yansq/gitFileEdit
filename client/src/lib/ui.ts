import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}

export const panelClass =
  "rounded-lg border border-slate-900/10 bg-white/75 p-4 shadow-[0_20px_50px_rgba(33,51,63,0.08)] backdrop-blur";
export const panelTitleRowClass = "mb-3 flex items-center justify-between gap-2";
export const secondaryButtonClass =
  "rounded-lg border-0 bg-[#143138]/[0.08] px-3 py-2 text-[#183039] transition duration-200 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 motion-reduce:hover:translate-y-0 motion-reduce:transition-none";
export const primaryButtonClass =
  "rounded-lg border-0 bg-gradient-to-br from-primary to-[rgb(var(--color-primary-gradient-end))] px-3 py-2 text-white shadow-[0_12px_28px_rgb(var(--color-primary-shadow)/0.22)] transition duration-200 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 motion-reduce:hover:translate-y-0 motion-reduce:transition-none";
export const formRowClass = "mb-3 grid gap-1.5";
export const formLabelClass = "text-sm font-semibold text-[#223841]";
export const inputClass =
  "rounded-lg border border-[#183039]/10 bg-[#fcfdfc]/95 px-3 py-2 outline-none";
export const emptyBlockClass =
  "rounded-lg border border-dashed border-[#183039]/15 bg-[#f6f9f7]/85 p-4 text-center text-[#73848a]";
export const editorSurfaceHeightClass = "h-full min-h-0 overflow-auto";
export const workspaceWindowClass =
  "h-full min-h-0 overflow-hidden";
