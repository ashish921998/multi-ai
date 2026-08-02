function hasUserFacingMessage(
  error: unknown,
): error is { data: { message: string } } {
  if (typeof error !== "object" || error === null || !("data" in error)) {
    return false;
  }

  const data = error.data;
  return (
    typeof data === "object" &&
    data !== null &&
    "message" in data &&
    typeof data.message === "string" &&
    data.message.trim().length > 0
  );
}

/** Extracts structured messages from ConvexError before generic Error text. */
export function errorMessage(error: unknown, fallback: string): string {
  if (hasUserFacingMessage(error)) return error.data.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
