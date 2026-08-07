/**
 * 画面の組み立てと進行。重い列挙は Worker に投げ、判定と描画はここで行う。
 */

import { BoardView } from './board.js';
import { HistogramView } from './histogram.js';
import { Sound } from './audio.js';
import {
  START_SECONDS,
  Run,
  WRONG_PENALTY,
  comboMultiplier,
  formatDuration,
  formatTime,
  loadBest,
  newRunSeed,
  saveBest,
  scoreFor,
} from './game.js';
import {
  bonusSecondsFor,
  buildStage,
  makeRng,
  placementFor,
  windowRatioFor,
} from './generator.js';
import {
  JUDGE_IN,
  JUDGE_LONG,
  buildBand,
  buildDistanceMatrix,
  canonicalPathLength,
  enumerateSortedLengths,
  findPathByLength,
  histogramBins,
  judge,
  pathLength,
} from './enumerate.js';

const $ = (id) => document.getElementById(id);

const el = {
  stage: $('hud-stage'),
  time: $('hud-time'),
  timebar: $('timebar-fill'),
  score: $('hud-score'),
  questBand: $('quest-band'),
  board: $('board'),
  boardHint: $('board-hint'),
  histFull: $('hist-full'),
  distNow: $('dist-now'),
  zoomHint: $('zoom-hint'),
  btnUndo: $('btn-undo'),
  btnClear: $('btn-clear'),
  btnSubmit: $('btn-submit'),
  btnSound: $('btn-sound'),
  screenTitle: $('screen-title'),
  screenJudge: $('screen-judge'),
  screenResult: $('screen-result'),
  screenLoading: $('screen-loading'),
  loadingText: $('loading-text'),
  judgeVerdict: $('judge-verdict'),
  judgeTime: $('judge-time'),
  judgeGain: $('judge-gain'),
  btnNext: $('btn-next'),
  btnStart: $('btn-start'),
  btnRetry: $('btn-retry'),
  resultScore: $('result-score'),
  resultMeta: $('result-meta'),
  resultBest: $('result-best'),
  btnShare: $('btn-share'),
};

const board = new BoardView(el.board);
const histogram = new HistogramView(el.histFull);
const sound = new Sound();

const state = {
  run: null,
  stage: null,
  sorted: null,
  dist: null,
  bandLo: 0,
  bandHi: 0,
  bandMin: 0,
  bandMax: 0,
  windowRatio: 0,
  order: [],
  phase: 'title',
  requestId: 0,
};

const number = new Intl.NumberFormat('ja-JP');

// ---------------------------------------------------------------------------
// 計算エンジン。Worker が使えない環境ではメインスレッドに落とす。
// ---------------------------------------------------------------------------

function factorialHalf(n) {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f / 2;
}

/**
 * ビンの数。経路数が少ないうちに 240 本も刻むと空のビンだらけで
 * 分布の形が見えなくなるので、経路数に合わせて粗くする。
 */
function binCountFor(total) {
  return Math.min(240, Math.max(24, Math.round(Math.sqrt(total) * 1.5)));
}

/** Worker が使えない/落ちた場合に使う、メインスレッドで走る実装。 */
const fallback = {
  prepare(points) {
    return new Promise((resolve) => {
      // 1フレーム譲ってローディング表示を出してから走らせる
      setTimeout(() => {
        const dist = buildDistanceMatrix(points);
        const lengths = enumerateSortedLengths(dist, points.length);
        const bins = histogramBins(lengths, binCountFor(lengths.length));
        resolve({ lengths, dist, binCounts: bins.counts, min: bins.min, max: bins.max });
      }, 30);
    });
  },
  reveal(points, targetLength) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const dist = buildDistanceMatrix(points);
        resolve(findPathByLength(dist, points.length, targetLength));
      }, 30);
    });
  },
};

function createEngine() {
  let worker = null;
  try {
    worker = new Worker(new URL('./enumerate.worker.js', import.meta.url), { type: 'module' });
  } catch (err) {
    console.warn('Worker を作れませんでした。メインスレッドで計算します。', err);
    return fallback;
  }

  let broken = false;
  let nextId = 1;
  const pending = new Map();

  const viaFallback = (entry) => (entry.kind === 'prepare'
    ? fallback.prepare(entry.points)
    : fallback.reveal(entry.points, entry.targetLength).then((order) => ({ order })));

  const giveUp = (reason) => {
    if (broken) return;
    broken = true;
    console.warn('Worker が使えないのでメインスレッドに切り替えます。', reason);
    for (const [, entry] of pending) viaFallback(entry).then(entry.resolve);
    pending.clear();
  };

  worker.onmessage = (event) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    entry.resolve(event.data);
  };
  worker.onerror = (event) => {
    event.preventDefault?.();
    giveUp(event.message || event);
  };
  worker.onmessageerror = () => giveUp('messageerror');

  const send = (message, entry) => new Promise((resolve) => {
    if (broken) {
      viaFallback(entry).then(resolve);
      return;
    }
    const id = nextId++;
    pending.set(id, { ...entry, resolve });
    worker.postMessage({ ...message, id });
    // 起動に失敗しても onerror が来ないケースがあるので保険をかける
    setTimeout(() => {
      if (pending.has(id)) giveUp('タイムアウト');
    }, 6000);
  });

  return {
    prepare: (points) =>
      send(
        { type: 'prepare', points, binCount: binCountFor(factorialHalf(points.length)) },
        { kind: 'prepare', points },
      ),
    reveal: (points, targetLength) =>
      send({ type: 'reveal', points, targetLength }, { kind: 'reveal', points, targetLength })
        .then((m) => m.order),
  };
}

// fallback の定義より後で作る必要がある（createEngine が参照するため）
const engine = createEngine();

// ---------------------------------------------------------------------------
// 画面
// ---------------------------------------------------------------------------

function show(screen) {
  for (const s of [el.screenTitle, el.screenJudge, el.screenResult, el.screenLoading]) {
    s.classList.toggle('visible', s === screen);
  }
}

function hideScreens() {
  show(null);
}

function renderHud() {
  const run = state.run;
  el.stage.textContent = run ? run.stage : 1;
  el.score.textContent = number.format(run ? run.score : 0);
  renderTime();
}

function renderTime() {
  const seconds = state.run ? state.run.time : START_SECONDS;
  el.time.textContent = formatTime(seconds);
  const level = seconds < 10 ? 'danger' : seconds < 25 ? 'warn' : '';
  el.time.className = `hud-time ${level}`;
  el.timebar.className = `timebar-fill ${level}`;
  el.timebar.style.width = `${Math.max(0, Math.min(1, seconds / START_SECONDS)) * 100}%`;
}

// ---------------------------------------------------------------------------
// ステージ
// ---------------------------------------------------------------------------

async function startStage() {
  const run = state.run;
  const stage = buildStage(run.seed, run.stage);
  state.stage = stage;
  state.order = [];
  state.phase = 'loading';
  board.setStage(stage.points);
  histogram.clear();
  el.distNow.textContent = '—';
  el.zoomHint.textContent = '';
  el.zoomHint.className = 'zoom-hint';
  el.btnSubmit.disabled = true;
  renderHud();

  const requestId = ++state.requestId;
  const slowTimer = setTimeout(() => {
    if (state.requestId === requestId && state.phase === 'loading') {
      el.loadingText.textContent = `${number.format(factorialHalf(stage.n))} 通りの経路を数えています…`;
      show(el.screenLoading);
    }
  }, 140);

  const result = await engine.prepare(stage.points);
  clearTimeout(slowTimer);
  if (state.requestId !== requestId) return;

  state.sorted = result.lengths;
  state.dist = result.dist;

  const total = state.sorted.length;
  state.windowRatio = windowRatioFor(run.stage);
  const rng = makeRng((stage.seed ^ 0x5bf03635) >>> 0);
  const band = buildBand(state.sorted, state.windowRatio, rng, placementFor(run.stage));
  state.bandLo = band.lo;
  state.bandHi = band.hi;
  state.bandMin = state.sorted[band.lo];
  state.bandMax = state.sorted[band.hi];

  histogram.setData({
    sorted: state.sorted,
    binCounts: result.binCounts,
    min: result.min,
    max: result.max,
    bandLo: state.bandLo,
    bandHi: state.bandHi,
  });

  el.questBand.textContent = `第 ${number.format(state.bandLo + 1)} 〜 ${number.format(state.bandHi + 1)} 位`;
  // 近い点から順につなぐのが本能なので、序盤は「わざと遠回りする」と明示的に伝える
  el.boardHint.textContent = run.stage === 1
    ? '点を順につないで経路をつくる'
    : '最短につなぐと帯より短くなりがち。わざと遠回りを';
  el.boardHint.classList.toggle('hidden', run.stage > 4);

  state.phase = 'playing';
  hideScreens();
  refreshPath();
}

function refreshPath() {
  const { stage, order, dist } = state;
  board.setOrder(order);
  const complete = order.length === stage.n;

  if (order.length >= 2) {
    // 確定したときだけ正規化する。列挙側とビット単位で一致させる必要があるのは
    // 判定に使う値だけで、途中経過は表示専用。
    const length = complete
      ? canonicalPathLength(dist, stage.n, order)
      : pathLength(dist, stage.n, order);
    el.distNow.textContent = complete ? length.toFixed(2) : `${length.toFixed(2)}…`;
    el.distNow.style.opacity = complete ? '1' : '0.65';
    histogram.setCurrent(length, complete);
  } else {
    el.distNow.textContent = '—';
    el.distNow.style.opacity = '0.5';
    histogram.setCurrent(null);
  }

  // 帯は細くなると線として見づらいので、位置関係は文字でも伝える
  const status = histogram.status;
  if (!complete) {
    el.zoomHint.textContent = `${order.length} / ${stage.n} 点`;
    el.zoomHint.className = 'zoom-hint';
  } else if (status === 'short') {
    el.zoomHint.textContent = 'もっと長い経路に →';
    el.zoomHint.className = 'zoom-hint short';
  } else if (status === 'long') {
    el.zoomHint.textContent = '← もっと短い経路に';
    el.zoomHint.className = 'zoom-hint long';
  } else {
    el.zoomHint.textContent = '● 帯の中';
    el.zoomHint.className = 'zoom-hint in';
  }

  const playable = state.phase === 'playing';
  el.btnSubmit.disabled = !complete || !playable;
  el.btnUndo.disabled = order.length === 0 || !playable;
  el.btnClear.disabled = order.length === 0 || !playable;
}

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

async function submit() {
  if (state.phase !== 'playing') return;
  const { stage, order, dist, sorted, bandLo, bandHi } = state;
  if (order.length !== stage.n) return;

  state.phase = 'judged';
  el.btnSubmit.disabled = true;
  el.btnUndo.disabled = true;
  el.btnClear.disabled = true;

  const length = canonicalPathLength(dist, stage.n, order);
  const verdict = judge(sorted, bandLo, bandHi, length);
  const run = state.run;

  let gain = 0;
  let seconds = 0;
  if (verdict === JUDGE_IN) {
    gain = scoreFor({
      n: stage.n,
      windowRatio: state.windowRatio,
      length,
      bandMin: state.bandMin,
      bandMax: state.bandMax,
      combo: run.combo,
    });
    seconds = bonusSecondsFor(run.stage);
    run.succeed(gain, stage.n, seconds);
    sound.success();
  } else {
    seconds = -WRONG_PENALTY;
    run.fail();
    sound.fail();
  }

  renderHud();
  showJudge(verdict, gain, seconds);

  if (verdict !== JUDGE_IN) {
    const center = (bandLo + bandHi) >> 1;
    const requestId = state.requestId;
    const example = await engine.reveal(stage.points, sorted[center]);
    if (state.requestId === requestId && example) board.setGhost(example);
  }
}

function showJudge(verdict, gain, seconds) {
  const inBand = verdict === JUDGE_IN;
  el.judgeVerdict.className = `judge-verdict ${verdict}`;
  el.judgeVerdict.innerHTML = inBand
    ? '良かったこの距離で'
    : `そこは・・・<span class="miss">${verdict === JUDGE_LONG ? '長すぎる' : '短すぎる'}</span>`;

  el.judgeTime.className = `judge-time ${seconds >= 0 ? 'plus' : 'minus'}`;
  el.judgeTime.textContent = `${seconds >= 0 ? '+' : '−'}${Math.abs(seconds)} 秒`;

  if (inBand) {
    const multiplier = comboMultiplier(state.run.combo - 1);
    el.judgeGain.textContent =
      `+${number.format(gain)}` + (state.run.combo > 1 ? `　(×${multiplier.toFixed(1)} コンボ)` : '');
    el.judgeGain.style.color = 'var(--good)';
  } else {
    el.judgeGain.textContent = '正解例';
    el.judgeGain.style.color = 'var(--text-faint)';
  }

  el.btnNext.textContent = state.run.isOver ? '結果を見る' : '次へ';
  show(el.screenJudge);
}

function next() {
  board.clearGhost();
  if (state.run.isOver) {
    showResult();
  } else {
    state.run.advance();
    startStage();
  }
}

// ---------------------------------------------------------------------------
// リザルト
// ---------------------------------------------------------------------------

function showResult() {
  const run = state.run;
  state.phase = 'result';
  state.requestId++; // 進行中の正解例リクエストを打ち切る
  board.clearGhost();
  sound.gameover();
  const isBest = saveBest(run.score);

  el.resultScore.textContent = number.format(run.score);
  el.resultMeta.textContent = `${run.cleared} 問正解 ・ 生存 ${formatDuration(run.elapsed)}`;
  const best = loadBest();
  el.resultBest.textContent = isBest ? '自己ベスト更新' : best > 0 ? `自己ベスト ${number.format(best)}` : '';

  const url = location.origin + location.pathname;
  const text =
    '良かったこの距離で\n' +
    `SCORE ${number.format(run.score)} / ${run.cleared}問正解` +
    (run.maxN ? ` (n=${run.maxN})` : '') +
    `\n生存 ${formatDuration(run.elapsed)}\n#良かったこの距離で`;
  el.btnShare.href =
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

  renderTime();
  show(el.screenResult);
}

// ---------------------------------------------------------------------------
// 入力
// ---------------------------------------------------------------------------

el.board.addEventListener('pointerdown', (event) => {
  if (state.phase !== 'playing') return;
  sound.unlock();
  event.preventDefault();
  const rect = el.board.getBoundingClientRect();
  const index = board.hitTest(event.clientX - rect.left, event.clientY - rect.top);
  if (index == null) return;

  el.boardHint.classList.add('hidden');
  const at = state.order.indexOf(index);
  if (at === -1) {
    if (state.order.length >= state.stage.n) return;
    state.order.push(index);
    sound.connect(state.order.length - 1, state.stage.n);
  } else if (at === state.order.length - 1) {
    state.order.pop();
    sound.undo();
  } else {
    return; // 経路の途中の点は動かせない
  }
  refreshPath();
});

el.btnUndo.addEventListener('click', () => {
  if (state.phase !== 'playing' || !state.order.length) return;
  sound.unlock();
  state.order.pop();
  sound.undo();
  refreshPath();
});

el.btnClear.addEventListener('click', () => {
  if (state.phase !== 'playing' || !state.order.length) return;
  sound.unlock();
  state.order = [];
  sound.clear();
  refreshPath();
});

el.btnSubmit.addEventListener('click', () => {
  sound.unlock();
  submit();
});

el.btnNext.addEventListener('click', () => {
  hideScreens();
  next();
});

el.btnStart.addEventListener('click', () => {
  sound.unlock();
  startRun();
});

el.btnRetry.addEventListener('click', () => {
  sound.unlock();
  startRun();
});

el.btnSound.addEventListener('click', () => {
  const on = sound.toggle();
  el.btnSound.classList.toggle('muted', !on);
});

function startRun() {
  state.run = new Run(newRunSeed());
  board.clearGhost();
  hideScreens();
  renderHud();
  startStage();
}

// ---------------------------------------------------------------------------
// ループ
// ---------------------------------------------------------------------------

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(60, now - lastFrame);
  lastFrame = now;

  // 時間が減るのはプレイ中だけ。判定画面や計算待ちでは止まる。
  if (state.phase === 'playing' && state.run) {
    state.run.tick(dt / 1000);
    renderTime();
    if (state.run.isOver) showResult();
  }

  board.step(dt);
  board.render();
  histogram.render();
  requestAnimationFrame(frame);
}

const observer = new ResizeObserver(() => {
  board.resize();
  histogram.resize();
});
observer.observe(document.getElementById('app'));
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    board.resize();
    histogram.resize();
  }, 120);
});

el.btnSound.classList.toggle('muted', !sound.enabled);
renderHud();
show(el.screenTitle);
requestAnimationFrame(frame);
