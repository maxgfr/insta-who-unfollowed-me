/**
 * Password login through instagrapi (subzeroid/instagrapi, Python).
 *
 * Since September 2026 Instagram refuses password logins on the legacy
 * `accounts/login/` endpoint that instagram-private-api uses ("Your version of
 * Instagram is out of date", `needs_upgrade`): the Android app now logs in
 * through a Bloks/CAA flow. instagrapi implements and maintains that flow, so we
 * delegate the login to it — through `python/instagrapi_login.py`, run in a
 * private virtualenv — and keep fetching with the Node client.
 *
 * Continuity: the Node client takes over instagrapi's session AND its device
 * identity (ids, app version, device string, locale), so Instagram sees one
 * device, not a login from one phone followed by API calls from another.
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { IgApiClient } from 'instagram-private-api';
import { InstagramError, InstagramErrorType } from './types';
import { getSessionDir, getSessionFilePath } from './session';
import { spinner } from './utils/spinner';

/** Pinned so a new upstream release can't change the login under our feet. */
export const INSTAGRAPI_VERSION = '3.0.15';

const HELPER_SCRIPT = path.resolve(
  __dirname,
  '..',
  'python',
  'instagrapi_login.py',
);

/** The session and device identity printed by the helper script. */
export interface InstagrapiSession {
  authorization: string;
  user_id: string;
  username?: string;
  mid: string;
  uuids: {
    phone_id: string;
    uuid: string;
    advertising_id: string;
    android_device_id: string;
  };
  device_settings: {
    app_version: string;
    version_code: string;
    bloks_versioning_id: string;
    android_version: number | string;
    android_release: string;
    dpi: string;
    resolution: string;
    manufacturer: string;
    model: string;
    device: string;
    cpu: string;
  };
  locale: string;
  timezone_offset: number | string | null;
}

/** The interpreter inside a virtualenv. */
export function venvPython(
  venvDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
}

/**
 * Run a command and resolve with its exit code. Its output is shown live with
 * `--verbose`; otherwise it's held back (the spinner owns the line) and only
 * printed if the command fails.
 */
function run(
  command: string,
  args: string[],
  verbose: boolean,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [
        'ignore',
        verbose ? 'inherit' : 'pipe',
        verbose ? 'inherit' : 'pipe',
      ],
    });
    let output = '';
    child.stdout?.on('data', (chunk) => (output += chunk));
    child.stderr?.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && output) {
        spinner.stop();
        process.stderr.write(output);
      }
      resolve(code ?? 1);
    });
  });
}

function setupError(message: string): InstagramError {
  return new InstagramError(message, InstagramErrorType.SETUP_REQUIRED);
}

/**
 * The Python interpreter to run the helper with. `INSTA_PYTHON` wins (it must
 * already have instagrapi); otherwise a private virtualenv under the session
 * directory is created and instagrapi installed into it, once per pinned version.
 */
export async function ensureInstagrapi(verbose = false): Promise<string> {
  if (process.env.INSTA_PYTHON) return process.env.INSTA_PYTHON;

  const venvDir = path.join(getSessionDir(), 'python');
  const python = venvPython(venvDir);
  const marker = path.join(venvDir, `.instagrapi-${INSTAGRAPI_VERSION}`);
  if (existsSync(marker)) return python;

  spinner.start('Setting up the Python environment (one-time, about 30 s)');
  if (!existsSync(python)) {
    const system = process.platform === 'win32' ? 'python' : 'python3';
    let code: number;
    try {
      code = await run(system, ['-m', 'venv', venvDir], verbose);
    } catch {
      spinner.stop();
      throw setupError(
        `Python 3.10+ is required to log in (Instagram only accepts the login flow ` +
          `implemented by instagrapi), but "${system}" was not found. Install Python, ` +
          `or point INSTA_PYTHON at an interpreter that has instagrapi installed.`,
      );
    }
    if (code !== 0) {
      spinner.stop();
      throw setupError(`Could not create a Python virtualenv in ${venvDir}.`);
    }
  }

  spinner.update(`Downloading and installing instagrapi ${INSTAGRAPI_VERSION}`);
  const code = await run(
    python,
    [
      '-m',
      'pip',
      'install',
      '--disable-pip-version-check',
      `instagrapi==${INSTAGRAPI_VERSION}`,
    ],
    verbose,
  );
  if (code !== 0) {
    spinner.stop();
    throw setupError(
      `Installing instagrapi ${INSTAGRAPI_VERSION} failed (see pip's output above). ` +
        `instagrapi needs Python 3.10+.`,
    );
  }
  await fs.writeFile(marker, '');
  spinner.succeed(`instagrapi ${INSTAGRAPI_VERSION} installed in ${venvDir}`);
  return python;
}

/** A progress or prompt message the helper sends while it works. */
export type HelperEvent =
  | { event: 'step'; text: string }
  | { event: 'prompt'; message: string };

/** Parse one stdout line into a helper event, if it is one. */
export function parseHelperEvent(line: string): HelperEvent | undefined {
  try {
    const payload = JSON.parse(line);
    if (payload?.event === 'step' && typeof payload.text === 'string') {
      return payload;
    }
    if (payload?.event === 'prompt' && typeof payload.message === 'string') {
      return payload;
    }
  } catch {
    // Library chatter, not an event.
  }
  return undefined;
}

/**
 * Read the helper's result: the last non-empty stdout line is its JSON payload
 * (anything above it is events or library chatter).
 */
export function parseHelperOutput(
  stdout: string,
  exitCode: number,
): InstagrapiSession {
  const lastLine = stdout.trim().split('\n').pop() ?? '';
  let payload: Record<string, unknown> | undefined;
  try {
    payload = JSON.parse(lastLine);
  } catch {
    payload = undefined;
  }
  if (payload?.event) payload = undefined;

  if (payload && typeof payload.error === 'string') {
    const type = Object.values(InstagramErrorType).includes(
      payload.type as InstagramErrorType,
    )
      ? (payload.type as InstagramErrorType)
      : InstagramErrorType.CHALLENGE_REQUIRED;
    throw new InstagramError(payload.error, type);
  }
  if (exitCode !== 0 || !payload || typeof payload.authorization !== 'string') {
    throw setupError(
      `The instagrapi login helper failed (exit code ${exitCode}); see its output above.`,
    );
  }
  return payload as unknown as InstagrapiSession;
}

/** Asks the user for a code (2FA or verification) and resolves with it. */
export type CodePrompt = (message: string) => Promise<string>;

/**
 * Log in with instagrapi. It reuses (and validates) the settings saved by the
 * previous run, so most runs don't log in again at all. Progress shows on the
 * spinner; codes Instagram asks for are collected through `onPrompt`.
 */
export async function loginWithInstagrapi(
  username: string,
  password: string,
  options: { verbose?: boolean; onPrompt?: CodePrompt } = {},
): Promise<InstagrapiSession> {
  const { verbose = false, onPrompt } = options;
  const python = await ensureInstagrapi(verbose);
  const settingsPath = getSessionFilePath(username);

  spinner.start('Starting instagrapi');
  const { stdout, stderr, exitCode } = await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>((resolve, reject) => {
    // Credentials go through stdin, never argv (visible in `ps`). Stdin stays
    // open so the answers to prompts can follow.
    const child = spawn(python, [HELPER_SCRIPT], { stdio: 'pipe' });
    child.stdin.on('error', () => undefined); // helper exited before an answer
    let out = '';
    let err = '';
    let pending = '';
    // Events are handled one at a time: the helper blocks on each prompt.
    let queue = Promise.resolve();

    const handle = async (event: HelperEvent): Promise<void> => {
      if (event.event === 'step') {
        spinner.update(event.text);
        return;
      }
      spinner.stop();
      const code = onPrompt ? await onPrompt(event.message) : '';
      child.stdin.write(`${code}\n`);
      spinner.start('Verifying the code');
    };

    child.stdout.on('data', (chunk) => {
      out += chunk;
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const event = parseHelperEvent(line);
        if (event) queue = queue.then(() => handle(event)).catch(reject);
      }
    });
    child.stderr.on('data', (chunk) => {
      // instagrapi's logs: live with --verbose, else kept for a crash report.
      if (verbose) process.stderr.write(chunk);
      else err += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      child.stdin.end();
      queue.then(() =>
        resolve({ stdout: out, stderr: err, exitCode: code ?? 1 }),
      );
    });
    child.stdin.write(
      `${JSON.stringify({
        username,
        password,
        settings_path: settingsPath,
        verbose,
      })}\n`,
    );
  });

  try {
    const session = parseHelperOutput(stdout, exitCode);
    spinner.succeed(
      `Logged in${session.username ? ` as ${session.username}` : ''}`,
    );
    return session;
  } catch (error) {
    spinner.stop();
    // Its stderr (a traceback) only helps when the helper crashed without
    // reporting an error itself.
    if (
      stderr &&
      error instanceof InstagramError &&
      error.type === InstagramErrorType.SETUP_REQUIRED
    ) {
      process.stderr.write(stderr);
    }
    throw error;
  }
}

/** Make the Node client continue instagrapi's session on the same device. */
export function applyInstagrapiSession(
  ig: IgApiClient,
  session: InstagrapiSession,
): void {
  const { uuids, device_settings: d } = session;
  // The constants object is mutable at runtime even though typed as readonly.
  const constants = ig.state.constants as unknown as Record<string, string>;

  ig.state.uuid = uuids.uuid;
  ig.state.phoneId = uuids.phone_id;
  ig.state.adid = uuids.advertising_id;
  ig.state.deviceId = uuids.android_device_id;
  constants.APP_VERSION = d.app_version;
  constants.APP_VERSION_CODE = d.version_code;
  constants.BLOKS_VERSION_ID = d.bloks_versioning_id;
  ig.state.deviceString =
    `${d.android_version}/${d.android_release}; ${d.dpi}; ${d.resolution}; ` +
    `${d.manufacturer}; ${d.model}; ${d.device}; ${d.cpu}`;
  if (session.locale) ig.state.language = session.locale;
  if (
    session.timezone_offset !== null &&
    session.timezone_offset !== undefined
  ) {
    ig.state.timezoneOffset = String(session.timezone_offset);
  }
  ig.state.authorization = session.authorization;
  if (session.mid) {
    ig.state.cookieJar.setCookie(
      `mid=${session.mid}; Domain=.instagram.com; Path=/`,
      'https://i.instagram.com',
    );
  }
}
