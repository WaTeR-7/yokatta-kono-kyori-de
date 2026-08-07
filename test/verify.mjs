/**
 * 依存なしの検証スクリプト。`node test/verify.mjs` で実行する。
 *
 * ここで確かめたいのは主に2つ。
 *  - 全列挙が本当に全経路を1度ずつ拾えているか
 *  - プレイヤーの経路長が列挙側の値とビット単位で一致するか（順位が1つずれると判定が壊れる）
 */

import assert from 'node:assert/strict';
import {
  buildDistanceMatrix,
  canonicalOrder,
  canonicalPathLength,
  enumerateSortedLengths,
  factorial,
  findPathByLength,
  histogramBins,
  JUDGE_IN,
  JUDGE_LONG,
  JUDGE_SHORT,
  judge,
  lowerBound,
  pathCount,
  pathLength,
  rankOf,
} from '../src/enumerate.js';
import {
  LADDER,
  bandStartFor,
  bandWidthFor,
  buildStage,
  difficultyFor,
  generatePoints,
  makeRng,
  stageSeed,
} from '../src/generator.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** 素朴な全順列生成。列挙アルゴリズムと独立した実装であることが大事。 */
function naivePermutations(n) {
  const result = [];
  const current = [];
  const used = new Array(n).fill(false);
  const recurse = () => {
    if (current.length === n) {
      result.push(current.slice());
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      current.push(i);
      recurse();
      current.pop();
      used[i] = false;
    }
  };
  recurse();
  return result;
}

function naiveSortedLengths(dist, n) {
  const lengths = [];
  for (const perm of naivePermutations(n)) {
    if (perm[0] > perm[n - 1]) continue;
    let total = 0;
    for (let i = 0; i + 1 < n; i++) total += dist[perm[i] * n + perm[i + 1]];
    lengths.push(total);
  }
  lengths.sort((a, b) => a - b);
  return lengths;
}

function setup(n, seed) {
  const points = generatePoints(n, seed);
  const dist = buildDistanceMatrix(points);
  const sorted = enumerateSortedLengths(dist, n);
  return { points, dist, sorted };
}

function shuffledOrder(n, rng) {
  const order = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// ---------------------------------------------------------------------------

section('1. 列挙の完全性 — 件数が厳密に n!/2 か');

for (const n of [5, 6, 7, 8]) {
  test(`n=${n} の経路数が ${factorial(n) / 2} 件`, () => {
    const { sorted } = setup(n, 1000 + n);
    assert.equal(sorted.length, factorial(n) / 2);
    assert.equal(sorted.length, pathCount(n));
  });
}

// ---------------------------------------------------------------------------

section('2. 列挙の正当性 — 素朴な全順列生成と完全一致するか');

for (const n of [5, 6, 7, 8]) {
  test(`n=${n} の長さ列が素朴実装と一致`, () => {
    const { dist, sorted } = setup(n, 2000 + n);
    const naive = naiveSortedLengths(dist, n);
    assert.equal(sorted.length, naive.length);
    for (let i = 0; i < naive.length; i++) {
      // 足す順序まで同じなので、丸め誤差の余地なく厳密一致するはず
      assert.equal(sorted[i], naive[i], `index ${i} で不一致`);
    }
  });
}

test('全順列が重複なく1度ずつ現れる (n=6)', () => {
  const n = 6;
  const seen = new Set();
  for (const perm of naivePermutations(n)) {
    seen.add(canonicalOrder(perm).join(','));
  }
  assert.equal(seen.size, factorial(n) / 2);
});

// ---------------------------------------------------------------------------

section('3. 順位算出 — 二分探索が線形走査と一致するか');

test('lowerBound が線形走査と全件一致 (n=7)', () => {
  const { sorted } = setup(7, 3007);
  for (let i = 0; i < sorted.length; i += 7) {
    const value = sorted[i];
    let linear = 0;
    while (linear < sorted.length && sorted[linear] < value) linear++;
    assert.equal(lowerBound(sorted, value), linear, `value=${value}`);
  }
});

test('存在しない値でも lowerBound が正しい (n=7)', () => {
  const { sorted } = setup(7, 3107);
  const rng = makeRng(42);
  for (let k = 0; k < 500; k++) {
    const value = sorted[0] + rng() * (sorted[sorted.length - 1] - sorted[0]);
    let linear = 0;
    while (linear < sorted.length && sorted[linear] < value) linear++;
    assert.equal(lowerBound(sorted, value), linear);
  }
});

test('rankOf は 1-indexed で最短が 1 位', () => {
  const { sorted } = setup(6, 3206);
  assert.equal(rankOf(sorted, sorted[0]), 1);
  assert.equal(rankOf(sorted, sorted[sorted.length - 1]), sorted.length);
});

// ---------------------------------------------------------------------------

section('4. 浮動小数の厳密一致 — プレイヤーの経路長が列挙側の値と一致するか');

for (const n of [5, 6, 7, 8]) {
  test(`n=${n} で任意の経路長がソート済み配列に厳密に存在する`, () => {
    const { dist, sorted } = setup(n, 4000 + n);
    const rng = makeRng(n * 77);
    for (let k = 0; k < 200; k++) {
      const order = shuffledOrder(n, rng);
      const length = canonicalPathLength(dist, n, order);
      const at = lowerBound(sorted, length);
      assert.ok(at < sorted.length, '配列の範囲外に落ちた');
      assert.equal(sorted[at], length, `厳密一致しなかった: ${length} vs ${sorted[at]}`);
    }
  });
}

test('正規化しないと一致が壊れうることの確認 (逆順の生の和)', () => {
  // 正規化の必要性そのものを示すテスト。生の和が一致しないケースが実在してよい。
  // ここでは「正規化した値は必ず一致する」ことだけを保証する。
  const n = 8;
  const { dist, sorted } = setup(n, 4808);
  const rng = makeRng(999);
  for (let k = 0; k < 300; k++) {
    const order = shuffledOrder(n, rng);
    const reversed = [...order].reverse();
    assert.equal(
      canonicalPathLength(dist, n, order),
      canonicalPathLength(dist, n, reversed),
      '正規化後は向きによらず同じ値になるはず',
    );
    const at = lowerBound(sorted, canonicalPathLength(dist, n, order));
    assert.equal(sorted[at], canonicalPathLength(dist, n, order));
  }
});

// ---------------------------------------------------------------------------

section('5. 逆順の同一性 — 向きを変えても順位が変わらないか');

test('逆順の経路は同じ順位・同じ判定になる (n=7)', () => {
  const n = 7;
  const { dist, sorted } = setup(n, 5007);
  const rng = makeRng(5150);
  const width = bandWidthFor(4, sorted.length);
  const lo = bandStartFor(rng, sorted.length, width);
  const hi = lo + width - 1;
  for (let k = 0; k < 300; k++) {
    const order = shuffledOrder(n, rng);
    const reversed = [...order].reverse();
    const a = canonicalPathLength(dist, n, order);
    const b = canonicalPathLength(dist, n, reversed);
    assert.equal(a, b);
    assert.equal(rankOf(sorted, a), rankOf(sorted, b));
    assert.equal(judge(sorted, lo, hi, a), judge(sorted, lo, hi, b));
  }
});

// ---------------------------------------------------------------------------

section('6. 出題の可解性 — 帯内の経路が実在し、復元できるか');

// n=9,10 は列挙が重いのでシード数を絞る（それでも全段を必ず1回は通す）
const SEEDS_BY_N = { 5: 40, 6: 40, 7: 25, 8: 12, 9: 4, 10: 2 };

for (const rule of LADDER) {
  const stage = Number.isFinite(rule.upTo) ? rule.upTo : 12;
  const n = rule.n;
  const seedCount = SEEDS_BY_N[n];
  test(`ステージ${stage} (n=${n}) — ${seedCount}シードで帯内の経路を復元できる`, () => {
    for (let s = 0; s < seedCount; s++) {
      const seed = stageSeed(9000 + stage * 131, s);
      const points = generatePoints(n, seed);
      const dist = buildDistanceMatrix(points);
      const sorted = enumerateSortedLengths(dist, n);

      const width = bandWidthFor(stage, sorted.length);
      assert.ok(width >= 1, `帯の幅が 0 になった (stage=${stage})`);
      assert.ok(width <= sorted.length, '帯が全体より広い');

      const rng = makeRng(seed ^ 0x5bf03635);
      const lo = bandStartFor(rng, sorted.length, width);
      const hi = lo + width - 1;
      assert.ok(lo >= 0 && hi < sorted.length, `帯が範囲外 [${lo}, ${hi}]`);

      const center = (lo + hi) >> 1;
      const target = sorted[center];
      const example = findPathByLength(dist, n, target);
      assert.ok(example, `順位 ${center} の経路を復元できなかった`);
      assert.equal(example.length, n, '全点を通っていない');
      assert.equal(new Set(example).size, n, '同じ点を2度通っている');

      const actual = canonicalPathLength(dist, n, example);
      assert.equal(actual, target, '復元した経路の長さが目標と一致しない');
      assert.equal(judge(sorted, lo, hi, actual), JUDGE_IN, '復元した経路が帯に入らない');
    }
  });
}

test('判定は長さの区間で行われ、両端も帯内とみなす (n=6)', () => {
  const n = 6;
  const { dist, sorted } = setup(n, 6006);
  const lo = 100;
  const hi = 150;
  assert.equal(judge(sorted, lo, hi, sorted[lo]), JUDGE_IN);
  assert.equal(judge(sorted, lo, hi, sorted[hi]), JUDGE_IN);
  assert.equal(judge(sorted, lo, hi, sorted[lo - 1]), JUDGE_SHORT);
  assert.equal(judge(sorted, lo, hi, sorted[hi + 1]), JUDGE_LONG);
  assert.equal(judge(sorted, lo, hi, sorted[0]), JUDGE_SHORT);
  assert.equal(judge(sorted, lo, hi, sorted[sorted.length - 1]), JUDGE_LONG);
  // dist を使っていることの確認（未使用変数の警告避けではなく、setup の健全性チェック）
  assert.ok(pathLength(dist, n, [0, 1, 2, 3, 4, 5]) > 0);
});

// ---------------------------------------------------------------------------

section('7. 決定性 — 同じシードで同じ盤面・同じ出題になるか');

test('generatePoints が決定的', () => {
  for (const n of [5, 7, 10]) {
    const a = generatePoints(n, 777);
    const b = generatePoints(n, 777);
    assert.deepEqual(a, b);
    const c = generatePoints(n, 778);
    assert.notDeepEqual(a, c);
  }
});

test('buildStage が決定的', () => {
  for (let stage = 1; stage <= 13; stage++) {
    const a = buildStage(31337, stage);
    const b = buildStage(31337, stage);
    assert.deepEqual(a, b);
    assert.equal(a.n, difficultyFor(stage).n);
    assert.equal(a.points.length, a.n);
  }
});

test('点が最小間隔を守っている', () => {
  for (const n of [5, 6, 7, 8, 9, 10]) {
    for (let seed = 0; seed < 30; seed++) {
      const points = generatePoints(n, seed * 1013 + n);
      assert.equal(points.length, n);
      for (const p of points) {
        assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1, '点が範囲外');
      }
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
          assert.ok(d > 0.02, `点が重なりすぎ (n=${n}, seed=${seed}, d=${d})`);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------

section('8. ヒストグラム — ビン集計の総数が経路数と一致するか');

for (const n of [5, 6, 7, 8]) {
  test(`n=${n} のビン合計が経路数と一致`, () => {
    const { sorted } = setup(n, 8000 + n);
    const { counts, min, max } = histogramBins(sorted, 240);
    let total = 0;
    for (const c of counts) total += c;
    assert.equal(total, sorted.length);
    assert.equal(min, sorted[0]);
    assert.equal(max, sorted[sorted.length - 1]);
    assert.ok(min < max);
  });
}

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
