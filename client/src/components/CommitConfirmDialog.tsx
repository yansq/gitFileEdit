import { Button, Modal } from "./ui";

export function CommitConfirmDialog(props: {
  selectedPath: string;
  commitMessage: string;
  committing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <Modal
      className="max-w-[440px] p-ui-4"
      closeDisabled={props.committing}
      labelledBy="commit-confirm-title"
      onClose={props.onCancel}
    >
      <h2 className="m-0 text-xl leading-tight text-foreground" id="commit-confirm-title">
        确认提交并推送该文件？
      </h2>
      <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
        <div>
          <div className="mb-1 font-semibold text-foreground">文件</div>
          <div className="break-all rounded-ui-md bg-surface-muted px-ui-3 py-ui-2 font-mono text-xs text-foreground">
            {props.selectedPath}
          </div>
        </div>
        <div>
          <div className="mb-1 font-semibold text-foreground">Commit 信息</div>
          <div className="break-words rounded-ui-md bg-surface-muted px-ui-3 py-ui-2 text-foreground">
            {props.commitMessage.trim() || "更新配置"}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          type="button"
          onClick={props.onCancel}
          disabled={props.committing}
        >
          取消
        </Button>
        <Button
          variant="primary"
          type="button"
          onClick={props.onConfirm}
          disabled={props.committing}
        >
          {props.committing ? "提交中..." : "确认提交并推送"}
        </Button>
      </div>
    </Modal>
  );
}
