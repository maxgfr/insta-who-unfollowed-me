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
    public details?: unknown
  ) {
    super(message);
    this.name = 'InstagramError';
    Object.setPrototypeOf(this, InstagramError.prototype);
  }

  /**
   * Create an InstagramError from a generic error
   */
  static fromError(error: unknown): InstagramError {
    if (error instanceof InstagramError) {
      return error;
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      
      if (message.includes('login') || message.includes('password') || message.includes('auth')) {
        return new InstagramError(
          error.message,
          InstagramErrorType.AUTHENTICATION_FAILED,
          { originalError: error.message }
        );
      }
      
      if (message.includes('rate') || message.includes('too many')) {
        return new InstagramError(
          error.message,
          InstagramErrorType.RATE_LIMITED,
          { originalError: error.message }
        );
      }
      
      if (message.includes('network') || message.includes('timeout') || message.includes('econnrefused')) {
        return new InstagramError(
          error.message,
          InstagramErrorType.NETWORK_ERROR,
          { originalError: error.message }
        );
      }
      
      if (message.includes('challenge') || message.includes('checkpoint')) {
        return new InstagramError(
          error.message,
          InstagramErrorType.CHALLENGE_REQUIRED,
          { originalError: error.message }
        );
      }
      
      if (message.includes('locked') || message.includes('disabled')) {
        return new InstagramError(
          error.message,
          InstagramErrorType.ACCOUNT_LOCKED,
          { originalError: error.message }
        );
      }
    }

    return new InstagramError(
      error instanceof Error ? error.message : 'Unknown error occurred',
      InstagramErrorType.UNKNOWN_ERROR,
      { originalError: error }
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
