import { useState, type FormEvent } from "react";
import { formLabelClass, formRowClass, inputClass } from "../lib/ui";
import { Button, Modal } from "./ui";

export function PromptFragmentFileDialog(props: {
  mode: "create" | "rename";
  initialRelativePath?: string;
  onClose: () => void;
  onSubmit: (values: { relativePath: string; tagName: string }) => Promise<void>;
}): JSX.Element {
  const [relativePath, setRelativePath] = useState(props.initialRelativePath ?? "");
  const [tagName, setTagName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    try {
      await props.onSubmit({ relativePath: relativePath.trim(), tagName: tagName.trim() });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      className="max-w-lg p-ui-4"
      closeDisabled={submitting}
      labelledBy="prompt-fragment-file-title"
      onClose={props.onClose}
    >
      <form onSubmit={(event) => void submit(event)}>
        <h2 className="m-0 text-xl" id="prompt-fragment-file-title">{props.mode === "create" ? "新建提示词片段" : "重命名提示词片段"}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          文件路径相对于当前片段库根目录，可包含文件夹；新建时未填写后缀会自动补为 .xml。
        </p>
        <label className={formRowClass}>
          <span className={formLabelClass}>文件路径</span>
          <input
            autoFocus
            className={inputClass}
            onChange={(event) => setRelativePath(event.target.value)}
            placeholder="roles/financial-advisor.xml"
            value={relativePath}
          />
        </label>
        {props.mode === "create" ? (
          <label className={formRowClass}>
            <span className={formLabelClass}>XML 根标签</span>
            <input
              className={inputClass}
              onChange={(event) => setTagName(event.target.value)}
              placeholder="role"
              value={tagName}
            />
          </label>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={props.onClose} type="button">取消</Button>
          <Button
            variant="primary"
            disabled={submitting || !relativePath.trim() || (props.mode === "create" && !tagName.trim())}
            type="submit"
          >
            {submitting ? "提交中..." : props.mode === "create" ? "创建并提交" : "重命名并提交"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
