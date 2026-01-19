/**
 * Color and theme utilities for insta-who-unfollowed-me
 */

/**
 * Available themes
 */
export enum Theme {
  LIGHT = 'light',
  DARK = 'dark',
  NONE = 'none',
}

/**
 * Color codes for terminal output
 */
export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',
  hidden: '\x1b[8m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[40m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
} as const;

/**
 * Color utility class
 */
export class Color {
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  /**
   * Apply color to text
   */
  private colorize(text: string, color: string): string {
    if (!this.enabled) return text;
    return `${color}${text}${colors.reset}`;
  }

  /**
   * Red text (for errors)
   */
  red(text: string): string {
    return this.colorize(text, colors.red);
  }

  /**
   * Green text (for success)
   */
  green(text: string): string {
    return this.colorize(text, colors.green);
  }

  /**
   * Yellow text (for warnings)
   */
  yellow(text: string): string {
    return this.colorize(text, colors.yellow);
  }

  /**
   * Blue text (for info)
   */
  blue(text: string): string {
    return this.colorize(text, colors.blue);
  }

  /**
   * Magenta text (for highlights)
   */
  magenta(text: string): string {
    return this.colorize(text, colors.magenta);
  }

  /**
   * Cyan text (for headers)
   */
  cyan(text: string): string {
    return this.colorize(text, colors.cyan);
  }

  /**
   * Bright text
   */
  bright(text: string): string {
    return this.colorize(text, colors.bright);
  }

  /**
   * Dim text
   */
  dim(text: string): string {
    return this.colorize(text, colors.dim);
  }

  /**
   * Enable/disable colors
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

/**
 * Global color instance
 */
export const color = new Color();

/**
 * Disable colors (for non-color terminals or piping)
 */
export function disableColors(): void {
  color.setEnabled(false);
}

/**
 * Enable colors
 */
export function enableColors(): void {
  color.setEnabled(true);
}

/**
 * Check if colors are supported
 */
export function areColorsSupported(): boolean {
  // Check if we're in a TTY
  if (process.stdout.isTTY === false) {
    return false;
  }

  // Check CI environment
  if (process.env.CI) {
    return false;
  }

  // Check NO_COLOR environment variable
  if (process.env.NO_COLOR) {
    return false;
  }

  return true;
}

/**
 * Initialize colors based on environment
 */
export function initColors(forceEnabled?: boolean): void {
  if (forceEnabled !== undefined) {
    color.setEnabled(forceEnabled);
  } else {
    color.setEnabled(areColorsSupported());
  }
}
