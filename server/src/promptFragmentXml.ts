interface XmlTagToken {
  start: number;
  end: number;
  name: string;
  kind: "open" | "close" | "self";
}

export interface ParsedPromptFragment {
  tagName: string;
  content: string;
}

export interface PromptElementRange {
  start: number;
  end: number;
}

function readMarkupEnd(content: string, start: number): number {
  if (content.startsWith("<!--", start)) {
    const end = content.indexOf("-->", start + 4);
    if (end === -1) throw new Error("XML 注释没有结束");
    return end + 3;
  }
  if (content.startsWith("<![CDATA[", start)) {
    const end = content.indexOf("]]>", start + 9);
    if (end === -1) throw new Error("XML CDATA 没有结束");
    return end + 3;
  }
  if (content.startsWith("<?", start)) {
    const end = content.indexOf("?>", start + 2);
    if (end === -1) throw new Error("XML 处理指令没有结束");
    return end + 2;
  }

  let quote = "";
  for (let index = start + 1; index < content.length; index += 1) {
    const char = content[index];
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index + 1;
  }
  throw new Error("XML 标签没有结束");
}

function scanXmlTags(content: string): XmlTagToken[] {
  const tokens: XmlTagToken[] = [];
  let index = 0;
  while (index < content.length) {
    const start = content.indexOf("<", index);
    if (start === -1) break;
    if (!/[A-Za-z_!?/]/.test(content[start + 1] ?? "")) {
      index = start + 1;
      continue;
    }
    const end = readMarkupEnd(content, start);
    const raw = content.slice(start, end);
    index = end;

    if (/^<!--|^<!\[CDATA\[|^<\?|^<![^-[]/s.test(raw)) continue;
    const closeMatch = raw.match(/^<\s*\/\s*([A-Za-z_][\w:.-]*)\s*>$/s);
    if (closeMatch) {
      tokens.push({ start, end, name: closeMatch[1], kind: "close" });
      continue;
    }
    const openMatch = raw.match(/^<\s*([A-Za-z_][\w:.-]*)(?:\s[\s\S]*?)?\s*(\/?)>$/);
    if (openMatch) {
      tokens.push({
        start,
        end,
        name: openMatch[1],
        kind: openMatch[2] ? "self" : "open"
      });
    }
  }
  return tokens;
}

export function parsePromptFragment(content: string): ParsedPromptFragment {
  const tokens = scanXmlTags(content);
  if (!tokens.length) throw new Error("片段必须包含一个完整 XML 根元素");

  const stack: XmlTagToken[] = [];
  let rootStart = -1;
  let rootEnd = -1;
  let rootName = "";
  let rootCount = 0;

  for (const token of tokens) {
    if (token.kind === "open") {
      if (stack.length === 0) {
        rootCount += 1;
        rootStart = token.start;
        rootName = token.name;
      }
      stack.push(token);
      continue;
    }
    if (token.kind === "self") {
      if (stack.length === 0) {
        rootCount += 1;
        rootStart = token.start;
        rootEnd = token.end;
        rootName = token.name;
      }
      continue;
    }
    const opening = stack.pop();
    if (!opening || opening.name !== token.name) {
      throw new Error(`XML 标签不匹配：${opening?.name ?? "无开始标签"} / ${token.name}`);
    }
    if (stack.length === 0) rootEnd = token.end;
  }

  if (stack.length) throw new Error(`XML 标签 <${stack[stack.length - 1].name}> 没有结束`);
  if (rootCount !== 1 || rootStart < 0 || rootEnd < 0) {
    throw new Error("片段文件只能包含一个 XML 根元素");
  }
  if (content.slice(0, rootStart).trim() || content.slice(rootEnd).trim()) {
    throw new Error("XML 根元素外不能包含其他文本");
  }

  return {
    tagName: rootName,
    content: content.slice(rootStart, rootEnd)
  };
}

export function findPromptElementRanges(content: string, tagName: string): PromptElementRange[] {
  const tokens = scanXmlTags(content).filter((token) => token.name === tagName);
  const ranges: PromptElementRange[] = [];
  let depth = 0;
  let start = -1;

  for (const token of tokens) {
    if (token.kind === "self") {
      if (depth > 0) throw new Error(`标签 <${tagName}> 存在同名嵌套`);
      ranges.push({ start: token.start, end: token.end });
      continue;
    }
    if (token.kind === "open") {
      if (depth > 0) throw new Error(`标签 <${tagName}> 存在同名嵌套`);
      depth += 1;
      start = token.start;
      continue;
    }
    if (depth === 0) throw new Error(`标签 </${tagName}> 缺少开始标签`);
    depth -= 1;
    if (depth === 0) {
      ranges.push({ start, end: token.end });
      start = -1;
    }
  }

  if (depth !== 0) throw new Error(`标签 <${tagName}> 缺少结束标签`);
  return ranges;
}

export function replaceSinglePromptElement(
  content: string,
  tagName: string,
  replacement: string
): { status: "changed" | "unchanged" | "missing"; content: string } {
  const ranges = findPromptElementRanges(content, tagName);
  if (ranges.length === 0) return { status: "missing", content };
  if (ranges.length !== 1) throw new Error(`标签 <${tagName}> 出现 ${ranges.length} 次`);

  const range = ranges[0];
  const nextContent = `${content.slice(0, range.start)}${replacement}${content.slice(range.end)}`;
  return {
    status: nextContent === content ? "unchanged" : "changed",
    content: nextContent
  };
}

export function compileEnvironmentGlob(patternValue: string): RegExp {
  const pattern = patternValue.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!pattern) throw new Error("请输入文件路径匹配模式");
  if (pattern.split("/").some((segment) => segment === "..")) {
    throw new Error("文件路径匹配模式不能包含 ..");
  }

  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}
