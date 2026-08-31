import assert from "node:assert/strict";
import test from "node:test";
import {
  compileEnvironmentGlob,
  parsePromptFragment,
  replaceSinglePromptElement
} from "../server/src/promptFragmentXml";

test("解析带属性和嵌套元素的完整片段", () => {
  const source = `\n<professional_knowledge desc="专业领域知识">\nsomething <b>important</b>\n</professional_knowledge>\n`;
  assert.deepEqual(parsePromptFragment(source), {
    tagName: "professional_knowledge",
    content: source.trim()
  });
});

test("整体替换元素并保留目标前后文本", () => {
  const replacement = `<role kind="new">\nnew role\n</role>`;
  const result = replaceSinglePromptElement(
    `before\n<role kind="old">old role</role>\nafter`,
    "role",
    replacement
  );
  assert.equal(result.status, "changed");
  assert.equal(result.content, `before\n${replacement}\nafter`);
});

test("替换时继承目标 XML 标签的行缩进", () => {
  const result = replaceSinglePromptElement(
    `system:\n  <role>\n    old role\n  </role>\nend`,
    "role",
    `<role>\n  new role\n</role>`
  );
  assert.equal(result.content, `system:\n  <role>\n    new role\n  </role>\nend`);
});

test("同名标签出现多次或嵌套时阻止替换", () => {
  assert.throws(
    () => replaceSinglePromptElement(`<role>a</role><role>b</role>`, "role", `<role>x</role>`),
    /出现 2 次/
  );
  assert.throws(
    () => replaceSinglePromptElement(`<role><role>x</role></role>`, "role", `<role>x</role>`),
    /同名嵌套/
  );
});

test("标签缺失与不完整使用不同结果", () => {
  assert.equal(
    replaceSinglePromptElement("ordinary prompt", "role", `<role>x</role>`).status,
    "missing"
  );
  assert.throws(
    () => replaceSinglePromptElement(`<role>unfinished`, "role", `<role>x</role>`),
    /缺少结束标签/
  );
});

test("普通的小于号文本不会被误认为 XML 标签", () => {
  const result = replaceSinglePromptElement(
    `when a < b\n<role>old</role>`,
    "role",
    `<role>new</role>`
  );
  assert.equal(result.content, `when a < b\n<role>new</role>`);
});

test("路径 glob 区分单层和任意层级", () => {
  const direct = compileEnvironmentGlob("/tob-uat/*_prompt_cn");
  assert.equal(direct.test("tob-uat/customer_prompt_cn"), true);
  assert.equal(direct.test("tob-uat/sub/customer_prompt_cn"), false);

  const recursive = compileEnvironmentGlob("/tob-uat/**/*_prompt_cn");
  assert.equal(recursive.test("tob-uat/customer_prompt_cn"), true);
  assert.equal(recursive.test("tob-uat/sub/customer_prompt_cn"), true);
  assert.throws(() => compileEnvironmentGlob("../*_prompt_cn"), /不能包含/);
});
