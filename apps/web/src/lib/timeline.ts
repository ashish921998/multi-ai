/**
 * Pure helpers for the room UI that are easy to unit-test: computing the
 * dimensions a screenshot should be downscaled to before upload, and merging a
 * freshly fetched slice of messages into the local timeline on reconnect.
 */

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Returns the dimensions to use when a screenshot is larger than `maxDim` on its
 * longest side. Images that already fit are returned unchanged so we never
 * upscale. The aspect ratio is always preserved and dimensions are integers.
 */
export function computeScaledDimensions(
  width: number,
  height: number,
  maxDim: number,
): Dimensions {
  if (width <= 0 || height <= 0) return { width, height };
  const longest = Math.max(width, height);
  if (longest <= maxDim) return { width, height };
  const scale = maxDim / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface TimelineMessage {
  seq: number;
  [key: string]: unknown;
}

export interface MergeResult<T extends TimelineMessage> {
  messages: T[];
  lastSeq: number;
}

/**
 * Merges an incoming slice of messages into the existing timeline, deduplicating
 * by sequence number and keeping the result sorted ascending. This is the
 * reconnect primitive: the browser asks for everything after its last known seq
 * and folds it into what it already has (issue 0004).
 */
export function mergeMessages<T extends TimelineMessage>(
  existing: readonly T[],
  incoming: readonly T[],
  lastSeq: number,
): MergeResult<T> {
  const bySeq = new Map<number, T>();
  for (const m of existing) bySeq.set(m.seq, m);
  for (const m of incoming) bySeq.set(m.seq, m);
  const messages = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  const maxSeq = messages.length > 0 ? messages[messages.length - 1]!.seq : lastSeq;
  return { messages, lastSeq: Math.max(lastSeq, maxSeq) };
}
