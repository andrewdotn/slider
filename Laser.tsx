import React, { useEffect, useRef, useState } from "react";

const DOT_SIZE = 18;
const TRAIL_MS = 450;
const TRAIL_SAMPLE_MS = 12;

interface Point {
  x: number;
  y: number;
  t: number;
}

const lastPos: { current: Point | null } = { current: null };
if (typeof window !== "undefined") {
  window.addEventListener("mousemove", (e) => {
    lastPos.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
}

export function Laser({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trailRef = useRef<Point[]>([]);
  const rafRef = useRef<number | null>(null);
  const sampleRef = useRef<number | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active) {
      trailRef.current = [];
      return;
    }
    const prev = document.body.style.cursor;
    document.body.style.cursor = "none";
    return () => {
      document.body.style.cursor = prev;
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    // Trigger an initial render so the dot appears immediately at the last
    // known mouse position, even before any further mouse movement.
    setTick((n) => n + 1);
    sampleRef.current = window.setInterval(() => {
      const p = lastPos.current;
      if (!p) return;
      const trail = trailRef.current;
      const last = trail[trail.length - 1];
      if (!last || last.x !== p.x || last.y !== p.y) {
        trail.push({ x: p.x, y: p.y, t: performance.now() });
      }
    }, TRAIL_SAMPLE_MS);
    return () => {
      if (sampleRef.current != null) clearInterval(sampleRef.current);
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const now = performance.now();
      const trail = trailRef.current;

      // Drop fully-decayed points.
      while (trail.length > 0 && now - trail[0].t > TRAIL_MS) trail.shift();

      // Smooth curved trail using quadratic Beziers through segment midpoints,
      // drawn as many short sub-segments so width and opacity can decay along
      // the curve. Width and alpha are driven by the time-age of each sample
      // so the trail fades out even when the mouse is stationary.
      if (trail.length >= 2) {
        const sub = 6; // sub-segments per pair of points
        // Butt caps so the per-sub-segment endpoints don't render as a chain
        // of stacked circles along the trail.
        ctx.lineCap = "butt";
        ctx.lineJoin = "round";
        for (let i = 0; i < trail.length - 1; i++) {
          const p0 = i > 0 ? trail[i - 1] : trail[i];
          const p1 = trail[i];
          const p2 = trail[i + 1];
          const p3 = i + 2 < trail.length ? trail[i + 2] : trail[i + 1];
          // Catmull-Rom -> cubic Bezier control points
          const c1x = p1.x + (p2.x - p0.x) / 6;
          const c1y = p1.y + (p2.y - p0.y) / 6;
          const c2x = p2.x - (p3.x - p1.x) / 6;
          const c2y = p2.y - (p3.y - p1.y) / 6;

          let prevX = p1.x;
          let prevY = p1.y;
          for (let s = 1; s <= sub; s++) {
            const u = s / sub;
            const mu = 1 - u;
            const x =
              mu * mu * mu * p1.x +
              3 * mu * mu * u * c1x +
              3 * mu * u * u * c2x +
              u * u * u * p2.x;
            const y =
              mu * mu * mu * p1.y +
              3 * mu * mu * u * c1y +
              3 * mu * u * u * c2y +
              u * u * u * p2.y;
            // Time-age at this sub-sample, interpolated between p1 and p2.
            const age = now - (p1.t + (p2.t - p1.t) * u);
            const life = Math.max(0, 1 - age / TRAIL_MS);
            const w = DOT_SIZE * (0.15 + 0.7 * life);
            const a = 0.55 * life * life;
            if (a > 0) {
              ctx.strokeStyle = `rgba(220, 0, 0, ${a})`;
              ctx.lineWidth = w;
              ctx.beginPath();
              ctx.moveTo(prevX, prevY);
              ctx.lineTo(x, y);
              ctx.stroke();
            }
            prevX = x;
            prevY = y;
          }
        }
      }

      // Head dot stays fully visible while laser mode is on — only the trail
      // behind it fades.
      const head = lastPos.current;
      if (head) {
        const grad = ctx.createRadialGradient(
          head.x,
          head.y,
          0,
          head.x,
          head.y,
          DOT_SIZE / 2,
        );
        grad.addColorStop(0, "rgba(255, 40, 40, 0.85)");
        grad.addColorStop(0.7, "rgba(230, 0, 0, 0.7)");
        grad.addColorStop(1, "rgba(230, 0, 0, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(head.x, head.y, DOT_SIZE / 2, 0, Math.PI * 2);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [active]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      data-testid="laser-overlay"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 99999,
      }}
    />
  );
}
