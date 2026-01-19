/**
 * Centralized configuration for insta-who-unfollowed-me
 */

export const config = {
  // Retry configuration
  maxRetries: 3,
  retryDelay: 2000, // milliseconds

  // API configuration
  requestTimeout: 30000, // milliseconds

  // Output configuration
  defaultFormat: 'text' as const,
  defaultLimit: undefined as number | undefined,

  // Environment variable names
  envVars: {
    email: 'INSTA_EMAIL',
    password: 'INSTA_PASSWORD',
    logLevel: 'INSTA_LOG_LEVEL',
  },

  // File paths
  defaultOutputFile: 'unfollowers.json',

  // Rate limiting
  rateLimit: {
    maxConcurrent: 1,
    minDelay: 1000, // milliseconds between requests
  },
} as const;

export type Config = typeof config;
