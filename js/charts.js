/* ============================================================
   charts.js — small hand-rolled SVG chart primitives.
   No charting library: everything here is plain SVG string
   templates, kept intentionally simple and soft-edged.
   ============================================================ */

function ringChartSVG({ percent, size = 120, stroke = 11, color = 'var(--accent)', label = '', sublabel = '' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = clamp(percent, 0, 100);
  const offset = c - (pct / 100) * c;
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="ring-chart">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"
        transform="rotate(-90 ${size / 2} ${size / 2})" class="ring-progress"/>
      ${label ? `<text x="50%" y="48%" text-anchor="middle" class="ring-label">${escapeHtml(label)}</text>` : ''}
      ${sublabel ? `<text x="50%" y="64%" text-anchor="middle" class="ring-sublabel">${escapeHtml(sublabel)}</text>` : ''}
    </svg>`;
}

/** data: [{label, value}]  */
function barChartSVG(data, { height = 160, color = 'var(--accent)', formatValue } = {}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const barWidth = 100 / data.length;
  const bars = data.map((d, i) => {
    const h = max ? (d.value / max) * (height - 34) : 0;
    const x = i * barWidth;
    return `
      <g class="bar-col" style="animation-delay:${i * 35}ms">
        <rect x="${x + barWidth * 0.18}%" y="${height - 24 - h}" width="${barWidth * 0.64}%" height="${h}" rx="5" fill="${color}"/>
        <text x="${x + barWidth * 0.5}%" y="${height - 6}" text-anchor="middle" class="bar-axis-label">${d.label}</text>
        ${d.value ? `<text x="${x + barWidth * 0.5}%" y="${height - 30 - h}" text-anchor="middle" class="bar-value-label">${formatValue ? formatValue(d.value) : d.value}</text>` : ''}
      </g>`;
  }).join('');
  return `<svg viewBox="0 0 100 ${height}" preserveAspectRatio="none" class="bar-chart" style="width:100%;height:${height}px;">${bars}</svg>`;
}

/** data: [{label, value, color}] */
function donutChartSVG(data, { size = 160, stroke = 26 } = {}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offsetAcc = 0;
  const segments = data.map((d) => {
    const frac = d.value / total;
    const dash = frac * c;
    const seg = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${d.color}" stroke-width="${stroke}"
      stroke-dasharray="${dash} ${c - dash}" stroke-dashoffset="${-offsetAcc}"
      transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
    offsetAcc += dash;
    return seg;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${segments}</svg>`;
}

function coverCollageHTML(items, { max = 24 } = {}) {
  const shown = items.slice(0, max);
  return `<div class="cover-collage">${shown.map((it) => `
    <div class="collage-tile" title="${escapeHtml(it.title || '')}">${it.coverHtml}</div>
  `).join('')}</div>`;
}
