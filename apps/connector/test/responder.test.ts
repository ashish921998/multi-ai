import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { customHarness, getHarness } from "../src/harnesses.ts";
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

  it.each(["pi", "cursor", "opencode"])(
    "pipes the prompt to the %s harness through stdin",
    async (name) => {
      const harness = getHarness(name);
      const responder = new HarnessResponder({
        ...harness,
        executable: process.execPath,
        args: ["-e", "process.stdin.pipe(process.stdout)", "--", ...harness.args],
      });
      const chunks: string[] = [];

      for await (const chunk of responder.stream(
        { pending: true, handoffId: "h1", body: `prompt for ${name}` },
        new AbortController().signal,
      )) {
        chunks.push(chunk);
      }

      expect(chunks.join("")).toBe(
        composePrompt(`prompt for ${name}`, { files: [] }, null),
      );
    },
  );

  it("pipes prompts larger than the process argument limit through stdin", async () => {
    const body = "x".repeat(1_100_000);
    const responder = new HarnessResponder(customHarness("cat"));
    const chunks: string[] = [];

    for await (const chunk of responder.stream(
      { pending: true, handoffId: "h1", body },
      new AbortController().signal,
    )) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe(composePrompt(body, { files: [] }, null));
  });

  it("accepts a successful harness that exits without reading a large prompt", async () => {
    const responder = new HarnessResponder(
      customHarness(process.execPath, ["-e", 'process.stdout.end("done")']),
    );
    const chunks: string[] = [];

    for await (const chunk of responder.stream(
      { pending: true, handoffId: "h1", body: "x".repeat(1_100_000) },
      new AbortController().signal,
    )) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("done");
  });

  it("does not launch a harness when the signal is already aborted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "room-responder-test-"));
    const marker = join(dir, "spawned");
    const responder = new HarnessResponder(
      customHarness(process.execPath, [
        "-e",
        `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "spawned")`,
      ]),
    );
    const controller = new AbortController();
    controller.abort();

    const read = async () => {
      for await (const _chunk of responder.stream(
        { pending: true, handoffId: "h1", body: "hello" },
        controller.signal,
      )) {
        // consume the stream
      }
    };

    try {
      await expect(read()).rejects.toThrow(`${process.execPath} was stopped`);
      await expect(access(marker)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

  it("does not invent a response chunk when the harness is silent", async () => {
    const responder = new HarnessResponder(
      customHarness(process.execPath, ["-e", "process.exit(0)"]),
    );
    const chunks: string[] = [];
    for await (const chunk of responder.stream(
      { pending: true, handoffId: "h1", body: "hello" },
      new AbortController().signal,
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([]);
  });

  it("stops an in-flight harness instead of completing a partial response", async () => {
    const responder = new HarnessResponder(
      customHarness(process.execPath, [
        "-e",
        'process.stdout.write("started"); setInterval(() => {}, 1_000)',
      ]),
    );
    const controller = new AbortController();
    const stream = responder.stream(
      { pending: true, handoffId: "h1", body: "hello" },
      controller.signal,
    )[Symbol.asyncIterator]();

    await expect(stream.next()).resolves.toMatchObject({ value: "started", done: false });
    controller.abort();
    const finish = async () => {
      while (!(await stream.next()).done) {
        // consume decoder flush chunks until the process closes
      }
    };
    await expect(finish()).rejects.toThrow(`${process.execPath} was stopped`);
  });

  it.skipIf(process.platform === "win32")(
    "stops descendant processes when a harness is aborted",
    async () => {
      const script = [
        'const { spawn } = require("node:child_process");',
        `const descendant = spawn(${JSON.stringify(process.execPath)}, ["-e", "setInterval(() => {}, 1_000)"], { stdio: "ignore" });`,
        "process.stdout.write(String(descendant.pid));",
        "setInterval(() => {}, 1_000);",
      ].join(" ");
      const responder = new HarnessResponder(customHarness(process.execPath, ["-e", script]));
      const controller = new AbortController();
      const stream = responder.stream(
        { pending: true, handoffId: "h1", body: "hello" },
        controller.signal,
      )[Symbol.asyncIterator]();

      const first = await stream.next();
      const descendantPid = Number(first.value);
      expect(descendantPid).toBeGreaterThan(0);
      controller.abort();
      const finish = async () => {
        while (!(await stream.next()).done) {
          // consume until process-tree shutdown closes stdout
        }
      };
      await expect(finish()).rejects.toThrow(`${process.execPath} was stopped`);

      let descendantAlive = true;
      for (let attempt = 0; attempt < 20 && descendantAlive; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        try {
          process.kill(descendantPid, 0);
        } catch {
          descendantAlive = false;
        }
      }
      expect(descendantAlive).toBe(false);
    },
  );

  it(
    "finishes when a descendant holds the exited harness's stdout open",
    async () => {
      const script = [
        'const { spawn } = require("node:child_process");',
        `const descendant = spawn(${JSON.stringify(process.execPath)}, ["-e", "setInterval(() => {}, 1_000)"], { stdio: ["ignore", "inherit", "ignore"] });`,
        "descendant.unref();",
        'process.stdout.write("done");',
      ].join(" ");
      const responder = new HarnessResponder(customHarness(process.execPath, ["-e", script]));
      const chunks: string[] = [];

      for await (const chunk of responder.stream(
        { pending: true, handoffId: "h1", body: "hello" },
        new AbortController().signal,
      )) {
        chunks.push(chunk);
      }

      expect(chunks.join("")).toBe("done");
    },
  );

  it.skipIf(process.platform === "win32")(
    "does not wait indefinitely for stdout held by a detached descendant",
    async () => {
      const script = [
        'const { spawn } = require("node:child_process");',
        `const descendant = spawn(${JSON.stringify(process.execPath)}, ["-e", "setTimeout(() => {}, 5_000)"], { detached: true, stdio: ["ignore", "inherit", "ignore"] });`,
        "descendant.unref();",
        'process.stdout.write("done");',
      ].join(" ");
      const responder = new HarnessResponder(customHarness(process.execPath, ["-e", script]));
      const startedAt = Date.now();
      const chunks: string[] = [];

      for await (const chunk of responder.stream(
        { pending: true, handoffId: "h1", body: "hello" },
        new AbortController().signal,
      )) {
        chunks.push(chunk);
      }

      expect(chunks.join("")).toBe("done");
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    },
  );

  it.skipIf(process.platform === "win32")(
    "cleans up descendants after a harness exits normally",
    async () => {
      const script = [
        'const { spawn } = require("node:child_process");',
        `const descendant = spawn(${JSON.stringify(process.execPath)}, ["-e", "setInterval(() => {}, 1_000)"], { stdio: "ignore" });`,
        "descendant.unref();",
        "process.stdout.write(String(descendant.pid));",
      ].join(" ");
      const responder = new HarnessResponder(customHarness(process.execPath, ["-e", script]));
      const chunks: string[] = [];

      for await (const chunk of responder.stream(
        { pending: true, handoffId: "h1", body: "hello" },
        new AbortController().signal,
      )) {
        chunks.push(chunk);
      }

      const descendantPid = Number(chunks.join(""));
      expect(descendantPid).toBeGreaterThan(0);
      let descendantAlive = true;
      for (let attempt = 0; attempt < 20 && descendantAlive; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        try {
          process.kill(descendantPid, 0);
        } catch {
          descendantAlive = false;
        }
      }
      expect(descendantAlive).toBe(false);
    },
  );

  it("reports a missing harness executable", async () => {
    const responder = new HarnessResponder(customHarness("missing-room-agent-command"));
    const read = async () => {
      for await (const _chunk of responder.stream(
        { pending: true, handoffId: "h1", body: "hello" },
        new AbortController().signal,
      )) {
        // consume the stream
      }
    };

    await expect(read()).rejects.toThrow("ENOENT");
  });

  it.skipIf(process.platform === "win32")(
    "reports when a harness is terminated by an external signal",
    async () => {
      const responder = new HarnessResponder(
        customHarness(process.execPath, ["-e", 'process.kill(process.pid, "SIGTERM")']),
      );
      const read = async () => {
        for await (const _chunk of responder.stream(
          { pending: true, handoffId: "h1", body: "hello" },
          new AbortController().signal,
        )) {
          // consume the stream
        }
      };

      await expect(read()).rejects.toThrow("terminated by signal SIGTERM");
    },
  );

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
