/**
 * Minimal terminal spinner for long steps (instagrapi setup, login, fetching).
 *
 * Writes to stderr so `--format json|csv` output on stdout stays clean. On a TTY
 * it animates on a single line; otherwise (pipes, CI) or when animation is
 * disabled (`--verbose`, whose logs would interleave) it prints one line per
 * step and skips the in-between updates.
 */
import { color } from './colors';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;
const CLEAR_LINE = '\r\x1b[2K';

export class Spinner {
  private timer?: NodeJS.Timeout;
  private frame = 0;
  private text = '';
  private active = false;
  private animated: boolean;

  constructor(private readonly stream: NodeJS.WriteStream = process.stderr) {
    this.animated = stream.isTTY === true;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Force plain, line-by-line output even on a TTY. */
  setAnimated(animated: boolean): void {
    this.animated = animated && this.stream.isTTY === true;
  }

  start(text: string): void {
    this.stop();
    this.text = text;
    this.active = true;
    if (!this.animated) {
      this.stream.write(`${text}…\n`);
      return;
    }
    this.render();
    this.timer = setInterval(() => this.render(), INTERVAL_MS);
  }

  /** Change the text of the running spinner (e.g. a live count). */
  update(text: string): void {
    if (!this.active) return;
    this.text = text;
  }

  /** Erase the spinner line, e.g. before prompting or printing an error. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.animated) this.stream.write(CLEAR_LINE);
  }

  /** Stop and leave a ✔ line behind. */
  succeed(text: string = this.text): void {
    this.stop();
    this.stream.write(`${color.green('✔')} ${text}\n`);
  }

  private render(): void {
    const frame = FRAMES[this.frame++ % FRAMES.length];
    this.stream.write(`${CLEAR_LINE}${color.cyan(frame)} ${this.text}`);
  }
}

/** Shared spinner for the CLI's progress. */
export const spinner = new Spinner();
