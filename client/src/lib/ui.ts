export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export const panelClass =
  "rounded-[28px] border border-slate-900/10 bg-white/75 p-5 shadow-[0_20px_50px_rgba(33,51,63,0.08)] backdrop-blur";
export const panelTitleRowClass = "mb-4 flex items-center justify-between gap-3";
export const secondaryButtonClass =
  "rounded-2xl border-0 bg-[#143138]/[0.08] px-4 py-2.5 text-[#183039] transition duration-200 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0";
export const primaryButtonClass =
  "rounded-2xl border-0 bg-gradient-to-br from-[#0e6b72] to-[#1e8f6b] px-4 py-2.5 text-white shadow-[0_12px_28px_rgba(18,118,112,0.22)] transition duration-200 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0";
export const formRowClass = "mb-3.5 grid gap-2";
export const formLabelClass = "text-sm font-semibold text-[#223841]";
export const inputClass =
  "rounded-2xl border border-[#183039]/10 bg-[#fcfdfc]/95 px-3.5 py-3 outline-none";
export const emptyBlockClass =
  "rounded-[22px] border border-dashed border-[#183039]/15 bg-[#f6f9f7]/85 p-6 text-center text-[#73848a]";
export const editorSurfaceHeightClass = "h-[62vh] min-h-[360px] max-h-[640px] overflow-auto";
