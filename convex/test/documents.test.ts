/**
 * Unit tests for the document path validator (`validatePath`) and format
 * inference (`inferFormat`). These are the pure rules that keep a workspace
 * tree well-formed — they must hold regardless of who is writing (human or
 * agent). The mutation-level round-trip (create → update OCC → restore) is
 * covered by the live end-to-end connector test, not here, since it needs a
 * backend.
 */

import { describe, it, expect } from "vitest";
import { validatePath, inferFormat } from "../lib/documents";

describe("validatePath", () => {
  describe("accepts well-formed document paths", () => {
    const cases = [
      "plan.md",
      "README.MD",
      "specs/api.md",
      "decisions/0001-auth.md",
      "a/b/c/d/deep.html",
      "wireframes/onboarding.htm",
      "notes/retro.markdown",
      "UPPER-CASE.Html",
      "with space.md",
      "ünïcödé.md",
    ];
    for (const path of cases) {
      it(`accepts "${path}"`, () => {
        expect(validatePath(path).ok).toBe(true);
      });
    }
  });

  describe("infers format from suffix", () => {
    it(".md / .markdown → markdown", () => {
      expect(validatePath("x.md")).toEqual({ ok: true, format: "markdown" });
      expect(validatePath("x.markdown")).toEqual({ ok: true, format: "markdown" });
      expect(inferFormat("X.MARKDOWN")).toBe("markdown");
    });
    it(".html / .htm → html", () => {
      expect(validatePath("x.html")).toEqual({ ok: true, format: "html" });
      expect(validatePath("x.htm")).toEqual({ ok: true, format: "html" });
    });
    it("unknown suffix → null", () => {
      expect(inferFormat("x.txt")).toBeNull();
      expect(inferFormat("x")).toBeNull();
    });
  });

  describe("rejects malformed paths", () => {
    const cases: Array<[string, RegExp]> = [
      ["", /required/i],
      ["plan.md/", /start or end/i],
      ["/plan.md", /start or end/i],
      ["a//b.md", /\/\//],
      [".", /segments/i],
      ["..", /segments/i],
      ["a/../b.md", /segments/i],
      ["a/./b.md", /segments/i],
      [".git/config.md", /\.git/],
      ["a/.git/b.md", /\.git/],
      ["refs", /reserved/],
      ["refs/anything.md", /reserved/],
      ["plan.txt", /\.md, \.markdown/],
      ["noext", /\.md, \.markdown/],
      ["a?b.md", /cannot contain/],
      ["a#b.md", /cannot contain/],
      ["a%b.md", /cannot contain/],
      ["a\\b.md", /cannot contain/],
    ];
    for (const [path, pattern] of cases) {
      it(`rejects ${JSON.stringify(path)}`, () => {
        const result = validatePath(path);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(pattern);
      });
    }

    it("rejects control characters", () => {
      expect(validatePath("a\x00b.md").ok).toBe(false);
    });

    it("rejects paths over 512 characters", () => {
      const result = validatePath("a".repeat(600) + ".md");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/too long/i);
    });
  });
});
