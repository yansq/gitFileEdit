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
  // 片段正文按原样保存，只检查包裹正文的根标签。
  const rootStart = content.search(/\S/);
  if (rootStart < 0 || content[rootStart] !== "<") {
    throw new Error("片段必须包含一个完整 XML 根元素");
  }

  const openingEnd = readMarkupEnd(content, rootStart);
  const opening = content.slice(rootStart, openingEnd).match(/^<\s*([A-Za-z_][\w:.-]*)(?:\s[\s\S]*?)?\s*(\/?)>$/);
  if (!opening) throw new Error("片段必须包含一个完整 XML 根元素");

  const rootName = opening[1];
  if (opening[2]) {
    if (content.slice(openingEnd).trim()) throw new Error("XML 根元素外不能包含其他文本");
    return { tagName: rootName, content: content.slice(rootStart, openingEnd) };
  }

  const closing = content.slice(openingEnd).match(/<\s*\/\s*([A-Za-z_][\w:.-]*)\s*>\s*$/s);
  if (!closing) throw new Error(`XML 标签 <${rootName}> 没有结束`);
  if (closing[1] !== rootName) throw new Error(`XML 标签不匹配：${rootName} / ${closing[1]}`);

  return {
    tagName: rootName,
    content: content.slice(rootStart).trimEnd()
  };
}

function isStandaloneTag(content: string, token: XmlTagToken): boolean {
  const lineStart = content.lastIndexOf("\n", token.start - 1) + 1;
  const nextLine = content.indexOf("\n", token.end);
  const lineEnd = nextLine === -1 ? content.length : nextLine;
  return /^[\t ]*$/.test(content.slice(lineStart, token.start))
    && /^[\t \r]*$/.test(content.slice(token.end, lineEnd));
}

export function findPromptElementRanges(content: string, tagName: string): PromptElementRange[] {
  const matchingTokens = scanXmlTags(content).filter((token) => token.name === tagName);
  const standaloneTokens = matchingTokens.filter((token) => isStandaloneTag(content, token));
  // 配置正文可能内联引用同名标签。若存在独占行的完整标签块，以它作为替换目标。
  const tokens = standaloneTokens.some((token) => token.kind === "open")
    && standaloneTokens.some((token) => token.kind === "close")
    ? standaloneTokens
    : matchingTokens;
  const ranges: PromptElementRange[] = [];
  const openings: XmlTagToken[] = [];

  for (const token of tokens) {
    if (token.kind === "self") {
      ranges.push({ start: token.start, end: token.end });
      continue;
    }
    if (token.kind === "open") {
      openings.push(token);
      continue;
    }
    const opening = openings.pop();
    if (!opening) throw new Error(`标签 </${tagName}> 缺少开始标签`);
    ranges.push({ start: opening.start, end: token.end });
  }

  ranges.sort((left, right) => left.start - right.start);
  if (ranges.some((range, index) => index > 0 && range.start < ranges[index - 1].end)) {
    throw new Error(`标签 <${tagName}> 存在同名嵌套`);
  }
  // 完整标签块外的未闭合引用不属于替换范围，不能阻止唯一完整块的替换。
  if (openings.length && ranges.length === 0) {
    throw new Error(`标签 <${tagName}> 缺少结束标签`);
  }
  return ranges;
}

function getLineIndentation(content: string, offset: number): string {
  const lineStart = content.lastIndexOf("\n", offset - 1) + 1;
  const prefix = content.slice(lineStart, offset);
  return /^[\t ]*$/.test(prefix) ? prefix : "";
}

function indentReplacement(replacement: string, indentation: string): string {
  if (!indentation) return replacement;
  return replacement.replace(/(\r?\n)(?=[^\r\n]*\S)/g, `$1${indentation}`);
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
  const indentedReplacement = indentReplacement(replacement, getLineIndentation(content, range.start));
  const nextContent = `${content.slice(0, range.start)}${indentedReplacement}${content.slice(range.end)}`;
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
