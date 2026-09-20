import { useState, type FormEvent } from "react";
import { formLabelClass, formRowClass, inputClass } from "../lib/ui";
import { Button, Modal } from "./ui";

export function ConfigFileDialog(props: {
  mode: "create" | "rename";
  initialRelativePath?: string;
  onClose: () => void;
  onSubmit: (relativePath: string) => Promise<void>;
}): JSX.Element {
  const [relativePath, setRelativePath] = useState(props.initialRelativePath ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    try {
      await props.onSubmit(relativePath.trim());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      className="max-w-lg p-ui-4"
      closeDisabled={submitting}
      labelledBy="config-file-dialog-title"
      onClose={props.onClose}
    >
      <form onSubmit={(event) => void submit(event)}>
        <h2 className="m-0 text-xl" id="config-file-dialog-title">
          {props.mode === "create" ? "新建配置文件" : "重命名配置文件"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          文件路径相对于当前环境根目录，可包含子文件夹。操作会立即提交并推送。
        </p>
        <label className={formRowClass}>
          <span className={formLabelClass}>文件路径</span>
          <input
            autoFocus
            className={inputClass}
            onChange={(event) => setRelativePath(event.target.value)}
            placeholder="service/application.properties"
            value={relativePath}
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={props.onClose} type="button">取消</Button>
          <Button variant="primary" disabled={submitting || !relativePath.trim()} type="submit">
            {submitting ? "提交中..." : props.mode === "create" ? "创建并提交" : "重命名并提交"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
