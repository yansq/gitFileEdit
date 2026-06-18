export function formatTime(isoTime: string | null): string {
  if (!isoTime) {
    return "未同步";
  }
  return new Date(isoTime).toLocaleString("zh-CN", {
    hour12: false
  });
}

export function getCommitSubject(message: string): string {
  return message.split("\n")[0]?.trim() || "无提交说明";
}

export function getCommitBody(message: string): string {
  const lines = message.split("\n");
  lines.shift();
  return lines.join("\n").trim();
}

export function formatSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
