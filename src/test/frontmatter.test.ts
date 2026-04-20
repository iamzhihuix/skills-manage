import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "@/lib/frontmatter";

describe("parseFrontmatter", () => {
  it("parses common summary fields and strips the fenced block from the body", () => {
    const parsed = parseFrontmatter(
      "---\nname: baoyu-comic\ndescription: Knowledge comic creator\nversion: 1.56.1\n---\n\n# Heading\n\nBody."
    );

    expect(parsed.frontmatterData.name).toBe("baoyu-comic");
    expect(parsed.frontmatterData.description).toBe("Knowledge comic creator");
    expect(parsed.frontmatterData.version).toBe("1.56.1");
    expect(parsed.body).toBe("# Heading\n\nBody.");
  });

  it("still strips malformed frontmatter from the markdown body", () => {
    const parsed = parseFrontmatter(
      "---\nname: broken-skill\nmetadata: [oops\n---\n\n# Broken Skill\n\nBody."
    );

    expect(parsed.frontmatterData.name).toBe("broken-skill");
    expect(parsed.frontmatterRaw).toContain("name: broken-skill");
    expect(parsed.body).toBe("# Broken Skill\n\nBody.");
  });

  it("extracts block-scalar descriptions when yaml parsing falls back", () => {
    const parsed = parseFrontmatter(
      "---\nname: autoglm-search-image\ndescription: >\n  使用 AutoGLM 搜图接口。\n  Token 通过本地服务自动获取。\ncompatibility:\n  requires:\n    - Python 3.x\n---\n\n# AutoGLM\n"
    );

    expect(parsed.frontmatterData.name).toBe("autoglm-search-image");
    expect(String(parsed.frontmatterData.description).trim()).toBe(
      "使用 AutoGLM 搜图接口。 Token 通过本地服务自动获取。"
    );
  });

  it("extracts quoted summary fields even when inner quotes break yaml", () => {
    const parsed = parseFrontmatter(
      '---\nname: andonq\ndescription_zh: "AndonQ 腾讯云智能客服"小龙虾"（工单查询、智能问答、云API调用）"\nversion: 1.1.9\n---\n\n# AndonQ\n'
    );

    expect(parsed.frontmatterData.name).toBe("andonq");
    expect(parsed.frontmatterData.description).toBe(
      'AndonQ 腾讯云智能客服"小龙虾"（工单查询、智能问答、云API调用）'
    );
    expect(parsed.frontmatterData.version).toBe("1.1.9");
  });
});
