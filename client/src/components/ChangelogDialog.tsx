import { changelogEntries } from "../data/changelog";
import { Button, Modal } from "./ui";

export function ChangelogDialog(props: { onClose: () => void }): JSX.Element {
  return (
    <Modal
      className="flex max-h-[80vh] max-w-2xl flex-col overflow-hidden"
      labelledBy="changelog-title"
      onClose={props.onClose}
    >
      <div className="flex shrink-0 items-center justify-between gap-ui-3 border-b border-ui-border p-ui-4">
        <h2 className="m-0 text-xl" id="changelog-title">更新日志</h2>
        <Button onClick={props.onClose} size="sm" variant="secondary">关闭</Button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-ui-4">
        {changelogEntries.map((entry, index) => (
          <article className="border-b border-ui-border py-ui-5 last:border-b-0" key={`${entry.date}-${entry.title}`}>
            <div className="flex items-center gap-ui-2 text-xs text-subtle-foreground">
              <time dateTime={entry.date}>{entry.date}</time>
              {index === 0 ? <span className="rounded-ui-full bg-primary-soft px-ui-2 py-0.5 font-medium text-primary">最新</span> : null}
            </div>
            <h3 className="mb-ui-4 mt-ui-2 text-base font-semibold text-foreground">{entry.title}</h3>
            <div className="grid gap-ui-4">
              {entry.sections.map((section) => (
                <section key={section.title}>
                  <h4 className="m-0 text-sm font-semibold text-foreground">{section.title}</h4>
                  <ul className="mb-0 mt-ui-2 list-disc space-y-ui-2 pl-ui-5 text-sm leading-relaxed text-muted-foreground">
                    {section.items.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </section>
              ))}
            </div>
          </article>
        ))}
      </div>
    </Modal>
  );
}
