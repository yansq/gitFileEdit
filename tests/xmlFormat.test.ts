import assert from "node:assert/strict";
import test from "node:test";
import { formatXml } from "../client/src/lib/format";

test("按 XML 层级格式化混合文本和嵌套标签", () => {
  assert.equal(
    formatXml(`<test>\ndfsddsgdgfdfg\n<sdfs>\nsfsgdfgfd\n</sdfs>\nsdfjlsjgsg\n</test>`),
    `<test>\n  dfsddsgdgfdfg\n  <sdfs>\n    sfsgdfgfd\n  </sdfs>\n  sdfjlsjgsg\n</test>`
  );
});
