/**
 * Pure helpers for the room UI that are easy to unit-test: computing the
 * dimensions a screenshot should be downscaled to before upload.
 *
 * (Timeline merging used to live here for the old fetch-on-tick reconnect path;
 * the reactive Convex rewrite made it unnecessary, so it was removed.)
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
