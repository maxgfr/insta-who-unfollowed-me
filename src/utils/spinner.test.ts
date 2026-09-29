import { Spinner } from './spinner';
import { initColors } from './colors';

beforeAll(() => initColors(false));
afterAll(() => initColors());

/** A write stream double that records everything written to it. */
function fakeStream(isTTY: boolean): NodeJS.WriteStream & { output: string } {
  const stream = {
    isTTY,
    output: '',
    write(chunk: string) {
      stream.output += chunk;
      return true;
    },
  };
  return stream as unknown as NodeJS.WriteStream & { output: string };
}

describe('Spinner', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('animates on a TTY and redraws with the updated text', () => {
    const stream = fakeStream(true);
    const spinner = new Spinner(stream);

    spinner.start('Logging in');
    expect(stream.output).toContain('Logging in');

    spinner.update('Fetching followers… 200');
    jest.advanceTimersByTime(100);
    expect(stream.output).toContain('Fetching followers… 200');
    expect(stream.output).toContain('\r\x1b[2K'); // line cleared before redraw

    spinner.succeed('Fetched 200 followers');
    expect(stream.output.endsWith('Fetched 200 followers\n')).toBe(true);
    expect(spinner.isActive).toBe(false);
  });

  it('stop() erases the line so a prompt can take over', () => {
    const stream = fakeStream(true);
    const spinner = new Spinner(stream);
    spinner.start('Logging in');
    stream.output = '';

    spinner.stop();

    expect(stream.output).toBe('\r\x1b[2K');
    jest.advanceTimersByTime(500);
    expect(stream.output).toBe('\r\x1b[2K'); // no more frames once stopped
  });

  it('prints plain lines without a TTY, and skips noisy updates', () => {
    const stream = fakeStream(false);
    const spinner = new Spinner(stream);

    spinner.start('Logging in');
    spinner.update('Fetching followers… 200');
    jest.advanceTimersByTime(500);
    spinner.succeed('Done');

    expect(stream.output).toBe('Logging in…\n✔ Done\n');
  });

  it('can be forced into plain mode (e.g. --verbose, where logs interleave)', () => {
    const stream = fakeStream(true);
    const spinner = new Spinner(stream);
    spinner.setAnimated(false);

    spinner.start('Logging in');
    jest.advanceTimersByTime(500);

    expect(stream.output).toBe('Logging in…\n');
  });

  it('ignores update/stop when idle', () => {
    const stream = fakeStream(true);
    const spinner = new Spinner(stream);
    spinner.update('nothing');
    spinner.stop();
    expect(stream.output).toBe('');
  });
});
