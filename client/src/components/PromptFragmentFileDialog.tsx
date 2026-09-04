import { useState, type FormEvent } from "react";
import { formLabelClass, formRowClass, inputClass, primaryButtonClass, secondaryButtonClass } from "../lib/ui";

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
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#10262b]/45 px-4">
      <form className="w-full max-w-lg rounded-[26px] bg-white p-5 shadow-[0_28px_80px_rgba(16,38,43,0.28)]" onSubmit={(event) => void submit(event)}>
        <h2 className="m-0 text-xl">{props.mode === "create" ? "新建提示词片段" : "重命名提示词片段"}</h2>
        <p className="mt-2 text-sm leading-relaxed text-[#6c7d83]">
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
        <div className="mt-5 flex justify-end gap-3">
          <button className={secondaryButtonClass} onClick={props.onClose} type="button">取消</button>
          <button
            className={primaryButtonClass}
            disabled={submitting || !relativePath.trim() || (props.mode === "create" && !tagName.trim())}
            type="submit"
          >
            {submitting ? "提交中..." : props.mode === "create" ? "创建并提交" : "重命名并提交"}
          </button>
        </div>
      </form>
    </div>
  );
}
