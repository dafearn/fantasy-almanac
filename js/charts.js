// Small dependency-free SVG charts with hover tooltips.
// Many-series charts use "highlight one": every manager is a thin gray line and the
// selected ones take the categorical colors, so 12 teams never need 12 hues.
import { esc } from './ui.js';

export const SERIES = ['var(--accent)', 'var(--accent-2)', '#1baf7a', '#6250d6'];

/**
 * series: [{label, values: (number|null)[], color?, emphasis?, dash?}]
 * opts: {x: labels[], height, yFormat, invert, yMin, yMax, yLabel}
 */
export function lineChart(el, series, opts = {}) {
  // Draw at the container's real width (so labels stay readable on phones); 760 when it can't be measured.
  const cs = getComputedStyle(el), avail = Math.round(el.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0));
  const W = avail > 0 ? Math.max(300, avail) : 760, H = opts.height || (W < 520 ? 240 : 280), m = { t: 12, r: 16, b: 28, l: 44 };
  const n = opts.x.length;
  const vals = series.flatMap(s => s.values).filter(v => v != null);
  let lo = opts.yMin ?? Math.min(...vals), hi = opts.yMax ?? Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.06; if (opts.yMin == null) lo -= pad; if (opts.yMax == null) hi += pad;
  const X = i => m.l + (n <= 1 ? 0 : (i * (W - m.l - m.r)) / (n - 1));
  const Y = v => opts.invert ? m.t + ((v - lo) / (hi - lo)) * (H - m.t - m.b) : H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b);
  const fmt = opts.yFormat || (v => Math.round(v));
  const ticks = niceTicks(lo, hi, 5);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title || 'line chart')}">`;
  for (const t of ticks) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--grid)"/><text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${esc(fmt(t))}</text>`;
  const step = Math.max(1, Math.ceil(n / (W < 520 ? 6 : 12)));
  opts.x.forEach((lab, i) => { if (i % step === 0 || (i === n - 1 && (n - 1) % step >= step / 2)) svg += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(lab)}</text>`; });
  const ordered = [...series].sort((a, b) => (a.emphasis ? 1 : 0) - (b.emphasis ? 1 : 0));
  for (const s of ordered) {
    let d = '', pen = false;
    s.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; });
    const color = s.color || (s.emphasis ? 'var(--accent)' : 'var(--other-line)');
    svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${s.emphasis ? 2.5 : 1.25}" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="5 4"' : ''}/>`;
    if (s.emphasis) {
      const li = s.values.map((v, i) => v == null ? -1 : i).filter(i => i >= 0).pop();
      if (li != null && li >= 0) svg += `<circle cx="${X(li)}" cy="${Y(s.values[li])}" r="4" fill="${color}" stroke="var(--surface)" stroke-width="2"/>`;
    }
  }
  svg += `<line class="xh" y1="${m.t}" y2="${H - m.b}" stroke="var(--axis)" stroke-dasharray="3 3" visibility="hidden"/>`;
  svg += `<rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" class="hit"/></svg>`;
  const legendItems = series.filter(s => (s.emphasis || s.legend) && !s.noLegend);
  const others = series.filter(s => !s.emphasis && !s.legend && !s.noLegend).length;
  el.innerHTML = `<div class="chart">${svg}<div class="tip"></div></div>` +
    (legendItems.length || others ? `<div class="legend">${legendItems.map(s => `<span><i style="background:${s.color || 'var(--accent)'}"></i>${esc(s.label)}</span>`).join('')}${others ? `<span><i style="background:var(--other-line)"></i>${others === 1 ? '1 other' : `${others} others`}</span>` : ''}</div>` : '');
  const root = el.querySelector('.chart'), tip = root.querySelector('.tip'), xh = root.querySelector('.xh'), hit = root.querySelector('.hit');
  const svgEl = root.querySelector('svg');
  hit.addEventListener('mousemove', ev => {
    const r = svgEl.getBoundingClientRect(); const sx = (ev.clientX - r.left) * (W / r.width);
    const i = Math.max(0, Math.min(n - 1, Math.round(((sx - m.l) / (W - m.l - m.r)) * (n - 1))));
    xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.setAttribute('visibility', 'visible');
    const rows = series.map(s => ({ s, v: s.values[i] })).filter(x => x.v != null)
      .sort((a, b) => opts.invert ? a.v - b.v : b.v - a.v).slice(0, 12);
    tip.innerHTML = `<b>${esc(opts.x[i])}</b>` + rows.map(({ s, v }) => `<div class="r"><span style="${s.emphasis ? 'font-weight:650' : ''}">${esc(s.label)}</span><span>${esc(fmt(v))}</span></div>`).join('');
    tip.style.display = 'block';
    const px = (X(i) / W) * r.width; const left = px + 14 + tip.offsetWidth > r.width ? px - tip.offsetWidth - 14 : px + 14;
    tip.style.left = `${left}px`; tip.style.top = `8px`;
  });
  hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; xh.setAttribute('visibility', 'hidden'); });
}

/** Horizontal bars. items: [{label, value, color?, note?}] */
export function barList(el, items, opts = {}) {
  const fmt = opts.format || (v => Math.round(v));
  const max = Math.max(...items.map(i => Math.abs(i.value)), 1);
  const hasNeg = items.some(i => i.value < 0);
  el.innerHTML = `<div class="tablewrap"><table>${items.map(i => {
    const w = (Math.abs(i.value) / max) * (hasNeg ? 50 : 100);
    const bar = hasNeg
      ? `<div style="position:relative;height:10px;width:220px;background:var(--surface-2);border-radius:4px"><div style="position:absolute;top:0;height:10px;border-radius:4px;${i.value >= 0 ? `left:50%;width:${w}%;background:var(--div-pos)` : `right:50%;width:${w}%;background:var(--div-neg)`}"></div><div style="position:absolute;left:50%;top:-2px;height:14px;width:1px;background:var(--axis)"></div></div>`
      : `<div style="height:10px;width:220px;background:var(--surface-2);border-radius:4px"><div style="height:10px;border-radius:4px;width:${w}%;background:${i.color || 'var(--accent)'}"></div></div>`;
    return `<tr title="${esc(i.label)}: ${esc(fmt(i.value))}"><td>${i.html || esc(i.label)}</td><td>${bar}</td><td class="num">${esc(fmt(i.value))}</td>${i.note != null ? `<td class="muted">${esc(i.note)}</td>` : ''}</tr>`;
  }).join('')}</table></div>`;
}

/** Diverging fill for a 0..1 share around 0.5 (blue = good, red = bad, gray = even). */
export function divergingFill(p) {
  if (p == null || Number.isNaN(p)) return 'transparent';
  const d = Math.max(-1, Math.min(1, (p - 0.5) * 2));
  const pole = d >= 0 ? 'var(--div-pos)' : 'var(--div-neg)';
  return `color-mix(in oklab, ${pole} ${Math.round(Math.abs(d) * 70)}%, var(--mid))`;
}

function niceTicks(lo, hi, count) {
  const span = hi - lo; const raw = span / count; const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(s => span / s <= count) || 10 * mag;
  const out = []; for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(Math.round(t * 1e6) / 1e6);
  return out;
}

/**
 * Labeled scatter with dashed average lines and a caption in each corner.
 * points: [{x, y, label, sub?, me?, title?, color?}]; opts: {xLabel, yLabel, quads: [topRight, topLeft, bottomRight, bottomLeft], xFmt, yFmt, height, diag}
 */
export function scatter(el, points, opts = {}) {
  const cs = getComputedStyle(el), avail = Math.round(el.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0));
  const W = avail > 0 ? Math.max(300, avail) : 760, H = opts.height || 400, m = { t: 16, r: 12, b: 40, l: 44 };
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const pad = (a, f, lo0) => { let lo = Math.min(...a), hi = Math.max(...a); if (lo === hi) { lo -= 1; hi += 1; } const d = (hi - lo) * f; return [lo0 != null ? Math.min(lo0, lo - d) : lo - d, hi + d]; };
  const [x0, x1] = pad(xs, 0.12, opts.xMin), [y0, y1] = pad(ys, 0.12, opts.yMin);
  const X = v => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r), Y = v => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const xf = opts.xFmt || (v => Math.round(v)), yf = opts.yFmt || (v => Math.round(v));
  const ax = opts.xMid ?? xs.reduce((a, b) => a + b, 0) / xs.length, ay = opts.yMid ?? ys.reduce((a, b) => a + b, 0) / ys.length;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title || 'scatter chart')}">`;
  const q = (x, y, anchor, txt) => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="12" font-weight="600" fill="var(--muted)" letter-spacing=".04em">${esc(txt)}</text>`;
  const [tr, tl, br, bl] = opts.quads || [];
  svg += (tr ? q(W - m.r - 4, m.t + 12, 'end', tr) : '') + (tl ? q(m.l + 6, m.t + 12, 'start', tl) : '') + (br ? q(W - m.r - 4, H - m.b - 8, 'end', br) : '') + (bl ? q(m.l + 6, H - m.b - 8, 'start', bl) : '');
  if (opts.diag) { // y = x: points above it are expected to do better from here than they have so far
    const a = Math.max(x0, y0), b = Math.min(x1, y1);
    if (b > a) svg += `<line x1="${X(a)}" y1="${Y(a)}" x2="${X(b)}" y2="${Y(b)}" stroke="var(--axis)" stroke-dasharray="5 4"/>`;
  } else svg += `<line x1="${X(ax)}" x2="${X(ax)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--axis)" stroke-dasharray="5 4"/><line x1="${m.l}" x2="${W - m.r}" y1="${Y(ay)}" y2="${Y(ay)}" stroke="var(--axis)" stroke-dasharray="5 4"/>`;
  svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="var(--axis)"/><line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${H - m.b}" stroke="var(--axis)"/>`;
  for (const t of niceTicks(y0, y1, 4)) svg += `<text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${esc(yf(t))}</text>`;
  for (const t of niceTicks(x0, x1, W < 520 ? 4 : 6)) svg += `<text x="${X(t)}" y="${H - m.b + 15}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(xf(t))}</text>`;
  svg += `<text x="${(m.l + W - m.r) / 2}" y="${H - 6}" text-anchor="middle" font-size="12" fill="var(--ink-2)">${esc(opts.xLabel || '')} →</text><text transform="translate(12 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="var(--ink-2)">${esc(opts.yLabel || '')} →</text>`;
  // Dots first, then labels placed one by one, nudged to avoid landing on one already placed.
  const pts = points.map(p => ({ p, cx: X(p.x), cy: Y(p.y) }));
  for (const d of [...pts].sort((a, b) => !!a.p.me - !!b.p.me)) svg += `<circle cx="${d.cx.toFixed(1)}" cy="${d.cy.toFixed(1)}" r="${d.p.me ? 8 : 6}" fill="${d.p.color || (d.p.me ? 'var(--gold)' : 'var(--accent)')}" stroke="var(--surface)" stroke-width="2"><title>${esc(d.p.title || d.p.label)}</title></circle>`;
  const boxes = pts.map(d => ({ x0: d.cx - 7, x1: d.cx + 7, y0: d.cy - 7, y1: d.cy + 7, dot: d }));
  for (const d of [...pts].sort((a, b) => !!b.p.me - !!a.p.me || a.cy - b.cy)) {
    const label = `${d.p.label}${d.p.sub ? ` ${d.p.sub}` : ''}`, tw = label.length * 7 + 4;
    const prefRight = d.cx + 11 + tw < W;
    let best = null;
    place: for (const dy of [0, -15, 15, -30, 30, -45, 45]) for (const right of [prefRight, !prefRight]) {
      const x = d.cx + (right ? 11 : -11), y = d.cy + dy;
      const b = { x0: right ? x : x - tw, x1: right ? x + tw : x, y0: y - 9, y1: y + 5 };
      if (b.x0 < m.l || b.x1 > W) continue;
      if (!boxes.some(o => o.dot !== d && b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1)) { best = { x, y, right, b }; break place; }
    }
    if (!best) best = { x: d.cx + (prefRight ? 11 : -11), y: d.cy, right: prefRight, b: null };
    if (best.b) boxes.push(best.b);
    if (best.y !== d.cy) svg += `<line x1="${d.cx}" y1="${d.cy}" x2="${best.x + (best.right ? -2 : 2)}" y2="${best.y - 3}" stroke="var(--axis)"/>`;
    svg += `<text x="${best.x}" y="${best.y + 4}" text-anchor="${best.right ? 'start' : 'end'}" font-size="12" font-weight="${d.p.me ? 700 : 500}" fill="var(--ink)">${esc(d.p.label)}${d.p.sub ? ` <tspan fill="var(--muted)" font-weight="400">${esc(d.p.sub)}</tspan>` : ''}</text>`;
  }
  el.innerHTML = `<div class="chart">${svg}</svg></div>`;
}
