/**
 * Custom types and error classes for insta-who-unfollowed-me
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
 * Error types for Instagram operations
 */
export enum InstagramErrorType {
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  RATE_LIMITED = 'RATE_LIMITED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  CHALLENGE_REQUIRED = 'CHALLENGE_REQUIRED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Custom error class for Instagram-related errors
 */
export class InstagramError extends Error {
  constructor(
    message: string,
    public type: InstagramErrorType,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'InstagramError';
    Object.setPrototypeOf(this, InstagramError.prototype);
  }

  /**
   * Map an instagram-private-api error class name to an InstagramErrorType.
   * Returns undefined for unrecognized names so the caller can fall back to
   * message-based heuristics.
   */
  static typeFromErrorName(name: string): InstagramErrorType | undefined {
    switch (name) {
      case 'IgCheckpointError':
      case 'IgChallengeWrongCodeError':
      case 'IgLoginTwoFactorRequiredError':
        // 2FA sits in this group so it is never retried as a plain login
        // failure: each retry fires another login attempt (and another push
        // prompt on the user's phone).
        return InstagramErrorType.CHALLENGE_REQUIRED;
      case 'IgLoginBadPasswordError':
      case 'IgLoginInvalidUserError':
        return InstagramErrorType.INVALID_CREDENTIALS;
      case 'IgLoginRequiredError':
        return InstagramErrorType.AUTHENTICATION_FAILED;
      default:
        return undefined;
    }
  }

  /**
   * Create an InstagramError from a generic error
   */
  static fromError(error: unknown): InstagramError {
    if (error instanceof InstagramError) {
      return error;
    }

    if (error instanceof Error) {
      // Prefer the error's class name: instagram-private-api throws typed errors
      // (e.g. IgChallengeWrongCodeError) whose messages are generic, so matching
      // on the message alone would misclassify them.
      const byName = InstagramError.typeFromErrorName(error.name);
      if (byName) {
        return new InstagramError(error.message, byName, {
          originalError: error.message,
        });
      }

      const message = error.message.toLowerCase();

      if (
        message.includes('login') ||
        message.includes('password') ||
        message.includes('auth')
      ) {
        return new InstagramError(
          error.message,
          InstagramErrorType.AUTHENTICATION_FAILED,
          { originalError: error.message },
        );
      }

      if (message.includes('rate') || message.includes('too many')) {
        return new InstagramError(
          error.message,
          InstagramErrorType.RATE_LIMITED,
          { originalError: error.message },
        );
      }

      if (
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('econnrefused')
      ) {
        return new InstagramError(
          error.message,
          InstagramErrorType.NETWORK_ERROR,
          { originalError: error.message },
        );
      }

      if (message.includes('challenge') || message.includes('checkpoint')) {
        return new InstagramError(
          error.message,
          InstagramErrorType.CHALLENGE_REQUIRED,
          { originalError: error.message },
        );
      }

      if (message.includes('locked') || message.includes('disabled')) {
        return new InstagramError(
          error.message,
          InstagramErrorType.ACCOUNT_LOCKED,
          { originalError: error.message },
        );
      }
    }

    return new InstagramError(
      error instanceof Error ? error.message : 'Unknown error occurred',
      InstagramErrorType.UNKNOWN_ERROR,
      { originalError: error },
    );
  }
}

/**
 * Result of unfollower check operation
 */
export interface UnfollowerResult {
  unfollowers: string[];
  stats: {
    followers: number;
    following: number;
    unfollowers: number;
    mutual: number;
    ratio: number;
  };
}

/**
 * User credentials
 */
export interface Credentials {
  email: string;
  password: string;
}

/**
 * Supplies the verification code the user received when Instagram demands a
 * challenge. Implemented by the CLI (interactive prompt); kept as a callback so
 * the Instagram layer stays free of any user-interaction concerns.
 *
 * @returns The security code, or an empty string if the user declined to enter one.
 */
export type ChallengeHandler = () => Promise<string>;

/**
 * Supplies the current two-factor code when the account has 2FA enabled.
 * Implemented by the CLI (interactive prompt); kept as a callback so the
 * Instagram layer stays free of any user-interaction concerns.
 *
 * @param source - Where the code comes from, for display (e.g. "authenticator
 *                 app" or "SMS sent to **99").
 * @returns The 2FA code, or an empty string if the user declined to enter one.
 */
export type TwoFactorHandler = (source: string) => Promise<string>;

/**
 * CLI options
 */
export interface CliOptions {
  email?: string;
  password?: string;
  format?: 'text' | 'json' | 'csv';
  output?: string;
  stats?: boolean;
  verbose?: boolean;
  limit?: number;
  theme?: 'light' | 'dark' | 'none';
  noColor?: boolean;
  sort?: 'username' | 'username-desc' | 'random';
}

/**
 * Output format types
 */
export type OutputFormat = 'text' | 'json' | 'csv';

/**
 * Sort options for results
 */
export enum SortOption {
  USERNAME = 'username',
  USERNAME_DESC = 'username-desc',
  RANDOM = 'random',
}

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}
