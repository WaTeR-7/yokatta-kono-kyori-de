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
 * 難易度テーブル。1 段につき 1 ステージ。
 *
 * 難易度は「順位の幅」ではなく **目標の長さの窓が分布全体の何割か** で定義する。
 * 同じ順位幅でも分布の中央は裾より長さの窓が 2〜3 倍狭く、体感の難しさが
 * 問ごとにばらついてしまうため。順位幅の方を毎回逆算する。
 *
 * window は、辺を 1 本入れ替えたときの長さの変化量（n=8 で中央値 0.52、
 * n=10 で 0.33）に対して十分な余裕があるように決めている。
 *
 * 以前は 2 ステージずつ進めていたが、それだと n=10 に届くのがステージ 19 で、
 * 18 問正解しないと最大サイズを一度も見られなかった。
 *
 * bonus は正解したときに増える秒数。
 */
export const LADDER = [
  { upTo: 1, n: 5, window: 0.300, bonus: 12 },
  { upTo: 2, n: 5, window: 0.260, bonus: 13 },
  { upTo: 3, n: 6, window: 0.220, bonus: 15 },
  { upTo: 4, n: 6, window: 0.180, bonus: 16 },
  { upTo: 5, n: 7, window: 0.150, bonus: 18 },
  { upTo: 6, n: 7, window: 0.120, bonus: 20 },
  { upTo: 7, n: 8, window: 0.100, bonus: 22 },
  { upTo: 8, n: 8, window: 0.080, bonus: 24 },
  { upTo: 9, n: 9, window: 0.065, bonus: 26 },
  { upTo: 10, n: 9, window: 0.050, bonus: 28 },
  { upTo: 11, n: 10, window: 0.040, bonus: 30 },
  { upTo: 12, n: 10, window: 0.030, bonus: 32 },
  { upTo: 13, n: 10, window: 0.022, bonus: 34 },
  { upTo: Infinity, n: 10, window: 0.016, bonus: 36 },
];

/** ここから先は窓が締まり続ける。上手い人でもいつか時間が尽きるように。 */
const ENDLESS_FROM = 14;
const ENDLESS_DECAY = 0.93;
const WINDOW_FLOOR = 0.002;

export function difficultyFor(stage) {
  for (const row of LADDER) {
    if (stage <= row.upTo) return row;
  }
  return LADDER[LADDER.length - 1];
}

/** 目標の長さの窓が、分布全体の幅に占める割合。 */
export function windowRatioFor(stage) {
  const rule = difficultyFor(stage);
  if (stage < ENDLESS_FROM) return rule.window;
  return Math.max(WINDOW_FLOOR, rule.window * ENDLESS_DECAY ** (stage - ENDLESS_FROM));
}

/** 正解したときに増える秒数。 */
export function bonusSecondsFor(stage) {
  return difficultyFor(stage).bonus;
}

/**
 * 目標帯を分布のどのあたりに置くか（順位の割合で指定）。
 *
 * 序盤は分布の中央付近に限定し、ステージが進むにつれて全域へ広げる。
 *
 * 「本能でつないだ経路は最下位付近に落ちるのだから、序盤の目標も短い側に
 * 寄せればよい」というのは誤り。分布の裾は経路が極端に疎で、幅 30% の窓でも
 * 60 通り中 6 通りしか入らず「最短を厳密に当てろ」に化ける。
 * 経路が最も密集するのは中央（最頻値）付近で、そこに広い窓を置くのが一番易しい。
 */
export function placementFor(stage) {
  const t = Math.min(1, Math.max(0, (stage - 1) / 7));
  const half = 0.15 + 0.30 * t;
  return { lo: 0.5 - half, hi: 0.5 + half };
}

/** ステージ設定をまとめて作る。 */
export function buildStage(runSeed, stage) {
  const rule = difficultyFor(stage);
  const seed = stageSeed(runSeed, stage);
  return { stage, n: rule.n, seed, points: generatePoints(rule.n, seed) };
}
