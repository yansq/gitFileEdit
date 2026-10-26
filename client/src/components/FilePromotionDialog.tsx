import { useEffect, useState } from "react";
import { ApiRequestError, requestJson } from "../lib/api";
import { formLabelClass, formRowClass, inputClass } from "../lib/ui";
import type { FilePromotionPreview, RepoEnvironmentOption } from "../types";
import { ReadOnlyDiff } from "./ReadOnlyDiff";
import { Button, Modal, Select } from "./ui";

export function FilePromotionDialog(props: {
  sourcePath: string;
  sourceEnvironment: RepoEnvironmentOption;
  environments: RepoEnvironmentOption[];
  isAdmin: boolean;
  onClose: () => void;
  onAuthError: (error: unknown) => void;
  onApplied: (path: string) => Promise<void>;
}): JSX.Element {
  const targets = props.environments.filter(
    (environment) =>
      environment.kind === "config" &&
      environment.tenantId === props.sourceEnvironment.tenantId &&
      environment.id !== props.sourceEnvironment.id,
  );
  const [targetEnvironmentId, setTargetEnvironmentId] = useState("");
  const [targetPath, setTargetPath] = useState("");
  const [targetPaths, setTargetPaths] = useState<string[]>([]);
  const [preview, setPreview] = useState<FilePromotionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const target = targets.find((environment) => environment.id === targetEnvironmentId);
  const canWriteTarget = Boolean(target && (props.isAdmin || !target.requiresAdminToEdit));

  useEffect(() => {
    if (!targetEnvironmentId || !canWriteTarget) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setPreview(null);
    void requestJson<FilePromotionPreview>("/api/file-promotion/preview", {
      method: "POST",
      body: JSON.stringify({ sourcePath: props.sourcePath, targetEnvironmentId, targetPath }),
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setPreview(result);
      })
      .catch((previewError: unknown) => {
        if (!controller.signal.aborted) {
          setError((previewError as Error).message);
          if (
            previewError instanceof ApiRequestError &&
            previewError.payload &&
            typeof previewError.payload === "object" &&
            "targetPaths" in previewError.payload
          ) {
            const paths = (previewError.payload as { targetPaths: unknown }).targetPaths;
            if (Array.isArray(paths) && paths.every((value) => typeof value === "string")) {
              setTargetPaths(paths);
              setError(null);
            }
          }
          props.onAuthError(previewError);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [props.sourcePath, targetEnvironmentId, targetPath, canWriteTarget, reload]);

  async function apply(): Promise<void> {
    if (!preview || !preview.canApply || !canWriteTarget) return;
    setApplying(true);
    setError(null);
    try {
      const result = await requestJson<{ head: string; path: string }>(
        "/api/file-promotion/apply",
        {
          method: "POST",
          body: JSON.stringify({
            sourcePath: preview.sourcePath,
            targetEnvironmentId: preview.targetEnvironmentId,
            targetPath: preview.targetPath,
            baseHead: preview.baseHead,
            message,
          }),
        },
      );
      await props.onApplied(result.path);
    } catch (applyError) {
      setPreview(null);
      setError((applyError as Error).message);
      props.onAuthError(applyError);
    } finally {
      setApplying(false);
    }
  }

  return (
    <Modal
      className="flex max-h-[calc(100vh-2rem)] max-w-6xl flex-col overflow-hidden"
      closeDisabled={applying}
      labelledBy="file-promotion-title"
      onClose={props.onClose}
    >
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-ui-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="m-0 text-xl" id="file-promotion-title">
              文件晋级
            </h2>
            <p className="mb-0 mt-2 break-all text-sm text-muted-foreground">
              来源：{props.sourceEnvironment.label} · {props.sourcePath}
            </p>
          </div>
          <Button disabled={applying} onClick={props.onClose}>
            关闭
          </Button>
        </div>
        <p className="m-0 text-sm text-muted-foreground">
          将来源文件已提交的最新版本覆盖到目标环境的同名文件，确认后提交并推送。
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid w-56 max-w-full gap-1.5">
            <span className={formLabelClass}>目标环境</span>
            <Select
              label="目标环境"
              disabled={applying || !targets.length}
              onValueChange={(value) => {
                setPreview(null);
                setError(null);
                setLoading(false);
                setTargetPath("");
                setTargetPaths([]);
                setTargetEnvironmentId(value);
              }}
              options={targets.map((environment) => ({
                value: environment.id,
                label: `${environment.label}${!props.isAdmin && environment.requiresAdminToEdit ? "（无写权限）" : ""}`,
                disabled: !props.isAdmin && environment.requiresAdminToEdit,
              }))}
              placeholder="请选择目标环境"
              value={targetEnvironmentId}
            />
          </div>
          <Button
            disabled={!canWriteTarget || loading || applying}
            onClick={() => {
              setPreview(null);
              setTargetPath("");
              setTargetPaths([]);
              setReload((value) => value + 1);
            }}
          >
            查看差异
          </Button>
        </div>
        {targetPaths.length > 1 ? (
          <div className="grid w-full max-w-2xl gap-1.5">
            <span className={formLabelClass}>目标文件（存在多个同名文件）</span>
            <Select
              label="目标文件"
              disabled={applying}
              value={targetPath}
              placeholder="请选择目标文件"
              options={targetPaths.map((filePath) => ({ value: filePath, label: filePath }))}
              onValueChange={(value) => {
                setPreview(null);
                setTargetPath(value);
              }}
            />
          </div>
        ) : null}
        {!targets.some((environment) => props.isAdmin || !environment.requiresAdminToEdit) ? (
          <p className="m-0 text-sm text-muted-foreground">当前租户下没有可写入的其他配置环境。</p>
        ) : null}
        {error ? (
          <div className="rounded-ui-md bg-danger-soft p-ui-3 text-sm text-danger" role="alert">
            {error}
          </div>
        ) : null}
        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground" role="status">
            正在加载晋级差异...
          </div>
        ) : null}
        {preview && !loading ? (
          <>
            <div className="break-all text-sm text-foreground">目标文件：{preview.targetPath}</div>
            <div className="grid grid-cols-2 gap-3 text-sm font-semibold text-muted-foreground">
              <span>覆盖前 · {preview.targetEnvironmentLabel}</span>
              <span>覆盖后 · 来自{preview.sourceEnvironmentLabel}</span>
            </div>
            <ReadOnlyDiff before={preview.beforeContent} after={preview.afterContent} />
            <label className={formRowClass}>
              <span className={formLabelClass}>晋级说明（可选）</span>
              <input
                className={inputClass}
                disabled={applying}
                onChange={(event) => setMessage(event.target.value)}
                value={message}
              />
            </label>
          </>
        ) : null}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-ui-border px-ui-4 py-ui-3">
        <Button disabled={applying} onClick={props.onClose}>
          取消
        </Button>
        <Button
          disabled={
            loading ||
            applying ||
            !canWriteTarget ||
            !preview?.canApply ||
            preview.targetEnvironmentId !== targetEnvironmentId
          }
          onClick={() => void apply()}
          variant="primary"
        >
          {applying ? "正在晋级..." : "确认覆盖并推送"}
        </Button>
      </div>
    </Modal>
  );
}
