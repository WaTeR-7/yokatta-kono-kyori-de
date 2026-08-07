/**
 * ラン全体の進行とスコア。描画にも DOM にも依存しない。
 */

export const MAX_LIVES = 3;
const BEST_KEY = 'ykkd.best';

/**
 * 得点式。
 *   base        点の数。盤面が複雑なほど高い
 *   precision   帯が狭いほど高い（幅8% → 62点、0.5% → 1000点）
 *   centerBonus 帯のど真ん中に寄せるほど高い。「ちょうどこの距離」を狙う動機
 *   combo       連続成功で最大 2 倍
 */
export function scoreFor({ n, width, total, rank, bandLo, bandHi, combo }) {
  const bandPercent = (width / total) * 100;
  const base = 100 * n;
  const precision = Math.round(500 / bandPercent);

  const center = (bandLo + bandHi) / 2;
  const half = Math.max(1, (bandHi - bandLo) / 2);
  const offset = Math.abs(rank - 1 - center) / half;
  const centerBonus = Math.round(200 * Math.max(0, 1 - offset));

  const multiplier = Math.min(2, 1 + 0.1 * combo);
  return Math.round((base + precision + centerBonus) * multiplier);
}

export class Run {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.stage = 1;
    this.lives = MAX_LIVES;
    this.score = 0;
    this.combo = 0;
    this.maxN = 0;
    this.cleared = 0;
  }

  succeed(gain, n) {
    this.score += gain;
    this.combo += 1;
    this.cleared += 1;
    this.maxN = Math.max(this.maxN, n);
  }

  fail() {
    this.lives -= 1;
    this.combo = 0;
  }

  /** 判定中は今のステージ番号を出したままにしたいので、進めるのは「次へ」を押してから。 */
  advance() {
    this.stage += 1;
  }

  get isOver() {
    return this.lives <= 0;
  }
}

export function loadBest() {
  const raw = Number(localStorage.getItem(BEST_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export function saveBest(score) {
  const best = loadBest();
  if (score > best) {
    localStorage.setItem(BEST_KEY, String(score));
    return true;
  }
  return false;
}

export function newRunSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}
