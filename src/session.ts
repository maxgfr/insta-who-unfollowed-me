/**
 * Location of the persisted Instagram login sessions.
 *
 * Reusing a previously authenticated session — instead of logging in from a
 * freshly generated device on every run — is the single most effective way to
 * avoid Instagram's `checkpoint_required` challenges. instagrapi writes the
 * session (and its device identity) one file per account under the user's home
 * directory, never inside a repo, so auth cookies can't be committed by accident.
 */
import os from 'os';
import path from 'path';

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
 * Resolve the instagrapi settings file for an account. The email is lower-cased
 * and reduced to filesystem-safe characters so it forms a stable, readable
 * filename (e.g. `maxime_gmail_com.instagrapi.json`).
 */
export function getSessionFilePath(email: string): string {
  const safe = email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return path.join(getSessionDir(), `${safe || 'default'}.instagrapi.json`);
}
