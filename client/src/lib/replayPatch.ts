import { applyPatch, createPatch } from "diff";

export function createReplayPatch(filePath: string, beforeContent: string, afterContent: string): string {
  return createPatch(filePath, beforeContent, afterContent, "", "", { context: 4 });
}

export function applyReplayPatch(content: string, patch: string): string | null {
  return applyPatch(content, patch, { fuzzFactor: 0 }) || null;
}
