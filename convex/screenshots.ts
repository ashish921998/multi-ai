/**
 * Screenshot upload and viewing (issue 0005).
 *
 * Convex file storage replaces the private Supabase Storage bucket. The flow is
 * the canonical Convex one: the client gets a short-lived upload URL (after
 * session validation), PUTs the bytes, receives a storage id, then calls
 * `register` to validate the limits and create the screenshot row. Viewing
 * happens through `getUrl`, which re-checks the session before minting a URL —
 * the only way to view a private screenshot.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { validateScreenshot } from "@multi-ai/shared";
import { fail } from "./lib/errors";
import { getParticipant } from "./lib/session";
import { lookupRoomByCode } from "./lib/room";

// ---------------------------------------------------------------------------
// generateUploadUrl — issued only after a valid session check.
// ---------------------------------------------------------------------------

export const generateUploadUrl = mutation({
  args: { roomId: v.string(), sessionToken: v.string() },
  handler: async (ctx, args): Promise<{ uploadUrl: string }> => {
    const room = await lookupRoomByCode(ctx.db, args.roomId);
    if (!room) fail("Room not found.");
    const me = await getParticipant(ctx.db, room._id, args.sessionToken);
    if (!me) fail("Invalid or expired session. Rejoin the room.");
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl };
  },
});

// ---------------------------------------------------------------------------
// register — validate the stored file and create the screenshot row.
// ---------------------------------------------------------------------------

export const register = mutation({
  args: {
    roomId: v.string(),
    sessionToken: v.string(),
    storageId: v.id("_storage"),
    mime: v.string(),
    width: v.float64(),
    height: v.float64(),
  },
  handler: async (ctx, args): Promise<{
    id: string;
    mime: string;
    width: number;
    height: number;
    bytes: number;
  }> => {
    const room = await lookupRoomByCode(ctx.db, args.roomId);
    if (!room) fail("Room not found.");
    const me = await getParticipant(ctx.db, room._id, args.sessionToken);
    if (!me) fail("Invalid or expired session. Rejoin the room.");

    // Authoritative size/type from the storage system table (no client trust).
    const file = await ctx.db.system.get(args.storageId);
    const bytes = typeof file?.size === "number" ? file.size : 0;
    const mime = file?.contentType ?? args.mime;
    const check = validateScreenshot({ mime, bytes });
    if (!check.ok) {
      if (file) await ctx.storage.delete(args.storageId);
      fail(check.error ?? "Invalid screenshot.");
    }

    const id = await ctx.db.insert("screenshots", {
      roomId: room._id,
      storageId: args.storageId,
      mime,
      width: args.width || 0,
      height: args.height || 0,
      bytes,
      createdAt: Date.now(),
    });

    return { id, mime, width: args.width || 0, height: args.height || 0, bytes };
  },
});

// ---------------------------------------------------------------------------
// getUrl — the only way to view a private screenshot.
// ---------------------------------------------------------------------------

export const getUrl = query({
  args: {
    roomId: v.string(),
    sessionToken: v.string(),
    screenshotId: v.id("screenshots"),
  },
  handler: async (ctx, args): Promise<{ url: string | null; expiresIn: number }> => {
    const room = await lookupRoomByCode(ctx.db, args.roomId);
    if (!room) return { url: null, expiresIn: 0 };
    const me = await getParticipant(ctx.db, room._id, args.sessionToken);
    if (!me) return { url: null, expiresIn: 0 };

    const shot = await ctx.db.get(args.screenshotId);
    if (!shot || shot.roomId !== room._id) return { url: null, expiresIn: 0 };

    const url = await ctx.storage.getUrl(shot.storageId);
    return { url, expiresIn: 60 };
  },
});
