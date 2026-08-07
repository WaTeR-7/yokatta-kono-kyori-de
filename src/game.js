/**
 * ラン全体の進行とスコア。描画にも DOM にも依存しない。
 *
 * 現在の経路長がリアルタイムで見えている以上、提出はノーリスクで
 * 「帯に入るまで直し続ければ必ず成功する」。したがってライフ制は
 * 「諦めたかどうか」しか測れない。コストは失敗ではなく **かかった時間** に置き、
 * 誤提出は時間を払って盤面から降りる手段（実質のスキップ）として機能させる。
 */

export const START_SECONDS = 60;
export const WRONG_PENALTY = 12;
const BEST_KEY = 'ykkd.best';

/**
 * 得点式。
 *   base        点の数。盤面が複雑なほど高い
 *   precision   長さの窓が狭いほど高い（窓10% → 40点、1% → 400点、0.2% → 2000点）
 *   centerBonus 帯のど真ん中に寄せるほど高い。「ちょうどこの距離」を狙う動機
 *   combo       連続成功で最大 2 倍
 */
export function scoreFor({ n, windowRatio, length, bandMin, bandMax, combo }) {
  const base = 100 * n;
  const precision = Math.round(4 / windowRatio);

  const center = (bandMin + bandMax) / 2;
  const half = Math.max((bandMax - bandMin) / 2, 1e-9);
  const centerBonus = Math.round(200 * Math.max(0, 1 - Math.abs(length - center) / half));

  const multiplier = comboMultiplier(combo);
  return Math.round((base + precision + centerBonus) * multiplier);
}

export function comboMultiplier(combo) {
  return Math.min(2, 1 + 0.1 * combo);
}

export class Run {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.stage = 1;
    this.score = 0;
    this.combo = 0;
    this.maxN = 0;
    this.cleared = 0;
    this.missed = 0;
    this.time = START_SECONDS;
    this.elapsed = 0;
  }

  /** 秒単位。プレイ中だけ呼ぶ。 */
  tick(seconds) {
    this.time -= seconds;
    this.elapsed += seconds;
  }

  succeed(gain, n, bonusSeconds) {
    this.score += gain;
    this.combo += 1;
    this.cleared += 1;
    this.maxN = Math.max(this.maxN, n);
    this.time += bonusSeconds;
  }

  fail() {
    this.combo = 0;
    this.missed += 1;
    this.time -= WRONG_PENALTY;
  }

  /** 判定中は今のステージ番号を出したままにしたいので、進めるのは「次へ」を押してから。 */
  advance() {
    this.stage += 1;
  }

  get isOver() {
    return this.time <= 0;
  }
}

export function formatTime(seconds) {
  const clamped = Math.max(0, seconds);
  return clamped.toFixed(1);
}

export function formatDuration(seconds) {
  const total = Math.round(seconds);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return min > 0 ? `${min}分${String(sec).padStart(2, '0')}秒` : `${sec}秒`;
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
