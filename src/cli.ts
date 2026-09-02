import prompts from 'prompts';
import { Command } from 'commander';
import { getUnfollowers } from './insta';
import {
  UnfollowerResult,
  InstagramError,
  InstagramErrorType,
  CliOptions,
  SortOption,
} from './types';
import { config } from './config';
import { initColors, color } from './utils/colors';
import packageJson from '../package.json';
import fs from 'fs/promises';
import { openSync } from 'fs';
import { ReadStream } from 'tty';

interface PromptResult {
  email: string;
  password: string;
}

/** An interactive TTY input stream plus a cleanup function to release it. */
interface InteractiveInput {
  stream: NodeJS.ReadStream;
  close: () => void;
}

const questions: Array<prompts.PromptObject> = [
  {
    type: 'text',
    name: 'email',
    message: 'email:',
  },
  {
    type: 'password',
    name: 'password',
    message: 'password:',
  },
];

/**
 * Obtain a TTY input stream suitable for masked prompts.
 *
 * Uses `process.stdin` when it's already a TTY. Otherwise — e.g. when the tool is
 * launched through a script runner that pipes stdin — it opens the controlling
 * terminal (`/dev/tty`) directly so input can still be masked. Without a real
 * terminal (CI, piped input, or platforms without `/dev/tty`) it returns `null`,
 * and the caller must avoid prompting for secrets.
 */
function getInteractiveInput(): InteractiveInput | null {
  if (process.stdin.isTTY) {
    return { stream: process.stdin, close: () => undefined };
  }
  try {
    const fd = openSync('/dev/tty', 'r');
    const stream = new ReadStream(fd);
    if (!stream.isTTY) {
      stream.destroy();
      return null;
    }
    return { stream, close: () => stream.destroy() };
  } catch {
    return null;
  }
}

async function promptUser(
  stdin: NodeJS.ReadStream,
): Promise<Partial<PromptResult>> {
  const { email, password } = await prompts(
    questions.map((q) => ({ ...q, stdin })),
  );
  return { email, password };
}

/**
 * Interactive challenge handler: shown when Instagram demands verification.
 * Instagram has already sent a code (to email by default); we collect it here.
 * Reads from the controlling terminal so it works even when stdin is piped.
 *
 * @returns The trimmed code, or an empty string if the user submitted nothing.
 */
async function promptChallengeCode(): Promise<string> {
  console.log(
    `\n${color.yellow('🔐')} Instagram sent a verification code (check your email or SMS).`,
  );
  const input = getInteractiveInput();
  try {
    const { code } = await prompts({
      type: 'text',
      name: 'code',
      message: 'Enter the verification code:',
      stdin: input?.stream ?? process.stdin,
    });
    return (code || '').toString().trim();
  } finally {
    input?.close();
  }
}

/**
 * Interactive 2FA handler: shown when the account has two-factor authentication
 * enabled. Collects the current code from the source Instagram supports
 * (authenticator app, or the SMS it just sent).
 *
 * @returns The trimmed code, or an empty string if the user submitted nothing.
 */
async function promptTwoFactorCode(source: string): Promise<string> {
  console.log(
    `\n${color.yellow('🔐')} Two-factor authentication is enabled. Get the code from your ${source}.`,
  );
  const input = getInteractiveInput();
  try {
    const { code } = await prompts({
      type: 'text',
      name: 'code',
      message: 'Enter the 2FA code:',
      stdin: input?.stream ?? process.stdin,
    });
    return (code || '').toString().trim();
  } finally {
    input?.close();
  }
}

function getCredentials(options: CliOptions): {
  email: string;
  password: string;
} {
  // Priority: CLI args > Environment variables > Interactive prompt
  const email = options.email || process.env.INSTA_EMAIL || '';
  const password = options.password || process.env.INSTA_PASSWORD || '';

  return { email, password };
}

function sortUnfollowers(
  unfollowers: string[],
  sortOption?: SortOption,
): string[] {
  if (!sortOption) return unfollowers;

  switch (sortOption) {
    case SortOption.USERNAME:
      return [...unfollowers].sort((a, b) => a.localeCompare(b));
    case SortOption.USERNAME_DESC:
      return [...unfollowers].sort((a, b) => b.localeCompare(a));
    case SortOption.RANDOM:
      return [...unfollowers].sort(() => Math.random() - 0.5);
    default:
      return unfollowers;
  }
}

function convertToCSV(result: UnfollowerResult): string {
  const headers = ['username', 'type'];
  const rows = result.unfollowers.map((username) => [username, 'unfollower']);

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.join(',')),
  ].join('\n');

  return csvContent;
}

async function outputResults(
  result: UnfollowerResult,
  options: CliOptions,
): Promise<void> {
  const format = options.format || 'text';

  // Sort results if sort option is provided
  const sortedUnfollowers = sortUnfollowers(
    result.unfollowers,
    options.sort as SortOption | undefined,
  );
  const sortedResult = { ...result, unfollowers: sortedUnfollowers };

  if (format === 'json') {
    const output = JSON.stringify(sortedResult, null, 2);
    console.log(output);

    if (options.output) {
      await fs.writeFile(options.output, output, 'utf-8');
      console.log(`\n${color.green('✓')} Results saved to ${options.output}`);
    }
  } else if (format === 'csv') {
    const csvOutput = convertToCSV(sortedResult);
    console.log(csvOutput);

    if (options.output) {
      await fs.writeFile(options.output, csvOutput, 'utf-8');
      console.log(`\n${color.green('✓')} Results saved to ${options.output}`);
    }
  } else {
    // Text format
    console.log('\n' + '='.repeat(50));
    console.log(`${color.cyan('📋 Unfollowers List')}`);
    console.log('='.repeat(50));

    if (sortedResult.unfollowers.length === 0) {
      console.log(
        `\n${color.green('✅')} No unfollowers found! Everyone follows you back.`,
      );
    } else {
      console.log(
        `\nFound ${color.yellow(sortedResult.unfollowers.length.toString())} user(s) who don't follow you back:\n`,
      );
      sortedResult.unfollowers.forEach((username: string, index: number) => {
        console.log(
          `  ${color.dim((index + 1).toString() + '.')} @${color.bright(username)}`,
        );
      });
    }

    if (options.stats) {
      console.log('\n' + '-'.repeat(50));
      console.log(`${color.cyan('📊 Statistics')}`);
      console.log('-'.repeat(50));
      console.log(
        `  Followers:      ${color.bright(sortedResult.stats.followers.toString())}`,
      );
      console.log(
        `  Following:      ${color.bright(sortedResult.stats.following.toString())}`,
      );
      console.log(
        `  Unfollowers:     ${color.yellow(sortedResult.stats.unfollowers.toString())}`,
      );
      console.log(
        `  Mutual:          ${color.green(sortedResult.stats.mutual.toString())}`,
      );
      console.log(
        `  Follow Ratio:    ${color.blue(sortedResult.stats.ratio.toFixed(2))}`,
      );
    }

    if (options.output) {
      const output = JSON.stringify(sortedResult, null, 2);
      await fs.writeFile(options.output, output, 'utf-8');
      console.log(`\n${color.green('✓')} Results saved to ${options.output}`);
    }
  }
}

/**
 * Decide whether it's safe to prompt for the password interactively.
 *
 * `prompts` can only mask input — and suppress the terminal's own echo — on a TTY
 * (it calls `setRawMode` guarded by `isTTY`). Without one, the password is echoed
 * in CLEAR TEXT. When a password prompt is needed but no interactive terminal is
 * available (not even `/dev/tty`), we refuse and explain the secure alternatives.
 *
 * @returns An error message to display (and abort on), or `null` when it's safe.
 */
export function securePasswordPromptError(
  needsPasswordPrompt: boolean,
  hasInteractiveInput: boolean,
): string | null {
  if (!needsPasswordPrompt || hasInteractiveInput) {
    return null;
  }
  return [
    'Cannot read your password securely: no interactive terminal is available',
    '(stdin is not a TTY and /dev/tty could not be opened), so it would be',
    'displayed in clear text. Provide credentials via the INSTA_EMAIL /',
    'INSTA_PASSWORD environment variables or the -e / -p flags, or run the tool',
    'directly in a real terminal.',
  ].join('\n   ');
}

async function processUserInformations(options: CliOptions) {
  // Initialize colors based on options
  initColors(options.noColor === false);

  const { email, password } = getCredentials(options);

  // Prompt for missing credentials
  let finalEmail = email;
  let finalPassword = password;

  if (!finalEmail || !finalPassword) {
    const input = getInteractiveInput();

    // Never echo a password in clear text: refuse to prompt when masking is
    // impossible (no interactive terminal) and point at the secure alternatives.
    const insecureError = securePasswordPromptError(
      !finalPassword,
      input !== null,
    );
    if (insecureError) {
      input?.close();
      console.error(`${color.red('❌')} ${insecureError}`);
      process.exit(1);
    }

    try {
      const prompted = await promptUser(input?.stream ?? process.stdin);
      if (!finalEmail) finalEmail = prompted.email || '';
      if (!finalPassword) finalPassword = prompted.password || '';
    } finally {
      input?.close();
    }
  }

  if (!finalEmail || !finalPassword) {
    console.error(
      `${color.red('❌')} Missing credentials. Please provide email and password.`,
    );
    process.exit(1);
  }

  if (options.verbose) {
    console.log(
      `${color.blue('🔍')} Checking unfollowers for: ${color.bright(finalEmail)}`,
    );
  }

  let result: UnfollowerResult | null = null;
  let retryCount = 0;

  while (retryCount < config.maxRetries) {
    try {
      result = await getUnfollowers(finalEmail, finalPassword, {
        withPreLoginFlow: retryCount === 0,
        limit: options.limit,
        onChallenge: promptChallengeCode,
        onTwoFactor: promptTwoFactorCode,
        verbose: options.verbose,
      });
      break;
    } catch (error) {
      const instaError = InstagramError.fromError(error);
      retryCount++;

      console.error(`\n${color.red('❌')} Error: ${instaError.message}`);
      console.error(`   Type: ${color.dim(instaError.type)}`);

      if (instaError.type === InstagramErrorType.CHALLENGE_REQUIRED) {
        // The error message already carries specific guidance (and a browser
        // link when Instagram provided one); don't pile on a generic note.
        process.exit(1);
      }

      if (instaError.type === InstagramErrorType.ACCOUNT_LOCKED) {
        console.error(
          `\n${color.yellow('⚠️')} Your account appears to be locked or disabled.`,
        );
        console.error(`   Please contact Instagram support.`);
        process.exit(1);
      }

      if (retryCount < config.maxRetries) {
        console.log(
          `${color.blue('🔄')} Retrying... (${retryCount}/${config.maxRetries})`,
        );
        // Add delay between retries
        await new Promise((resolve) => setTimeout(resolve, config.retryDelay));
      }
    }
  }

  if (result) {
    await outputResults(result, options);
  } else {
    console.error(
      `\n${color.red('❌')} Failed to get unfollowers after ${config.maxRetries} retries.`,
    );
    process.exit(1);
  }
}

export async function runCommand() {
  const program = new Command();

  program
    .version(packageJson.version)
    .name('insta-who-unfollowed-me')
    .description('Utility to make it easy to track unfollowers on Instagram')
    .option('-e, --email <email>', 'Instagram email')
    .option('-p, --password <password>', 'Instagram password')
    .option(
      '-f, --format <format>',
      'Output format (text, json, or csv)',
      'text',
    )
    .option('-o, --output <file>', 'Save results to file')
    .option('-s, --stats', 'Show detailed statistics')
    .option('-v, --verbose', 'Enable verbose output')
    .option(
      '-l, --limit <number>',
      'Limit the number of results',
      (value: string) => parseInt(value, 10),
    )
    .option('-t, --theme <theme>', 'Color theme (light, dark, none)', 'light')
    .option('--no-color', 'Disable colored output')
    .option(
      '--sort <option>',
      'Sort results (username, username-desc, random)',
      (value: string) => value as SortOption,
    )
    .action((options) => processUserInformations(options));

  program.parse();
}
