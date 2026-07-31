import { useQuery } from "convex/react";
import { api } from "../../../../convex/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * Renders a private screenshot by resolving its viewable URL through the
 * session-gated Convex query. The URL is the only way to view a screenshot
 * object (issue 0005); it is re-resolved reactively.
 */
export function ScreenshotImg(props: {
  roomId: string;
  sessionToken: string;
  screenshotId: string;
}) {
  const result = useQuery(api.screenshots.getUrl, {
    roomId: props.roomId,
    sessionToken: props.sessionToken,
    screenshotId: props.screenshotId as Id<"screenshots">,
  });
  const url = result?.url ?? null;
  if (!url) return <div className="shot" style={{ height: 90, background: "var(--panel-2)" }} />;
  return <img className="shot" src={url} alt="Shared screenshot" />;
}
