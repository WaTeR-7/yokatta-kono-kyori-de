/**
 * 重い全列挙を UI スレッドから切り離すための Worker。
 *
 * n=10 で列挙 52ms + ソート 175ms 程度。メインスレッドでやると
 * 出題のたびに画面が固まるので、ここに閉じ込めている。
 */

import {
  buildDistanceMatrix,
  enumerateSortedLengths,
  findPathByLength,
  histogramBins,
} from './enumerate.js';

self.onmessage = (event) => {
  const msg = event.data;

  if (msg.type === 'prepare') {
    const started = performance.now();
    const dist = buildDistanceMatrix(msg.points);
    const lengths = enumerateSortedLengths(dist, msg.points.length);
    const bins = histogramBins(lengths, msg.binCount || 240);

    // lengths は n=10 で 13.8MB あるので転送（zero-copy）。
    // dist も転送する。メイン側が同じ行列で足さないと経路長がビット単位で
    // 一致せず、順位が 1 つずれる。
    self.postMessage(
      {
        type: 'ready',
        id: msg.id,
        lengths,
        dist,
        binCounts: bins.counts,
        min: bins.min,
        max: bins.max,
        elapsed: performance.now() - started,
      },
      [lengths.buffer, dist.buffer, bins.counts.buffer],
    );
    return;
  }

  if (msg.type === 'reveal') {
    // 正解例の復元。列挙をもう一度回すが n=10 でも 52ms 程度。
    const dist = buildDistanceMatrix(msg.points);
    const order = findPathByLength(dist, msg.points.length, msg.targetLength);
    self.postMessage({ type: 'revealed', id: msg.id, order });
    return;
  }
};
