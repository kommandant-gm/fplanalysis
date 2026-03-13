import { useEffect, useRef } from 'react';

// Draws a simplified football pitch + touch-density heatmap on a canvas.
// touches: [{x, y}]  where x/y are 0–100 (FotMob normalised coordinates)
export default function Heatmap({ touches = [], width = 420, height = 280 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, width, height);
    drawPitch(ctx, width, height);

    if (touches.length > 0) {
      drawHeat(ctx, touches, width, height);
    }
  }, [touches, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="rounded-lg w-full"
      style={{ background: '#1a6b3c' }}
    />
  );
}

// ── Pitch drawing ────────────────────────────────────────────────────────────

function drawPitch(ctx, w, h) {
  const PAD = 16;

  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth   = 1.5;

  // Outer boundary
  ctx.strokeRect(PAD, PAD, w - PAD * 2, h - PAD * 2);

  // Centre line
  ctx.beginPath();
  ctx.moveTo(w / 2, PAD);
  ctx.lineTo(w / 2, h - PAD);
  ctx.stroke();

  // Centre circle
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, h * 0.14, 0, Math.PI * 2);
  ctx.stroke();

  // Centre dot
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 2.5, 0, Math.PI * 2);
  ctx.fill();

  const bw = (w - PAD * 2) * 0.16;  // box width (half)
  const bh = (h - PAD * 2) * 0.42;  // box height
  const by = (h - bh) / 2;

  // Left penalty box
  ctx.strokeRect(PAD, by, bw, bh);
  // Right penalty box
  ctx.strokeRect(w - PAD - bw, by, bw, bh);

  // Left goal
  const gh = bh * 0.38;
  ctx.strokeRect(PAD, (h - gh) / 2, bw * 0.35, gh);
  // Right goal
  ctx.strokeRect(w - PAD - bw * 0.35, (h - gh) / 2, bw * 0.35, gh);
}

// ── Heatmap drawing ──────────────────────────────────────────────────────────

function drawHeat(ctx, touches, w, h) {
  const PAD = 16;
  const pw  = w - PAD * 2;   // pitch width in px
  const ph  = h - PAD * 2;   // pitch height in px

  // Offscreen canvas for the heat layer so we can apply composite blending
  const off = document.createElement('canvas');
  off.width  = w;
  off.height = h;
  const oc = off.getContext('2d');

  const radius = Math.min(pw, ph) * 0.075;

  for (const { x, y } of touches) {
    // FotMob x=0 is left attacking direction; y=0 is top
    const px = PAD + (x / 100) * pw;
    const py = PAD + (y / 100) * ph;

    const grad = oc.createRadialGradient(px, py, 0, px, py, radius);
    grad.addColorStop(0,   'rgba(255, 50,  0, 0.25)');
    grad.addColorStop(0.4, 'rgba(255,180,  0, 0.12)');
    grad.addColorStop(1,   'rgba(0,   0,   0, 0)');

    oc.fillStyle = grad;
    oc.beginPath();
    oc.arc(px, py, radius, 0, Math.PI * 2);
    oc.fill();
  }

  ctx.drawImage(off, 0, 0);
}
