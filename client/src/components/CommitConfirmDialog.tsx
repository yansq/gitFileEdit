import { primaryButtonClass, secondaryButtonClass } from "../lib/ui";

export function CommitConfirmDialog(props: {
  selectedPath: string;
  commitMessage: string;
  committing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-[#18242d]/35 p-4 backdrop-blur-sm">
      <div className="w-full max-w-[440px] rounded-[24px] border border-slate-900/10 bg-white p-5 shadow-[0_30px_90px_rgba(24,36,45,0.24)]">
        <h2 className="m-0 text-xl leading-tight text-[#183039]">确认提交并推送该文件？</h2>
        <div className="mt-4 grid gap-3 text-sm text-[#53666d]">
          <div>
            <div className="mb-1 font-semibold text-[#253c44]">文件</div>
            <div className="break-all rounded-2xl bg-[#f3f6f5] px-3 py-2 font-mono text-xs text-[#183039]">
              {props.selectedPath}
            </div>
          </div>
          <div>
            <div className="mb-1 font-semibold text-[#253c44]">Commit 信息</div>
            <div className="break-words rounded-2xl bg-[#f3f6f5] px-3 py-2 text-[#183039]">
              {props.commitMessage.trim() || "更新配置"}
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2.5">
          <button
            className={secondaryButtonClass}
            type="button"
            onClick={props.onCancel}
            disabled={props.committing}
          >
            取消
          </button>
          <button
            className={primaryButtonClass}
            type="button"
            onClick={props.onConfirm}
            disabled={props.committing}
          >
            {props.committing ? "提交中..." : "确认提交并推送"}
          </button>
        </div>
      </div>
    </div>
  );
}
