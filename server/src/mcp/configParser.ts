import path from "node:path";
import { isMap, isScalar, isSeq, LineCounter, parseDocument } from "yaml";

export type ConfigFormat = "properties" | "yaml";
export type ConfigValue = string | number | boolean | null | ConfigValue[] | { [key: string]: ConfigValue };
export interface ConfigEntry {
  key: string;
  value: ConfigValue;
  line: number;
}
export interface ParsedConfig {
  format: ConfigFormat | "ambiguous" | "unsupported" | "invalid";
  entries: ConfigEntry[];
  warnings: string[];
}

function decodeProperty(value: string): string {
  return value.replace(/\\(u[0-9a-fA-F]{4}|u|[\s\S])/g, (_match, escape: string) => {
    if (escape === "u") throw new Error("Properties Unicode 转义必须包含四位十六进制字符");
    if (escape.startsWith("u")) return String.fromCharCode(parseInt(escape.slice(1), 16));
    return ({ t: "\t", r: "\r", n: "\n", f: "\f" } as Record<string, string>)[escape] ?? escape;
  });
}

function parseProperties(content: string): ParsedConfig {
  const entries = new Map<string, ConfigEntry>();
  const warnings: string[] = [];
  const lines = content.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  for (let index = 0; index < lines.length; index++) {
    const line = index + 1;
    let text = lines[index].replace(/^[ \t\f]+/, "");
    if (!text || /^[#!]/.test(text)) continue;
    while ((text.match(/\\+$/)?.[0].length ?? 0) % 2 === 1) {
      text = text.slice(0, -1);
      if (++index >= lines.length) break;
      text += lines[index].replace(/^[ \t\f]+/, "");
    }
    let separator = text.length;
    for (let offset = 0; offset < text.length; offset++) {
      if (text[offset] === "\\") { offset++; continue; }
      if (/[=: \t\f]/.test(text[offset])) { separator = offset; break; }
    }
    let valueStart = separator;
    while (/[ \t\f]/.test(text[valueStart] ?? "") && valueStart < text.length) valueStart++;
    if (/[=:]/.test(text[valueStart] ?? "")) valueStart++;
    while (/[ \t\f]/.test(text[valueStart] ?? "") && valueStart < text.length) valueStart++;
    const key = decodeProperty(text.slice(0, separator));
    if (entries.has(key)) warnings.push(`第 ${line} 行的重复键 ${key} 使用最后一个值`);
    entries.set(key, { key, value: decodeProperty(text.slice(valueStart)), line });
  }
  return { format: "properties", entries: [...entries.values()], warnings };
}

function yamlKey(parent: string, segment: string | number): string {
  if (typeof segment === "number") return `${parent}[${segment}]`;
  return /^[\p{L}_$][\p{L}\p{N}_$-]*$/u.test(segment)
    ? `${parent ? `${parent}.` : ""}${segment}`
    : `${parent}[${JSON.stringify(segment)}]`;
}

function parseYaml(content: string): ParsedConfig {
  const lineCounter = new LineCounter();
  const document = parseDocument(content, { lineCounter, strict: true, uniqueKeys: true });
  if (document.errors.length || document.warnings.length) {
    throw new Error([...document.errors, ...document.warnings].map((error) => error.message).join("; "));
  }
  if (!isMap(document.contents) && !isSeq(document.contents)) throw new Error("YAML 配置需要以映射或列表作为根节点");
  const value: unknown = document.toJS({ maxAliasCount: 50 });
  const entries: ConfigEntry[] = [];
  const ancestors = new Set<object>();
  function walk(item: unknown, node: unknown, key: string, inheritedLine: number, depth: number): void {
    if (depth > 40 || entries.length >= 20000) throw new Error("YAML 嵌套层级或配置项数量超出查询限制");
    const range = node && typeof node === "object" && "range" in node ? (node as { range?: number[] }).range : null;
    const line = range ? lineCounter.linePos(range[0]).line : inheritedLine;
    if (item && typeof item === "object") {
      if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error("YAML 配置包含不支持的对象类型");
      if (ancestors.has(item)) throw new Error("YAML 包含循环引用");
      ancestors.add(item);
      if (isMap(node) && node.items.some((pair) => !isScalar(pair.key) || typeof pair.key.value !== "string")) {
        throw new Error("YAML 配置仅支持字符串映射键");
      }
      const children = Object.entries(item);
      if (children.length === 0 && key) entries.push({ key, value: Array.isArray(item) ? [] : {}, line });
      for (const [name, child] of children) {
        const childNode = isMap(node)
          ? node.items.find((pair) => isScalar(pair.key) && pair.key.value === name)?.value
          : isSeq(node) ? node.items[Number(name)] : undefined;
        walk(child, childNode, yamlKey(key, Array.isArray(item) ? Number(name) : name), line, depth + 1);
      }
      ancestors.delete(item);
    } else {
      if (item !== null && !["string", "number", "boolean"].includes(typeof item)) throw new Error("YAML 配置值类型不受支持");
      if (typeof item === "number" && !Number.isFinite(item)) throw new Error("YAML 非有限数字不受支持");
      if (typeof item === "number" && Number.isInteger(item) && !Number.isSafeInteger(item)) throw new Error("YAML 整数超过安全精度，请使用文本查询核对原值");
      entries.push({ key, value: item as ConfigValue, line });
    }
  }
  walk(value, document.contents, "", 1, 0);
  return { format: "yaml", entries, warnings: [] };
}

export function parseConfig(content: string, filePath: string, override?: ConfigFormat): ParsedConfig {
  const extension = path.extname(filePath).toLowerCase();
  if ([".json", ".jsonc", ".xml"].includes(extension)) {
    return { format: "unsupported", entries: [], warnings: ["一期仅支持 Properties 和 YAML 的配置项解析"] };
  }
  const selected = override ?? (extension === ".properties" ? "properties" : [".yaml", ".yml"].includes(extension) ? "yaml" : undefined);
  try {
    if (selected) return selected === "properties" ? parseProperties(content) : parseYaml(content);
    const text = content.replace(/^\uFEFF/, "").trim();
    if (!text || /^[<{\[]/.test(text) || text.includes("\0")) {
      return { format: "unsupported", entries: [], warnings: ["无法自动识别为 Properties/YAML，可继续文本搜索"] };
    }
    const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim() && !/^\s*[#!]/.test(line));
    // An unescaped '=' is strong Properties evidence. Colons alone are valid in both formats.
    const propertyEvidence = lines.some((line) => /^(?:[^\\\s=:]|\\.)*[ \t\f]*=/.test(line.trimStart()));
    const yamlEvidence = lines.some((line) => /^\s*-\s|^\s+[^#\s].*:\s|:\s*[>|][+-]?\s*$|^---\s*$/.test(line)) ||
      lines.some((line) => /^[^\s].*:\s*$/.test(line));
    if (propertyEvidence && !yamlEvidence) return parseProperties(content);
    if (yamlEvidence && !propertyEvidence) return parseYaml(content);
    return { format: "ambiguous", entries: [], warnings: ["格式不确定，请使用 format 参数或 APP_MCP_FORMAT_OVERRIDES 指定 properties/yaml"] };
  } catch (error) {
    return { format: "invalid", entries: [], warnings: [error instanceof Error ? error.message : "配置解析失败"] };
  }
}

export function compareConfigs(before: ParsedConfig | null, after: ParsedConfig | null) {
  if ([before, after].some((parsed) => parsed && !["properties", "yaml"].includes(parsed.format))) return null;
  const oldEntries = new Map(before?.entries.map((entry) => [entry.key, entry]) ?? []);
  const newEntries = new Map(after?.entries.map((entry) => [entry.key, entry]) ?? []);
  return [...new Set([...oldEntries.keys(), ...newEntries.keys()])].sort().flatMap((key) => {
    const oldEntry = oldEntries.get(key);
    const newEntry = newEntries.get(key);
    if (oldEntry && newEntry && JSON.stringify(oldEntry.value) === JSON.stringify(newEntry.value)) return [];
    return [{ key, beforeExists: Boolean(oldEntry), afterExists: Boolean(newEntry),
      beforeValue: oldEntry?.value ?? null, afterValue: newEntry?.value ?? null,
      beforeLine: oldEntry?.line ?? null, afterLine: newEntry?.line ?? null }];
  });
}
