/**
 * 効果音。外部音源を一切使わず WebAudio で合成する。
 * AudioContext はユーザー操作の中でしか作れないので unlock() を最初の入力で呼ぶ。
 */

const STORAGE_KEY = 'ykkd.sound';

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
  }

  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
    }
    // 入力のたびに resume() を積み上げないよう、進行中は待つ
    if (this.ctx.state === 'suspended' && !this.resuming) {
      this.resuming = true;
      this.ctx.resume().catch(() => {}).finally(() => { this.resuming = false; });
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem(STORAGE_KEY, this.enabled ? 'on' : 'off');
    if (this.enabled) this.unlock();
    return this.enabled;
  }

  #tone({ freq, start = 0, duration = 0.12, type = 'sine', gain = 0.16, slideTo = null }) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime + start;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(amp).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** 点をつなぐ音。進むほど音程が上がる。 */
  connect(step, total) {
    const ratio = total > 1 ? step / (total - 1) : 0;
    this.#tone({ freq: 320 + ratio * 320, duration: 0.09, type: 'triangle', gain: 0.11 });
  }

  undo() {
    this.#tone({ freq: 240, slideTo: 170, duration: 0.1, type: 'triangle', gain: 0.09 });
  }

  clear() {
    this.#tone({ freq: 200, slideTo: 120, duration: 0.16, type: 'sawtooth', gain: 0.07 });
  }

  /** 成功。長三和音の上行アルペジオ。 */
  success() {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      this.#tone({ freq, start: i * 0.075, duration: 0.3, type: 'sine', gain: 0.15 });
    });
  }

  /** 失敗。短く落ちる。 */
  fail() {
    this.#tone({ freq: 300, slideTo: 110, duration: 0.34, type: 'sawtooth', gain: 0.1 });
    this.#tone({ freq: 149, duration: 0.34, type: 'square', gain: 0.05 });
  }

  gameover() {
    [392, 349.23, 293.66, 196].forEach((freq, i) => {
      this.#tone({ freq, start: i * 0.16, duration: 0.5, type: 'triangle', gain: 0.13 });
    });
  }
}
