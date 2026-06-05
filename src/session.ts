/**
 * Persistence for Instagram login sessions.
 *
 * Reusing a previously authenticated session — instead of logging in from a
 * freshly generated device on every run — is the single most effective way to
 * avoid Instagram's `checkpoint_required` challenges. Sessions are stored one
 * file per account under the user's home directory, never inside a repo, so
 * auth cookies can't be committed by accident.
 */
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

const SESSION_DIR_NAME = '.insta-who-unfollowed-me';

/**
 * Directory holding the session files (default: `~/.insta-who-unfollowed-me`).
 *
 * `INSTA_SESSION_DIR` overrides the location — primarily so tests can point at a
 * throwaway temp directory instead of the real home folder.
 */
export function getSessionDir(): string {
  return (
    process.env.INSTA_SESSION_DIR || path.join(os.homedir(), SESSION_DIR_NAME)
  );
}

/**
 * Resolve the session file path for an account. The email is lower-cased and
 * reduced to filesystem-safe characters so it forms a stable, readable filename
 * (e.g. `maxime_gmail_com.json`).
 */
export function getSessionFilePath(email: string): string {
  const safe = email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return path.join(getSessionDir(), `${safe || 'default'}.json`);
}

/**
 * Load a previously saved session for an account.
 *
 * @returns The deserialized state, or `null` when no session exists or the file
 *          is unreadable/corrupt (callers should fall back to a fresh login).
 */
export async function loadSession(
  email: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(getSessionFilePath(email), 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Persist a serialized session for an account. The directory and file are
 * created with user-only permissions so the auth cookies aren't world-readable.
 */
export async function saveSession(
  email: string,
  state: Record<string, unknown>,
): Promise<void> {
  await fs.mkdir(getSessionDir(), { recursive: true, mode: 0o700 });
  await fs.writeFile(getSessionFilePath(email), JSON.stringify(state), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

/**
 * Remove a saved session, e.g. once it has expired. A missing file is not an
 * error.
 */
export async function clearSession(email: string): Promise<void> {
  try {
    await fs.unlink(getSessionFilePath(email));
  } catch {
    // Nothing saved — already in the desired state.
  }
}
