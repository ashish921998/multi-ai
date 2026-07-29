/**
 * Browser-side screenshot downscaling. Large screenshots are resized in the
 * browser before upload (issue 0005) so we keep payloads small and within the
 * 5 MB limit. PNGs are re-encoded as JPEG when they exceed the size budget.
 */
import { computeScaledDimensions } from "./timeline.ts";

const MAX_DIM = 2000;

export interface ResizedImage {
  blob: Blob;
  width: number;
  height: number;
}

export async function resizeImage(file: File): Promise<ResizedImage> {
  const bitmap = await loadBitmap(file);
  const { width, height } = computeScaledDimensions(bitmap.width, bitmap.height, MAX_DIM);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D canvas context.");
  ctx.drawImage(bitmap, 0, 0, width, height);

  // Prefer the original format; fall back to JPEG if a PNG is too large.
  let mime = file.type === "image/png" ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg";
  let blob = await canvasToBlob(canvas, mime, 0.9);
  if (mime === "image/png" && blob && blob.size > 4.5 * 1024 * 1024) {
    mime = "image/jpeg";
    blob = await canvasToBlob(canvas, mime, 0.85);
  }
  if (!blob) throw new Error("Could not encode the screenshot.");
  return { blob, width, height };
}

function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file).catch(() => loadViaImage(file));
  }
  return loadViaImage(file);
}

function loadViaImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => reject(new Error("Could not decode the image."));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}
