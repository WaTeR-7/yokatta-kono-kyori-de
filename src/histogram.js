/**
 * 長さ分布の描画。
 *
 * 難易度が上がると目標帯は分布全体の 1% 未満まで細くなり、線としては
 * ほとんど見えなくなる。そのため帯は最低幅を持たせて必ず視認できるようにし、
 * 帯に対する現在位置は文字（もっと長く／もっと短く／帯の中）でも伝える。
 */

import { readPalette } from './theme.js';

const PALETTE = {
  bar: '--bar',
  band: '--band',
  bandFill: '--band-fill-strong',
  now: '--now',
  axis: '--line',
};

/** 帯が細くてもこの幅では描く。位置は正確なまま見失わせないため。 */
const MIN_BAND_PIXELS = 3;

export class HistogramView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.colors = readPalette(PALETTE);
    this.width = 1;
    this.height = 1;
    this.data = null;
    this.current = null;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.colors = readPalette(PALETTE);
  }

  /**
   * @param {Float64Array} sorted ソート済み全経路長
   * @param {Uint32Array} binCounts ビン集計
   * @param {number} min,max 分布の両端
   * @param {number} bandLo,bandHi 目標帯（0-indexed）
   */
  setData({ sorted, binCounts, min, max, bandLo, bandHi }) {
    let peak = 0;
    for (const count of binCounts) if (count > peak) peak = count;
    this.data = {
      binCounts,
      min,
      max,
      peak,
      bandMin: sorted[bandLo],
      bandMax: sorted[bandHi],
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

  /** 帯に対する現在位置。'short' | 'long' | 'in' | null */
  get status() {
    if (!this.data || this.current == null) return null;
    if (this.current < this.data.bandMin) return 'short';
    if (this.current > this.data.bandMax) return 'long';
    return 'in';
  }

  render() {
    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);
    if (!this.data) return;

    const d = this.data;
    const span = d.max - d.min || 1;
    const toX = (value) => ((value - d.min) / span) * width;

    this.#drawBars();
    this.#drawBand(toX(d.bandMin), toX(d.bandMax));
    this.#drawBaseline();
    if (this.current != null) this.#drawNow(toX(this.current));
  }

  #drawBars() {
    const { ctx, width, height } = this;
    const { binCounts, peak } = this.data;
    if (!peak) return;
    const barWidth = width / binCounts.length;
    ctx.fillStyle = this.colors.bar;
    for (let i = 0; i < binCounts.length; i++) {
      if (!binCounts[i]) continue;
      // 平方根スケール。裾の少ない領域も潰れずに見える。
      const barHeight = Math.max(1.5, Math.sqrt(binCounts[i] / peak) * (height - 5));
      ctx.fillRect(i * barWidth, height - barHeight, Math.max(1, barWidth - 0.5), barHeight);
    }
  }

  #drawBand(x0, x1) {
    const { ctx, height } = this;
    const drawn = Math.max(MIN_BAND_PIXELS, Math.abs(x1 - x0));
    // 最低幅で描くときは中心をずらさない
    const left = Math.min(x0, x1) - Math.max(0, (drawn - Math.abs(x1 - x0)) / 2);

    ctx.save();
    ctx.fillStyle = this.colors.bandFill;
    ctx.fillRect(left, 0, drawn, height);
    ctx.strokeStyle = this.colors.band;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(left + 0.75, 0);
    ctx.lineTo(left + 0.75, height);
    ctx.moveTo(left + drawn - 0.75, 0);
    ctx.lineTo(left + drawn - 0.75, height);
    ctx.stroke();
    ctx.restore();
  }

  #drawBaseline() {
    const { ctx, width, height } = this;
    ctx.strokeStyle = this.colors.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height - 0.5);
    ctx.lineTo(width, height - 0.5);
    ctx.stroke();
  }

  #drawNow(x) {
    const { ctx, width, height } = this;
    const clamped = Math.max(6, Math.min(width - 6, x));
    ctx.save();
    ctx.strokeStyle = this.colors.now;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(clamped, 0);
    ctx.lineTo(clamped, height);
    ctx.stroke();

    ctx.fillStyle = this.colors.now;
    ctx.beginPath();
    ctx.moveTo(clamped, 8);
    ctx.lineTo(clamped - 5.5, 0);
    ctx.lineTo(clamped + 5.5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
