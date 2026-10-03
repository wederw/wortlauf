// Playback: shows one token after another for its computed duration and feeds playback
// events to the scripts' flow hooks. Knows nothing about rendering.

const SENTENCE_END = 1;
const PARA_END = 2;
const CHAPTER_END = 4;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Player {
  /**
   * @param {object} options
   * @param {(event: object) => Promise<object[]>} options.flow  resolves to validated actions
   * @param {(index: number) => void} options.onToken
   * @param {(state: {playing: boolean, message: string}) => void} options.onState
   * @param {(wpm: number) => void} options.onWpm
   * @param {(text: string) => void} options.onNotify
   */
  constructor(options) {
    Object.assign(this, options);
    this.tokens = [];
    this.ms = new Float32Array(0);
    this.index = 0;
    this.playing = false;
    this.wpm = 300;
    this.activeMs = 0;
    this.words = 0;
    this.pauses = 0;
    this.started = false;
    this.from = 0;
    this._run = 0;
    this._ramp = null;
    this._wake = null;
    this._jumped = false;
  }

  /** A wait that seek() and pause() can cut short. */
  _sleep(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this._wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  load(tokens, ms, index) {
    this.tokens = tokens;
    this.ms = ms;
    this.index = Math.min(Math.max(index, 0), Math.max(tokens.length - 1, 0));
  }

  get session() {
    return { words: Math.round(this.words), activeMs: Math.round(this.activeMs), pauses: this.pauses, from: this.from, to: this.index, wpm: this.wpm };
  }

  _event(type) {
    return { type, index: this.index, total: this.tokens.length, flags: this.tokens[this.index]?.flags ?? 0, activeMs: Math.round(this.activeMs), words: Math.round(this.words), wpm: this.wpm };
  }

  async _ask(type) {
    try {
      return await Promise.race([this.flow(this._event(type)), wait(80).then(() => [])]);
    } catch {
      return [];
    }
  }

  /** Applies actions; returns true when playback should stop. */
  _apply(actions) {
    let stop = false;
    for (const action of actions) {
      if (action.type === 'pause') {
        this.pause(action.message);
        stop = true;
      } else if (action.type === 'speed') {
        this._ramp = { factor: action.factor, total: action.tokens, left: action.tokens };
      } else if (action.type === 'rewind') {
        this.seek(Math.max(this._sentenceFloor(), this.index - action.tokens));
      } else if (action.type === 'setWpm') {
        this.onWpm(action.value);
      } else if (action.type === 'notify') {
        this.onNotify(action.message);
      }
    }
    return stop;
  }

  /** Rewinding never crosses back over a paragraph boundary. */
  _sentenceFloor() {
    let i = this.index;
    while (i > 0 && !(this.tokens[i - 1].flags & PARA_END)) i--;
    return i;
  }

  _speed() {
    if (!this._ramp) return 1;
    const { factor, total, left } = this._ramp;
    const speed = factor + (1 - factor) * (1 - left / total);
    if (--this._ramp.left <= 0) this._ramp = null;
    return speed;
  }

  async play() {
    if (this.playing || this.tokens.length === 0) return;
    if (this.index >= this.tokens.length - 1) this.index = 0;
    this.playing = true;
    const run = ++this._run;
    this.onState({ playing: true, message: '' });
    const first = !this.started;
    if (first) this.from = this.index;
    this.started = true;
    if (this._apply(await this._ask(first ? 'start' : 'resume')) || run !== this._run) return;

    let lastTick = this.activeMs;
    while (this.playing && run === this._run) {
      const token = this.tokens[this.index];
      this.onToken(this.index);
      const boundary = token.flags & CHAPTER_END ? 'chapterEnd' : token.flags & PARA_END ? 'paragraphEnd' : token.flags & SENTENCE_END ? 'sentenceEnd' : null;
      const verdict = boundary ? this._ask(boundary) : null;
      const shownAt = performance.now();
      this._jumped = false;
      await this._sleep(this.ms[this.index] / this._speed());
      if (run !== this._run) return;
      this.activeMs += performance.now() - shownAt;
      if (this._jumped) continue; // the reader moved elsewhere: show that token next
      this.words += token.words;

      if (this.index >= this.tokens.length - 1) {
        this.pause('Ende des Textes');
        return;
      }
      this.index++;
      if (verdict && this._apply(await verdict)) return;
      if (this.activeMs - lastTick >= 1000) {
        lastTick = this.activeMs;
        this._ask('tick').then((actions) => run === this._run && this._apply(actions));
      }
    }
  }

  pause(message = '') {
    if (!this.playing) return;
    this.playing = false;
    this._run++;
    this._ramp = null;
    this._wake?.();
    this.pauses++;
    this.onToken(this.index);
    this.onState({ playing: false, message });
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(index) {
    this.index = Math.min(Math.max(index, 0), this.tokens.length - 1);
    this._jumped = true;
    this._wake?.();
    this.onToken(this.index);
  }

  /** Start of the current unit, or of the previous one when already at the start. */
  _unitStart(flag, from) {
    let i = from;
    while (i > 0 && !(this.tokens[i - 1].flags & flag)) i--;
    return i;
  }

  back(flag = SENTENCE_END) {
    const start = this._unitStart(flag, this.index);
    const nearStart = this.index - start <= (this.playing ? 2 : 0);
    this.seek(nearStart && start > 0 ? this._unitStart(flag, start - 1) : start);
  }

  forward(flag = SENTENCE_END) {
    let i = this.index;
    while (i < this.tokens.length - 1 && !(this.tokens[i].flags & flag)) i++;
    this.seek(Math.min(i + 1, this.tokens.length - 1));
  }
}

export const UNIT = { SENTENCE: SENTENCE_END, PARAGRAPH: PARA_END, CHAPTER: CHAPTER_END };
