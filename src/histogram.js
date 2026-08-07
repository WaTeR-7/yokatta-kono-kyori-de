/**
 * 長さ分布の描画。上段が全体、下段が目標帯まわりの拡大。
 *
 * 拡大表示が要るのは、難易度が上がると目標帯が全体の 0.3% 程度まで狭まり、
 * 全体表示では 1px 未満のスジになって狙えなくなるため。
 */

import { lowerBound } from './enumerate.js';

const COLORS = {
  bar: '#39405a',
  barLit: '#4c5578',
  target: '#f5c542',
  targetFill: 'rgba(245, 197, 66, 0.22)',
  now: '#4fd1e0',
  axis: '#2a2f3f',
};

/** 目標帯が拡大ビューの幅のこの割合を占めるようにする。 */
const ZOOM_BAND_FRACTION = 1 / 9;

/** 拡大範囲に入る経路数に合わせてビンを刻む。少ないのに細かく刻むと櫛の歯になる。 */
function zoomBinsFor(countInRange) {
  return Math.min(130, Math.max(16, Math.round(Math.sqrt(countInRange) * 2)));
}

export class HistogramView {
  constructor(fullCanvas, zoomCanvas) {
    this.full = { canvas: fullCanvas, ctx: fullCanvas.getContext('2d'), w: 1, h: 1 };
    this.zoom = { canvas: zoomCanvas, ctx: zoomCanvas.getContext('2d'), w: 1, h: 1 };
    this.data = null;
    this.current = null;
    this.resize();
  }

  resize() {
    for (const target of [this.full, this.zoom]) {
      const rect = target.canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      target.w = rect.width;
      target.h = rect.height;
      target.canvas.width = Math.round(rect.width * dpr);
      target.canvas.height = Math.round(rect.height * dpr);
      target.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /**
   * @param {Float64Array} sorted ソート済み全経路長
   * @param {Uint32Array} binCounts 全体表示用のビン
   * @param {number} min,max 分布の両端
   * @param {number} bandLo,bandHi 目標帯（0-indexed）
   */
  setData({ sorted, binCounts, min, max, bandLo, bandHi }) {
    const bandMin = sorted[bandLo];
    const bandMax = sorted[bandHi];
    const fullSpan = max - min;
    const bandSpan = Math.max(bandMax - bandMin, fullSpan * 1e-5);
    // 帯が広い段では拡大幅が分布全体を超えてしまい、かえって縮小表示になる。
    // 全体の範囲を超えないよう抑え、はみ出す場合は内側に寄せる。
    const zoomSpan = Math.min(bandSpan / ZOOM_BAND_FRACTION, fullSpan);
    const center = (bandMin + bandMax) / 2;
    let zoomLo = center - zoomSpan / 2;
    if (zoomLo < min) zoomLo = min;
    if (zoomLo + zoomSpan > max) zoomLo = max - zoomSpan;
    const zoomHi = zoomLo + zoomSpan;

    // 拡大側のビンはステージ中変わらないので一度だけ数える
    const zoomStart = lowerBound(sorted, zoomLo);
    const bins = zoomBinsFor(lowerBound(sorted, zoomHi) - zoomStart);
    const zoomCounts = new Uint32Array(bins);
    let zoomPeak = 0;
    let edge = zoomStart;
    for (let i = 0; i < bins; i++) {
      const next = lowerBound(sorted, zoomLo + (zoomSpan * (i + 1)) / bins);
      zoomCounts[i] = next - edge;
      if (zoomCounts[i] > zoomPeak) zoomPeak = zoomCounts[i];
      edge = next;
    }

    let peak = 0;
    for (const c of binCounts) if (c > peak) peak = c;

    this.data = {
      sorted, binCounts, min, max, bandLo, bandHi,
      bandMin, bandMax, peak,
      zoomLo, zoomHi, zoomSpan, zoomCounts, zoomPeak,
    };
    this.current = null;
  }

  clear() {
    this.data = null;
    this.current = null;
  }

  /** 全点をつなぎ終えたときだけマーカーを出す。途中経過は比較対象にならない。 */
  setCurrent(length) {
    this.current = length;
  }

  /** 拡大ビューの外に出ているときの向き。'short' | 'long' | null */
  get outOfZoom() {
    if (!this.data || this.current == null) return null;
    if (this.current < this.data.zoomLo) return 'short';
    if (this.current > this.data.zoomHi) return 'long';
    return null;
  }

  render() {
    this.#renderFull();
    this.#renderZoom();
  }

  #renderFull() {
    const { ctx, w, h } = this.full;
    ctx.clearRect(0, 0, w, h);
    if (!this.data) return;
    const d = this.data;
    const span = d.max - d.min;
    const toX = (value) => ((value - d.min) / span) * w;

    this.#drawBars(ctx, w, h, d.binCounts, d.peak);
    this.#drawBand(ctx, h, toX(d.bandMin), toX(d.bandMax), 2);
    this.#drawBaseline(ctx, w, h);
    if (this.current != null) this.#drawNow(ctx, h, toX(this.current), w);
  }

  #renderZoom() {
    const { ctx, w, h } = this.zoom;
    ctx.clearRect(0, 0, w, h);
    if (!this.data) return;
    const d = this.data;
    const toX = (value) => ((value - d.zoomLo) / d.zoomSpan) * w;

    this.#drawBars(ctx, w, h, d.zoomCounts, d.zoomPeak);
    this.#drawBand(ctx, h, toX(d.bandMin), toX(d.bandMax), 3);
    this.#drawBaseline(ctx, w, h);

    if (this.current != null) {
      const x = toX(this.current);
      if (x < 0 || x > w) this.#drawEdgeArrow(ctx, w, h, x < 0 ? -1 : 1);
      else this.#drawNow(ctx, h, x, w);
    }
  }

  #drawBars(ctx, w, h, counts, peak) {
    if (!peak) return;
    const n = counts.length;
    const barWidth = w / n;
    ctx.fillStyle = COLORS.bar;
    for (let i = 0; i < n; i++) {
      if (!counts[i]) continue;
      // 平方根スケール。裾の少ない領域も潰れずに見える。
      const height = Math.max(1.5, Math.sqrt(counts[i] / peak) * (h - 5));
      ctx.fillRect(i * barWidth, h - height, Math.max(1, barWidth - 0.5), height);
    }
  }

  #drawBand(ctx, h, x0, x1, minWidth) {
    const left = Math.min(x0, x1);
    const width = Math.max(minWidth, Math.abs(x1 - x0));
    ctx.save();
    ctx.fillStyle = COLORS.targetFill;
    ctx.fillRect(left, 0, width, h);
    ctx.strokeStyle = COLORS.target;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left + 0.5, 0);
    ctx.lineTo(left + 0.5, h);
    ctx.moveTo(left + width - 0.5, 0);
    ctx.lineTo(left + width - 0.5, h);
    ctx.stroke();
    ctx.restore();
  }

  #drawBaseline(ctx, w, h) {
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();
  }

  #drawNow(ctx, h, x, w) {
    const clamped = Math.max(1, Math.min(w - 1, x));
    ctx.save();
    ctx.strokeStyle = COLORS.now;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(clamped, 0);
    ctx.lineTo(clamped, h);
    ctx.stroke();

    ctx.fillStyle = COLORS.now;
    ctx.beginPath();
    ctx.moveTo(clamped, 7);
    ctx.lineTo(clamped - 5, 0);
    ctx.lineTo(clamped + 5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  #drawEdgeArrow(ctx, w, h, direction) {
    const y = h / 2;
    const x = direction < 0 ? 9 : w - 9;
    ctx.save();
    ctx.fillStyle = COLORS.now;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(x + direction * 7, y);
    ctx.lineTo(x - direction * 5, y - 7);
    ctx.lineTo(x - direction * 5, y + 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
