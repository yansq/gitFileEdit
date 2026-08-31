import { lazy, Suspense, useMemo, useState } from "react";
import type { PromptFragmentBatchPreview, RepoEnvironmentOption } from "../types";
import {
  cn,
  emptyBlockClass,
  formLabelClass,
  formRowClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass
} from "../lib/ui";

type PreviewFilter = "all" | "changed" | "unchanged" | "missing" | "error";

const DiffView = lazy(async () => ({
  default: (await import("./DiffView")).DiffView
}));

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) as { error?: string } : {};
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload as T;
}

export function PromptFragmentBatchDialog(props: {
  sourcePath: string;
  environments: RepoEnvironmentOption[];
  onClose: () => void;
  onApplied: (paths: string[]) => Promise<void> | void;
  onError: (message: string) => void;
}): JSX.Element {
  const targets = useMemo(
    () => props.environments.filter((item) => item.kind === "config"),
    [props.environments]
  );
  const [environmentIds, setEnvironmentIds] = useState<string[]>([]);
  const [pattern, setPattern] = useState("**/*");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<PromptFragmentBatchPreview | null>(null);
  const [activeFilter, setActiveFilter] = useState<PreviewFilter>("changed");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  function toggleEnvironment(environmentId: string): void {
    setPreview(null);
    setSelectedPaths([]);
    setEnvironmentIds((current) =>
      current.includes(environmentId)
        ? current.filter((item) => item !== environmentId)
        : [...current, environmentId]
    );
  }

  async function loadPreview(): Promise<void> {
    setLoading(true);
    try {
      const nextPreview = await postJson<PromptFragmentBatchPreview>(
        "/api/prompt-fragments/preview",
        { sourcePath: props.sourcePath, environmentIds, pattern }
      );
      setPreview(nextPreview);
      setActiveFilter("changed");
      setSelectedPaths(
        nextPreview.items.filter((item) => item.status === "changed").map((item) => item.path)
      );
    } catch (error) {
      props.onError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const filteredItems = preview
    ? activeFilter === "all"
      ? preview.items
      : preview.items.filter((item) => item.status === activeFilter)
    : [];

  async function applyBatch(): Promise<void> {
    if (!preview) return;
    setApplying(true);
    try {
      const result = await postJson<{ head: string; paths: string[] }>(
        "/api/prompt-fragments/apply",
        {
          sourcePath: props.sourcePath,
          environmentIds,
          pattern,
          baseHead: preview.baseHead,
          selectedPaths,
          message
        }
      );
      await props.onApplied(result.paths);
    } catch (error) {
      props.onClose();
      props.onError((error as Error).message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-[#10262b]/45 px-4 py-8">
      <div className="mx-auto grid w-full max-w-6xl gap-5 rounded-[28px] bg-white p-5 shadow-[0_28px_90px_rgba(16,38,43,0.3)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-xl">批量替换提示词片段</h2>
            <div className="mt-2 break-all text-sm text-[#64777e]">来源：{props.sourcePath}</div>
            {preview ? <div className="mt-1 text-sm text-[#315159]">根标签：&lt;{preview.tagName}&gt;</div> : null}
          </div>
          <button className={secondaryButtonClass} onClick={props.onClose} type="button">关闭</button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <fieldset className="rounded-[20px] border border-[#183039]/10 p-4">
            <legend className="px-2 text-sm font-semibold text-[#223841]">目标环境</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {targets.map((environment) => (
                <label className="flex items-center gap-2 rounded-xl bg-[#f3f7f5] px-3 py-2.5 text-sm" key={environment.id}>
                  <input
                    checked={environmentIds.includes(environment.id)}
                    onChange={() => toggleEnvironment(environment.id)}
                    type="checkbox"
                  />
                  <span>{environment.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label className={formRowClass}>
              <span className={formLabelClass}>文件路径匹配</span>
              <input
                className={inputClass}
                value={pattern}
                onChange={(event) => {
                  setPattern(event.target.value);
                  setPreview(null);
                  setSelectedPaths([]);
                }}
                placeholder="/tob-uat/*_prompt_cn"
              />
            </label>
            <div className="text-xs leading-relaxed text-[#71838a]">
              相对于每个目标环境根目录；* 不跨目录，** 可跨任意层级，禁止使用 ..。
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            className={primaryButtonClass}
            disabled={loading || !environmentIds.length || !pattern.trim()}
            onClick={() => void loadPreview()}
            type="button"
          >
            {loading ? "正在扫描..." : "生成替换预览"}
          </button>
        </div>

        {preview ? (
          <>
            <div className="grid gap-2 sm:grid-cols-5">
              {[
                ["all", "路径匹配", preview.matchedCount],
                ["changed", "可替换", preview.changedCount],
                ["unchanged", "内容相同", preview.unchangedCount],
                ["missing", "未命中标签", preview.missingCount],
                ["error", "异常", preview.errorCount]
              ].map(([filter, label, value]) => (
                <button
                  aria-pressed={activeFilter === filter}
                  className={cn(
                    "rounded-2xl px-3 py-3 text-center transition",
                    activeFilter === filter
                      ? "bg-[#0e6b72] text-white shadow-[0_10px_24px_rgba(18,118,112,0.2)]"
                      : "bg-[#f1f6f4] text-[#183039] hover:bg-[#e2efeb]"
                  )}
                  key={String(filter)}
                  onClick={() => setActiveFilter(filter as PreviewFilter)}
                  type="button"
                >
                  <div className={cn("text-xl font-bold", activeFilter === filter ? "text-white" : "text-[#183039]")}>{value}</div>
                  <div className={cn("mt-1 text-xs", activeFilter === filter ? "text-white/80" : "text-[#6c7d83]")}>{label}</div>
                </button>
              ))}
            </div>

            {preview.errorCount ? (
              <div className="rounded-2xl border border-[#c94a35]/20 bg-[#c94a35]/10 px-4 py-3 text-sm text-[#8d3322]">
                存在 XML 标签异常。必须先修复所有异常文件，再重新生成预览。
              </div>
            ) : null}

            <div className="grid max-h-[48vh] gap-3 overflow-auto pr-1">
              {filteredItems.length === 0 ? (
                <div className={emptyBlockClass}>
                  {activeFilter === "all" ? "当前路径条件没有匹配文件" : "当前筛选条件下没有文件"}
                </div>
              ) : filteredItems.map((item) => {
                const selectable = item.status === "changed";
                return (
                  <details className="rounded-[20px] border border-[#183039]/10 bg-[#fafcfb] p-3" key={item.path} open={item.status === "error"}>
                    <summary className="cursor-pointer list-none">
                      <div className="flex flex-wrap items-center gap-2">
                        {selectable ? (
                          <input
                            checked={selectedPaths.includes(item.path)}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => setSelectedPaths((current) =>
                              event.target.checked
                                ? [...current, item.path]
                                : current.filter((path) => path !== item.path)
                            )}
                            type="checkbox"
                          />
                        ) : null}
                        <span className={cn(
                          "rounded-full px-2.5 py-1 text-xs",
                          item.status === "changed" && "bg-[#1d8c68]/10 text-[#17684f]",
                          item.status === "error" && "bg-[#c94a35]/10 text-[#9f2f20]",
                          item.status === "missing" && "bg-[#d8a21b]/15 text-[#785918]",
                          item.status === "unchanged" && "bg-[#183039]/10 text-[#40545b]"
                        )}>{item.message}</span>
                        <span className="min-w-0 break-all text-sm font-semibold text-[#183039]">{item.path}</span>
                      </div>
                    </summary>
                    {item.beforeContent !== undefined && item.afterContent !== undefined ? (
                      <Suspense fallback={<div className="mt-3 text-sm text-[#6c7d83]">正在加载差异...</div>}>
                        <DiffView
                          before={item.beforeContent}
                          after={item.afterContent}
                          emptyText="内容没有变化"
                          display="unified"
                          className="mt-3 max-h-[360px] overflow-auto"
                        />
                      </Suspense>
                    ) : item.beforeContent !== undefined ? (
                      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-[#f1f4f3] p-3 text-xs">{item.beforeContent}</pre>
                    ) : null}
                  </details>
                );
              })}
            </div>

            <label className={formRowClass}>
              <span className={formLabelClass}>提交说明（可选）</span>
              <textarea className={cn(inputClass, "min-h-20 resize-y")} value={message} onChange={(event) => setMessage(event.target.value)} />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-[#64777e]">已选择 {selectedPaths.length} 个文件，将作为一个 Git commit 提交。</div>
              <button
                className={primaryButtonClass}
                disabled={!preview.canApply || !selectedPaths.length || applying}
                onClick={() => void applyBatch()}
                type="button"
              >
                {applying ? "正在提交..." : "确认批量替换并推送"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
