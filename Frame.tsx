import React, { useEffect, useState } from "react";
import QRCode from "qrcode";

let offline = false;
const subs = new Set<() => void>();

export function toggleOfflineMode() {
  offline = !offline;
  subs.forEach((s) => s());
}

export function isOfflineMode(): boolean {
  return offline;
}

function useOfflineMode(): boolean {
  const [, setN] = useState(0);
  useEffect(() => {
    const sub = () => setN((n) => n + 1);
    subs.add(sub);
    return () => {
      subs.delete(sub);
    };
  }, []);
  return offline;
}

type Props = {
  src: string;
  fallback?: string;
};

function SadComputer() {
  return <div className="frame-fallback frame-fallback-default">offline</div>;
}

const ZOOM_STEP = 1.2;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

export function Frame({ src, fallback }: Props) {
  const offlineMode = useOfflineMode();
  const [zoom, setZoom] = useState(1);
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(src, { margin: 1, width: 160 }).then(
      (url) => {
        if (!cancelled) setQrDataUrl(url);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [src]);
  const showFallback = offlineMode;
  const fallbackUrl = fallback
    ? /^(?:[a-z][a-z0-9+.-]*:|\/|data:)/i.test(fallback)
      ? fallback
      : `/talks-static/${fallback}`
    : undefined;

  // The slide article is scaled up by --slide-scale to fill the viewport, so
  // an iframe at the slide's natural CSS size renders its content tiny then
  // gets visually blown up. Counteract by sizing the iframe larger and
  // scaling it back down. Multiply by user zoom for A+/A- adjustments.
  const style = {
    "--frame-zoom": String(zoom),
  } as React.CSSProperties;

  return (
    <div className="frame" style={style}>
      <div className="frame-bar-row">
        <a
          className="frame-bar"
          href={src}
          target="_blank"
          rel="noreferrer noopener"
          title={src}
        >
          {src}
        </a>
        {qrDataUrl ? (
          <img
            className="frame-qr"
            src={qrDataUrl}
            alt={`QR code for ${src}`}
            title={src}
          />
        ) : null}
        <div className="frame-bar-buttons">
          <button
            type="button"
            onClick={() =>
              setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP))
            }
            title="Zoom in"
            aria-label="Zoom in"
          >
            A+
          </button>
          <button
            type="button"
            onClick={() =>
              setZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP))
            }
            title="Zoom out"
            aria-label="Zoom out"
          >
            A−
          </button>
        </div>
      </div>
      <div className="frame-content">
        {showFallback ? (
          fallbackUrl ? (
            <img className="frame-fallback" src={fallbackUrl} alt="" />
          ) : (
            <SadComputer />
          )
        ) : (
          <iframe
            className="frame-iframe"
            src={src}
            sandbox=""
            referrerPolicy="no-referrer"
          />
        )}
      </div>
    </div>
  );
}
