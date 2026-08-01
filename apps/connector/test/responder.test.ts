import { describe, it, expect } from "vitest";
import { customHarness } from "../src/harnesses.ts";
import { HarnessResponder, composePrompt } from "../src/responder.ts";

// A 1×1 transparent PNG as a data URL — lets us test image download without a
// network round-trip or a storage bucket.
const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("HarnessResponder", () => {
  it("pipes the envelope body to a custom harness", async () => {
    const responder = new HarnessResponder(customHarness("cat"));
    const ac = new AbortController();
    const out: string[] = [];

    for await (const chunk of responder.stream(
      { pending: true, handoffId: "h1", body: "# Plan\n\nDiscuss the API.", includedSeqs: [1] },
      ac.signal,
    )) {
      out.push(chunk);
    }

    expect(out.join("")).toContain("# Plan");
    expect(out.join("")).toContain("Discuss the API.");
  });

  it("downloads screenshots and appends their local file paths to the prompt", async () => {
    const responder = new HarnessResponder(customHarness("cat"));
    const ac = new AbortController();
    const out: string[] = [];

    for await (const chunk of responder.stream(
      {
        pending: true,
        handoffId: "h1",
        body: "# Plan\n\nSee the screenshot.",
        includedSeqs: [1],
        hasVisionContent: true,
        screenshots: [
          { messageId: "m1", mime: "image/png", width: 1, height: 1, signedUrl: ONE_PIXEL_PNG },
        ],
      },
      ac.signal,
    )) {
      out.push(chunk);
    }

    const text = out.join("");
    // Body is preserved.
    expect(text).toContain("# Plan");
    // The attachment manifest is present and points at a real .png file.
    expect(text).toContain("--- Attachments");
    expect(text).toMatch(/image-0\.png/);
    expect(text).toContain("image/png");
  });

  it("reports a non-zero harness exit", async () => {
    const responder = new HarnessResponder(
      customHarness(process.execPath, ["-e", "process.exit(7)"]),
    );
    const read = async () => {
      for await (const _chunk of responder.stream(
        { pending: true, handoffId: "h1", body: "hello" },
        new AbortController().signal,
      )) {
        // consume the stream
      }
    };

    await expect(read()).rejects.toThrow(`${process.execPath} exited with code 7`);
  });
});

describe("composePrompt", () => {
  it("returns the body unchanged when there are no attachments", () => {
    expect(composePrompt("hello", { files: [] })).toBe("hello");
  });

  it("includes the exact workspace version and asks for a complete updated document", () => {
    const stdin = composePrompt("new discussion", { files: [] }, {
      id: "doc-1",
      path: "plan.md",
      body: "# Existing plan\n\nKeep this.",
      version: 7,
    });
    expect(stdin).toContain("Current plan.md (v7)");
    expect(stdin).toContain("# Existing plan");
    expect(stdin).toContain("Return ONLY the complete Markdown contents");
  });

  it("tells the agent when plan.md needs to be created", () => {
    const stdin = composePrompt("new discussion", { files: [] }, null);
    expect(stdin).toContain("No plan.md exists yet");
  });

  it("lists each attachment path, mime, and dimensions", () => {
    const stdin = composePrompt("body", {
      files: [{ path: "/tmp/a.png", mime: "image/png", width: 2, height: 3 }],
    });
    expect(stdin.startsWith("body")).toBe(true);
    expect(stdin).toContain("/tmp/a.png");
    expect(stdin).toContain("image/png");
    expect(stdin).toContain("2x3");
  });
});
