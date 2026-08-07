/**
 * 盤面の生成と難易度テーブル。DOM に依存しないので Node からもそのまま使える。
 */

/** mulberry32。シードが同じなら常に同じ盤面が出る。 */
export function makeRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ラン全体のシードとステージ番号から、そのステージ固有のシードを作る。 */
export function stageSeed(runSeed, stage) {
  return (Math.imul(runSeed >>> 0, 0x9e3779b1) ^ Math.imul(stage + 1, 0x85ebca6b)) >>> 0;
}

const MARGIN = 0.07;

/**
 * [0,1]^2 に n 点を置く。点が固まると経路の見分けがつかなくなるので、
 * 最小間隔を課した棄却サンプリングにする。置けなければ間隔を緩めて再挑戦。
 */
export function generatePoints(n, seed) {
  const rng = makeRng(seed);
  const span = 1 - MARGIN * 2;
  let minDist = 0.62 / Math.sqrt(n);

  for (let relax = 0; relax < 40; relax++) {
    const points = [];
    let attempts = 0;
    while (points.length < n && attempts < 4000) {
      attempts++;
      const x = MARGIN + rng() * span;
      const y = MARGIN + rng() * span;
      let ok = true;
      for (const p of points) {
        if (Math.hypot(p.x - x, p.y - y) < minDist) {
          ok = false;
          break;
        }
      }
      if (ok) points.push({ x, y });
    }
    if (points.length === n) return points;
    minDist *= 0.9;
  }
  throw new Error(`点配置に失敗しました (n=${n}, seed=${seed})`);
}

/**
 * 難易度テーブル。
 * n=5 は全 60 通りしかなく割合で切ると帯が潰れるので、件数で直接指定する。
 * n を上げるほど盤面は複雑になるが近傍手数も増えて微調整が効くので、
 * 難易度の主軸は帯の幅（ratio）に置いている。
 */
export const LADDER = [
  { upTo: 1, n: 5, absolute: 9 },
  { upTo: 3, n: 6, ratio: 0.08 },
  { upTo: 5, n: 7, ratio: 0.05 },
  { upTo: 7, n: 8, ratio: 0.03 },
  { upTo: 9, n: 9, ratio: 0.02 },
  { upTo: 11, n: 10, ratio: 0.01 },
  { upTo: Infinity, n: 10, ratio: 0.005 },
];

export function difficultyFor(stage) {
  for (const row of LADDER) {
    if (stage <= row.upTo) return row;
  }
  return LADDER[LADDER.length - 1];
}

/** 目標帯の幅（件数）。最低 3 件は確保する。 */
export function bandWidthFor(stage, total) {
  const rule = difficultyFor(stage);
  const raw = rule.absolute !== undefined ? rule.absolute : Math.round(total * rule.ratio);
  return Math.max(3, Math.min(total, raw));
}

/** 帯の開始位置（0-indexed）を一様に選ぶ。 */
export function bandStartFor(rng, total, width) {
  return Math.floor(rng() * (total - width + 1));
}

/** ステージ設定をまとめて作る。 */
export function buildStage(runSeed, stage) {
  const rule = difficultyFor(stage);
  const seed = stageSeed(runSeed, stage);
  return { stage, n: rule.n, seed, points: generatePoints(rule.n, seed) };
}
