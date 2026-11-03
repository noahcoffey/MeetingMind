export function drawWaveform(canvas: HTMLCanvasElement, history: number[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width;
  const h = canvas.height;
  const barWidth = 2 * dpr;
  const gap = 1 * dpr;
  const step = barWidth + gap;
  const centerY = h / 2;

  ctx.clearRect(0, 0, w, h);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#ef4444');
  grad.addColorStop(0.15, '#f472b6');
  grad.addColorStop(0.3, '#a855f7');
  grad.addColorStop(0.45, '#6366f1');
  grad.addColorStop(0.5, '#10b981');
  grad.addColorStop(0.55, '#6366f1');
  grad.addColorStop(0.7, '#a855f7');
  grad.addColorStop(0.85, '#f472b6');
  grad.addColorStop(1, '#ef4444');

  const startX = w - history.length * step;
  for (let i = 0; i < history.length; i++) {
    const level = history[i];
    const barH = Math.max(2 * dpr, level * (h - 4));
    const x = startX + i * step;
    if (x + barWidth < 0) continue;

    const halfBar = barH / 2;

    if (level > 0.05) {
      ctx.globalAlpha = 0.4 + level * 0.6;
      ctx.fillStyle = grad;
    } else {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--waveform-idle').trim() || '#334155';
    }

    ctx.fillRect(x, centerY - halfBar, barWidth, barH);
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--waveform-center').trim() || 'rgba(148, 163, 184, 0.08)';
  ctx.fillRect(0, centerY, w, 1);
}
