import { useState } from "react";
import { Button, Modal } from "./ui";

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Intranet HTTP deployments may not expose the Clipboard API.
    const previouslyFocused = document.activeElement;
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      if (!document.execCommand("copy")) throw new Error("复制失败");
    } finally {
      textarea.remove();
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true });
    }
  }
}

export function McpConnectionDialog(props: { onClose: () => void }): JSX.Element {
  const [withToken, setWithToken] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");
  const endpoint = new URL("/mcp", window.location.origin).href;
  const config = JSON.stringify({
    mcpServers: {
      "git-file-edit": {
        url: endpoint,
        ...(withToken ? { headers: { Authorization: "Bearer <接入凭据>" } } : {}),
      },
    },
  }, null, 2);

  async function copy(value: string, label: string): Promise<void> {
    try {
      await copyText(value);
      setCopyNotice(`已复制${label}`);
    } catch {
      setCopyNotice("复制失败，请手动选择并复制内容");
    }
  }

  return (
    <Modal
      className="flex max-h-[80vh] max-w-2xl flex-col overflow-hidden"
      labelledBy="mcp-connection-title"
      onClose={props.onClose}
    >
      <div className="flex shrink-0 items-center justify-between gap-ui-3 border-b border-ui-border p-ui-4">
        <h2 className="m-0 text-xl" id="mcp-connection-title">MCP 接入</h2>
        <Button onClick={props.onClose} size="sm" variant="secondary">关闭</Button>
      </div>
      <div className="grid min-h-0 gap-ui-5 overflow-y-auto overscroll-contain p-ui-4 text-sm text-muted-foreground">
        <p className="m-0 leading-relaxed">
          在支持 Streamable HTTP 的 Agent 中添加此服务，即可搜索配置、查询配置值和修改记录。Agent 需要能够访问当前服务所在的网络。
        </p>
        <section>
          <div className="mb-ui-2 flex items-center justify-between gap-ui-3">
            <h3 className="m-0 text-sm font-semibold text-foreground">服务地址</h3>
            <Button onClick={() => { void copy(endpoint, "服务地址"); }} size="sm" variant="secondary">复制地址</Button>
          </div>
          <code className="block break-all rounded-ui-md border border-ui-border bg-surface-subtle p-ui-3 text-foreground">{endpoint}</code>
          <p className="mb-0 mt-ui-2 text-xs leading-relaxed">与网页共用端口，无需额外容器或端口映射。客户端选择 Streamable HTTP 传输方式。</p>
        </section>
        <section>
          <div className="mb-ui-3 flex items-center justify-between gap-ui-3">
            <h3 className="m-0 text-sm font-semibold text-foreground">客户端配置示例</h3>
            <Button onClick={() => { void copy(config, "客户端配置"); }} size="sm" variant="secondary">复制配置</Button>
          </div>
          <label className="flex cursor-pointer items-center gap-ui-2 text-foreground">
            <input
              checked={withToken}
              className="h-4 w-4 accent-primary"
              onChange={(event) => { setWithToken(event.target.checked); setCopyNotice(""); }}
              type="checkbox"
            />
            使用接入凭据
          </label>
          <p className="mb-ui-3 mt-ui-2 text-xs leading-relaxed">
            服务端设置 APP_MCP_TOKEN 时勾选，并将示例中的 &lt;接入凭据&gt; 替换为管理员提供的值。未设置时无需勾选。
          </p>
          <pre className="m-0 overflow-x-auto rounded-ui-md border border-ui-border bg-surface-subtle p-ui-3 text-xs leading-relaxed text-foreground"><code>{config}</code></pre>
          <p className="mb-0 mt-ui-2 text-xs leading-relaxed">不同客户端的配置字段可能不同；也可在客户端界面分别填写服务地址和 Authorization 请求头。</p>
        </section>
        <section>
          <h3 className="m-0 text-sm font-semibold text-foreground">接入后可以这样问</h3>
          <ul className="mb-0 mt-ui-2 list-disc space-y-ui-2 pl-ui-5 leading-relaxed">
            <li>开发环境中 timeout 配置的最新值是什么？</li>
            <li>这个配置值最近是谁改的，之前的值是什么？</li>
            <li>验收环境从 10 月 1 日至今做了哪些配置改动？</li>
            <li>某个配置项在哪些配置文件里？</li>
          </ul>
        </section>
        <p className="m-0 min-h-5 text-xs text-foreground" role="status">{copyNotice}</p>
      </div>
    </Modal>
  );
}
