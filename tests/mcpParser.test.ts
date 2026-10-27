import assert from "node:assert/strict";
import test from "node:test";
import { compareConfigs, parseConfig } from "../server/src/mcp/configParser";

test("无后缀 Properties：续行、转义、空值、重复键、Unicode 与行号", () => {
  const parsed = parseConfig("\uFEFF# comment\r\ntimeout=30\r\nlong = hello\\\r\n  world\r\na\\=b: x\\ty\r\nempty=\r\nname=\\u5f20\\u4e09\r\ntimeout=40\r\n", "env_config");
  assert.equal(parsed.format, "properties");
  assert.deepEqual(parsed.entries, [
    { key: "timeout", value: "40", line: 8 }, { key: "long", value: "helloworld", line: 3 },
    { key: "a=b", value: "x\ty", line: 5 }, { key: "empty", value: "", line: 6 },
    { key: "name", value: "张三", line: 7 }
  ]);
  assert.equal(parsed.warnings.length, 1);
  assert.equal(parseConfig("broken=\\uZZZZ", "test.properties").format, "invalid");
});

test("无后缀 YAML：嵌套、列表、多行文本、null、空集合和字面点号键", () => {
  const parsed = parseConfig('server:\n  port: 8080\n  enabled: false\nservers:\n  - host: localhost\nmessage: |\n  hello\n  world\nmissing: null\nempty: {}\n"a.b": literal\n', "application");
  assert.equal(parsed.format, "yaml");
  assert.deepEqual(parsed.entries.map(({ key, value }) => ({ key, value })), [
    { key: "server.port", value: 8080 }, { key: "server.enabled", value: false },
    { key: "servers[0].host", value: "localhost" }, { key: "message", value: "hello\nworld\n" },
    { key: "missing", value: null }, { key: "empty", value: {} }, { key: '["a.b"]', value: "literal" }
  ]);
  assert.equal(parsed.entries[0].line, 2);
  const withQueryString = parseConfig("server:\n  url: https://example.local?a=b\n  command: echo a=b\n", "config");
  assert.equal(withQueryString.format, "yaml");
  assert.equal(withQueryString.entries[0].value, "https://example.local?a=b");
});

test("歧义文件不猜测，显式格式兜底；JSON/XML 只作为文本", () => {
  assert.equal(parseConfig("timeout: 30\nname: service\n", "config").format, "ambiguous");
  assert.equal(parseConfig("timeout: 30\n", "config", "yaml").entries[0].value, 30);
  assert.equal(parseConfig("timeout: 30\n", "config", "properties").entries[0].value, "30");
  for (const file of ["a.json", "a.xml"]) assert.equal(parseConfig("timeout=30", file, "properties").format, "unsupported");
  for (const content of ['{"a": 1}', "<a>value</a>", ""]) assert.equal(parseConfig(content, "config").format, "unsupported");
  assert.equal(parseConfig("timeout: 30\n", "a.yaml").format, "yaml");
  assert.equal(parseConfig("just text", "config").format, "ambiguous");
});

test("YAML 无效内容、重复键与循环别名不会产生虚假配置值", () => {
  for (const content of ["a: [", "a: 1\na: 2\n", "a: &self\n  b: *self\n", "1: value\n", "a: .inf\n", "a: !!timestamp 2001-12-15\n", "a: 9007199254740993\n"]) {
    const parsed = parseConfig(content, "config.yaml");
    assert.equal(parsed.format, "invalid", content);
    assert.equal(parsed.entries.length, 0);
  }
});

test("配置比较区分删除、空字符串、null，忽略注释和格式变化", () => {
  const before = parseConfig("timeout=30\nempty=\n", "config");
  const formatting = parseConfig("# comment\ntimeout = 30\nempty=\n", "config");
  assert.deepEqual(compareConfigs(before, formatting), []);
  const after = parseConfig("timeout=60\nadded=yes\n", "config");
  const changes = compareConfigs(before, after)!;
  assert.deepEqual(changes.map((item) => item.key), ["added", "empty", "timeout"]);
  assert.equal(changes[1].beforeValue, "");
  assert.equal(changes[1].beforeExists, true);
  assert.equal(changes[1].afterExists, false);
  assert.equal(compareConfigs(before, parseConfig("a: 1", "config")), null);
});
