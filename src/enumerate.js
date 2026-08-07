/**
 * 全ハミルトン経路の列挙と順位付け。
 *
 * n 点を1度ずつ通る「開いた」経路は n! 通りあるが、逆順は同じ経路なので
 * order[0] < order[n-1] を満たす向きだけを残して n!/2 件を扱う。
 *
 * このモジュールは DOM にも Worker API にも依存しないので、
 * ブラウザの Worker からも Node のテストからもそのまま import できる。
 */

/** 浮動小数の一致を保証するため、経路長は必ずこの向きで足す。 */
export function canonicalOrder(order) {
  return order[0] <= order[order.length - 1] ? order : Array.from(order).reverse();
}

/**
 * 点は [0,1]^2 で持つが、そのままだと経路長が 2〜6 程度になって
 * 画面上で読みにくい。盤面を 100 四方とみなして距離を測る。
 */
export const BOARD_SCALE = 100;

export function buildDistanceMatrix(points) {
  const n = points.length;
  const dist = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      dist[i * n + j] = Math.hypot(
        (points[i].x - points[j].x) * BOARD_SCALE,
        (points[i].y - points[j].y) * BOARD_SCALE,
      );
    }
  }
  return dist;
}

/**
 * 与えられた向きのまま足す。列挙側と足す順序を揃えるのが目的。
 * order が途中までの経路でもそのまま使える（stride は n のまま）。
 */
export function pathLength(dist, n, order) {
  let total = 0;
  for (let i = 0; i + 1 < order.length; i++) total += dist[order[i] * n + order[i + 1]];
  return total;
}

/**
 * プレイヤーが引いた経路の長さ。正規形に直してから足すので、
 * 列挙側が同じ経路について記録した値とビット単位で一致する。
 */
export function canonicalPathLength(dist, n, order) {
  return pathLength(dist, n, canonicalOrder(order));
}

export function factorial(n) {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

/** n 点の全経路数（逆順を同一視したあと）。 */
export function pathCount(n) {
  return n < 2 ? 1 : factorial(n) / 2;
}

/**
 * Heap's algorithm で全順列を回し、正規形のものだけ長さを記録してソートする。
 * visit(order) を渡すと各正規形について呼ばれる（true を返すと打ち切り）。
 */
function walkCanonicalPermutations(n, visit) {
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const counters = new Int32Array(n);

  if (order[0] <= order[n - 1] && visit(order)) return;

  let i = 1;
  while (i < n) {
    if (counters[i] < i) {
      const k = i & 1 ? counters[i] : 0;
      const swap = order[k];
      order[k] = order[i];
      order[i] = swap;
      if (order[0] <= order[n - 1] && visit(order)) return;
      counters[i]++;
      i = 1;
    } else {
      counters[i] = 0;
      i++;
    }
  }
}

/** 全経路長を昇順ソートした Float64Array を返す。 */
export function enumerateSortedLengths(dist, n) {
  const lengths = new Float64Array(pathCount(n));
  let count = 0;
  walkCanonicalPermutations(n, (order) => {
    lengths[count++] = pathLength(dist, n, order);
    return false;
  });
  lengths.sort();
  return lengths;
}

/**
 * 指定した長さちょうどの経路を1つ復元する。列挙時と同じ足し方をするので
 * ソート済み配列から取り出した値と厳密に一致する要素が必ず見つかる。
 */
export function findPathByLength(dist, n, targetLength) {
  let found = null;
  walkCanonicalPermutations(n, (order) => {
    if (pathLength(dist, n, order) === targetLength) {
      found = Array.from(order);
      return true;
    }
    return false;
  });
  return found;
}

/** ヒストグラム用のビン集計。 */
export function histogramBins(sortedLengths, binCount = 240) {
  const min = sortedLengths[0];
  const max = sortedLengths[sortedLengths.length - 1];
  const counts = new Uint32Array(binCount);
  const span = max - min;
  if (span <= 0) {
    counts[0] = sortedLengths.length;
    return { counts, min, max };
  }
  const scale = binCount / span;
  for (let i = 0; i < sortedLengths.length; i++) {
    let bin = ((sortedLengths[i] - min) * scale) | 0;
    if (bin >= binCount) bin = binCount - 1;
    counts[bin]++;
  }
  return { counts, min, max };
}

/** value 以上が現れる最初の位置（0-indexed）。 */
export function lowerBound(sortedLengths, value) {
  let lo = 0;
  let hi = sortedLengths.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedLengths[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 表示用の順位（1-indexed）。 */
export function rankOf(sortedLengths, value) {
  return lowerBound(sortedLengths, value) + 1;
}

export const JUDGE_IN = 'in';
export const JUDGE_SHORT = 'short';
export const JUDGE_LONG = 'long';

/**
 * 順位ではなく長さの区間で判定する。同じ長さの経路が複数あっても
 * 判定がぶれないので、こちらが正しい判定方法。
 * lo / hi は目標帯の 0-indexed な両端。
 */
export function judge(sortedLengths, lo, hi, length) {
  if (length < sortedLengths[lo]) return JUDGE_SHORT;
  if (length > sortedLengths[hi]) return JUDGE_LONG;
  return JUDGE_IN;
}
