import { useEffect, useState } from "react";

/**
 * Lazily fetches a short-lived signed URL for a private screenshot, then renders
 * it. The signed URL is the only way to view a screenshot object (issue 0005);
 * it expires after a minute, so we re-fetch on mount rather than caching.
 */
export function ScreenshotImg(props: {
  screenshotId: string;
  mime: string;
  signedUrlFor: (id: string) => Promise<string | null>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void props.signedUrlFor(props.screenshotId).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [props.screenshotId, props.signedUrlFor]);
  if (!url) return <div className="shot" style={{ height: 90, background: "var(--panel-2)" }} />;
  return <img className="shot" src={url} alt="Shared screenshot" />;
}
