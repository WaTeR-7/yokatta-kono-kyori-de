/**
 * 盤面の描画と当たり判定。
 * 点は [0,1]^2 の正規化座標で受け取り、キャンバス内の正方領域に等倍で写す。
 */

import { readPalette } from './theme.js?v=202608072141';

const PALETTE = {
  nowRgb: '--now-rgb',
  bandRgb: '--band-rgb',
  point: '--point',
  pointRing: '--point-ring',
  active: '--now',
  ghost: '--band',
  grid: '--grid',
  surface: '--bg-sunken',
};

export class BoardView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.colors = readPalette(PALETTE);
    this.points = [];
    this.order = [];
    this.ghost = null;
    this.ghostProgress = 0;
    this.pulse = 0;
    this.cssWidth = 1;
    this.cssHeight = 1;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.colors = readPalette(PALETTE);
  }

  /** 盤面は常に正方形。余った側は中央寄せにする。 */
  get geometry() {
    const size = Math.min(this.cssWidth, this.cssHeight);
    const radius = Math.max(11, Math.min(19, size * 0.042));
    const pad = radius + 5;
    return {
      size,
      radius,
      originX: (this.cssWidth - size) / 2 + pad,
      originY: (this.cssHeight - size) / 2 + pad,
      inner: size - pad * 2,
    };
  }

  toScreen(point) {
    const g = this.geometry;
    return { x: g.originX + point.x * g.inner, y: g.originY + point.y * g.inner };
  }

  setStage(points) {
    this.points = points;
    this.order = [];
    this.ghost = null;
    this.ghostProgress = 0;
  }

  setOrder(order) {
    this.order = order;
  }

  setGhost(order) {
    this.ghost = order;
    this.ghostProgress = 0;
  }

  clearGhost() {
    this.ghost = null;
    this.ghostProgress = 0;
  }

  /** タップ位置に一番近い点。指でも押せるよう判定を広めに取る。 */
  hitTest(cssX, cssY) {
    const g = this.geometry;
    const threshold = g.radius * 2.1;
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.points.length; i++) {
      const p = this.toScreen(this.points[i]);
      const d = Math.hypot(p.x - cssX, p.y - cssY);
      if (d < threshold && d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best === -1 ? null : best;
  }

  step(dt) {
    this.pulse = (this.pulse + dt * 0.0022) % 1;
    if (this.ghost && this.ghostProgress < 1) {
      this.ghostProgress = Math.min(1, this.ghostProgress + dt / 900);
    }
  }

  render() {
    const ctx = this.ctx;
    const g = this.geometry;
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);

    this.#drawGrid(g);
    if (this.ghost) this.#drawGhostPath(g);
    this.#drawPath(g);
    this.#drawPoints(g);
    // 端点の印は点より前面に置く。点に隠れると読めないため。
    if (this.ghost) this.#drawGhostEndpoints(g);
  }

  #drawGrid(g) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.colors.grid;
    ctx.lineWidth = 1;
    const step = g.inner / 6;
    for (let i = 0; i <= 6; i++) {
      const x = g.originX + step * i;
      const y = g.originY + step * i;
      ctx.beginPath();
      ctx.moveTo(x, g.originY);
      ctx.lineTo(x, g.originY + g.inner);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(g.originX, y);
      ctx.lineTo(g.originX + g.inner, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  #drawPath(g) {
    if (this.order.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.strokeStyle = `rgba(${this.colors.nowRgb}, 0.16)`;
    ctx.lineWidth = g.radius * 0.85;
    this.#tracePath(this.order);
    ctx.stroke();

    ctx.strokeStyle = this.colors.active;
    ctx.lineWidth = 2.6;
    this.#tracePath(this.order);
    ctx.stroke();
    ctx.restore();
  }

  #drawGhostPath(g) {
    const ctx = this.ctx;
    const order = this.ghost;
    if (order.length < 2) return;

    // 全体長に対する進捗で、線を先端まで少しずつ伸ばす
    const pts = order.map((i) => this.toScreen(this.points[i]));
    const segments = [];
    let total = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      segments.push(d);
      total += d;
    }
    let remaining = total * this.ghostProgress;

    const trace = (limit) => {
      let left = limit;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < segments.length && left > 0; i++) {
        const ratio = Math.min(1, left / segments[i]);
        ctx.lineTo(
          pts[i].x + (pts[i + 1].x - pts[i].x) * ratio,
          pts[i].y + (pts[i + 1].y - pts[i].y) * ratio,
        );
        left -= segments[i];
      }
    };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 下に太い半透明の線を敷いて、暗いオーバーレイ越しでも読めるようにする
    ctx.strokeStyle = `rgba(${this.colors.bandRgb}, 0.18)`;
    ctx.lineWidth = g.radius * 0.7;
    trace(remaining);
    ctx.stroke();

    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = this.colors.ghost;
    ctx.lineWidth = 2.4;
    trace(remaining);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 正解例の始点と終点。どちらから辿る経路なのかが分からないと
   * 自分の経路と見比べられないので、ラベルで明示する。
   */
  #drawGhostEndpoints(g) {
    const order = this.ghost;
    if (!order.length) return;
    this.#drawGhostEndpoint(this.toScreen(this.points[order[0]]), '始', g);
    if (order.length > 1) {
      this.#drawGhostEndpoint(this.toScreen(this.points[order[order.length - 1]]), '終', g);
    }
  }

  #drawGhostEndpoint(p, label, g) {
    const ctx = this.ctx;
    ctx.save();

    ctx.strokeStyle = this.colors.ghost;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, g.radius + 5, 0, Math.PI * 2);
    ctx.stroke();

    const fontSize = Math.max(10, Math.round(g.radius * 0.8));
    ctx.font = `700 ${fontSize}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const boxHeight = fontSize + 7;
    const boxWidth = ctx.measureText(label).width + 11;
    // 盤面の上端にかかるときは下側に逃がす
    const above = p.y - g.radius - 8 - boxHeight / 2 > 2;
    const y = above ? p.y - g.radius - 8 - boxHeight / 2 : p.y + g.radius + 8 + boxHeight / 2;
    const x = p.x - boxWidth / 2;

    ctx.fillStyle = this.colors.ghost;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y - boxHeight / 2, boxWidth, boxHeight, 3);
    else ctx.rect(x, y - boxHeight / 2, boxWidth, boxHeight);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, p.x, y + 0.5);
    ctx.restore();
  }

  #tracePath(order) {
    const ctx = this.ctx;
    ctx.beginPath();
    order.forEach((index, i) => {
      const p = this.toScreen(this.points[index]);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
  }

  #drawPoints(g) {
    const ctx = this.ctx;
    const position = new Map();
    this.order.forEach((index, i) => position.set(index, i));
    const last = this.order.length ? this.order[this.order.length - 1] : -1;

    for (let i = 0; i < this.points.length; i++) {
      const p = this.toScreen(this.points[i]);
      const visited = position.has(i);
      const isLast = i === last;

      if (isLast) {
        const wave = 0.5 + 0.5 * Math.sin(this.pulse * Math.PI * 2);
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, g.radius + 4 + wave * 4, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${this.colors.nowRgb}, ${0.5 - wave * 0.3})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, g.radius, 0, Math.PI * 2);
      ctx.fillStyle = visited ? this.colors.active : this.colors.point;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = visited ? this.colors.active : this.colors.pointRing;
      ctx.stroke();

      if (visited) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 ${Math.round(g.radius * 1.05)}px ${getComputedStyle(document.body).fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(position.get(i) + 1), p.x, p.y + 0.5);
      }
    }
  }
}
