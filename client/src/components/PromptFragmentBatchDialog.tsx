import { lazy, Suspense, useMemo, useState } from "react";
import type { PromptFragmentBatchPreview, RepoEnvironmentOption } from "../types";
import {
  cn,
  emptyBlockClass,
  formLabelClass,
  formRowClass,
  inputClass
} from "../lib/ui";
import { Button, Modal } from "./ui";

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
  const [expandedPreviewPath, setExpandedPreviewPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  function toggleEnvironment(environmentId: string): void {
    setPreview(null);
    setSelectedPaths([]);
    setExpandedPreviewPath(null);
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
      setExpandedPreviewPath(null);
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
    <Modal
      className="max-h-[calc(100vh-1.5rem)] max-w-6xl overflow-hidden"
      closeDisabled={applying}
      labelledBy="prompt-fragment-batch-title"
      onClose={props.onClose}
      overlayClassName="p-3"
    >
      <div className="grid max-h-[calc(100vh-1.5rem)] gap-3 overflow-y-auto overscroll-contain p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-xl" id="prompt-fragment-batch-title">批量替换提示词片段</h2>
            <div className="mt-2 break-all text-sm text-muted-foreground">来源：{props.sourcePath}</div>
            {preview ? <div className="mt-1 text-sm text-foreground">根标签：&lt;{preview.tagName}&gt;</div> : null}
          </div>
          <Button variant="secondary" onClick={props.onClose} type="button">关闭</Button>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <fieldset className="rounded-ui-md border border-ui-border p-ui-3">
            <legend className="px-ui-2 text-sm font-semibold text-foreground">目标环境</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {targets.map((environment) => (
                <label className="flex items-center gap-ui-2 rounded-ui-md bg-surface-subtle px-ui-3 py-ui-2 text-sm" key={environment.id}>
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
                  setExpandedPreviewPath(null);
                }}
                placeholder="/tob-uat/*_prompt_cn"
              />
            </label>
            <div className="text-xs leading-relaxed text-subtle-foreground">
              相对于每个目标环境根目录；* 不跨目录，** 可跨任意层级，禁止使用 ..。
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                variant="primary"
                disabled={loading || !environmentIds.length || !pattern.trim()}
                onClick={() => void loadPreview()}
                type="button"
              >
                {loading ? "正在扫描..." : "生成替换预览"}
              </Button>
            </div>
          </div>
        </div>

        {preview ? (
          <>
            <div className="flex flex-wrap gap-ui-1 rounded-ui-md bg-surface-muted p-ui-1">
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
                    "inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
                    activeFilter === filter
                      ? "bg-primary text-primary-foreground shadow-ui-xs"
                      : "text-muted-foreground hover:bg-surface/80 hover:text-foreground"
                  )}
                  key={String(filter)}
                  onClick={() => setActiveFilter(filter as PreviewFilter)}
                  type="button"
                >
                  <span className={cn("font-bold", activeFilter === filter ? "text-primary-foreground" : "text-foreground")}>{value}</span>
                  <span className={activeFilter === filter ? "text-primary-foreground/85" : "text-muted-foreground"}>{label}</span>
                </button>
              ))}
            </div>

            {preview.errorCount ? (
              <div className="rounded-ui-md border border-warning/20 bg-warning-soft px-3 py-2 text-sm text-warning">
                存在 XML 标签异常的文件，无法勾选；其他可替换文件仍可提交。可在“异常”中查看原因。
              </div>
            ) : null}

            <div className="grid max-h-[34vh] gap-2 overflow-auto pr-1">
              {filteredItems.length === 0 ? (
                <div className={emptyBlockClass}>
                  {activeFilter === "all" ? "当前路径条件没有匹配文件" : "当前筛选条件下没有文件"}
                </div>
              ) : filteredItems.map((item) => {
                const selectable = item.status === "changed";
                return (
                  <details
                    className="rounded-ui-md border border-ui-border bg-surface-subtle p-2.5"
                    key={item.path}
                    onToggle={(event) => {
                      const isOpen = event.currentTarget.open;
                      setExpandedPreviewPath((current) =>
                        isOpen ? item.path : current === item.path ? null : current
                      );
                    }}
                    open={expandedPreviewPath === item.path}
                  >
                    <summary className="cursor-pointer list-none">
                      <div className="flex flex-wrap items-center gap-2">
                        {selectable || item.status === "error" ? (
                          <input
                            aria-label={`选择 ${item.path}`}
                            checked={selectable && selectedPaths.includes(item.path)}
                            disabled={!selectable}
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
                          item.status === "changed" && "bg-success-soft text-success",
                          item.status === "error" && "bg-danger-soft text-danger",
                          item.status === "missing" && "bg-warning-soft text-warning",
                          item.status === "unchanged" && "bg-surface-muted text-muted-foreground"
                        )}>{item.message}</span>
                        <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs text-muted-foreground">
                          {item.environmentLabel}
                        </span>
                        <span className="min-w-0 break-all text-sm font-semibold text-foreground">{item.path}</span>
                      </div>
                    </summary>
                    {item.beforeContent !== undefined && item.afterContent !== undefined ? (
                      <Suspense fallback={<div className="mt-3 text-sm text-muted-foreground">正在加载差异...</div>}>
                        <DiffView
                          before={item.beforeContent}
                          after={item.afterContent}
                          emptyText="内容没有变化"
                          display="unified"
                          className="mt-2"
                        />
                      </Suspense>
                    ) : item.beforeContent !== undefined ? (
                      <pre className="mt-2 whitespace-pre-wrap rounded-ui-md bg-surface-muted p-ui-3 text-xs">{item.beforeContent}</pre>
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
              <div className="text-sm text-muted-foreground">已选择 {selectedPaths.length} 个文件，将作为一个 Git commit 提交。</div>
              <Button
                variant="primary"
                disabled={!preview.canApply || !selectedPaths.length || applying}
                onClick={() => void applyBatch()}
                type="button"
              >
                {applying ? "正在提交..." : "确认批量替换并推送"}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
