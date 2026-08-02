import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { errorMessage } from "../src/lib/errors.ts";

describe("errorMessage", () => {
  it("extracts the user-facing message from a ConvexError", () => {
    const error = new ConvexError({ message: "Incorrect room password." });

    expect(errorMessage(error, "Could not join the room.")).toBe(
      "Incorrect room password.",
    );
  });

  it("prefers structured data over Convex diagnostic text", () => {
    const error = Object.assign(
      new Error(
        '[CONVEX M(rooms:joinRoom)] Server Error Uncaught ConvexError: {"message":"Incorrect room password."}',
      ),
      { data: { message: "Incorrect room password." } },
    );

    expect(errorMessage(error, "Could not join the room.")).toBe(
      "Incorrect room password.",
    );
  });

  it("preserves ordinary Error messages", () => {
    expect(errorMessage(new Error("Network unavailable."), "Try again.")).toBe(
      "Network unavailable.",
    );
  });

  it("uses the fallback for values without a useful message", () => {
    expect(errorMessage({ data: { message: 42 } }, "Try again.")).toBe("Try again.");
    expect(errorMessage(null, "Try again.")).toBe("Try again.");
  });
});
