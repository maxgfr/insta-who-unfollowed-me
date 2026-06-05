import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import {
  getSessionDir,
  getSessionFilePath,
  loadSession,
  saveSession,
  clearSession,
} from './session';

describe('session', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iwum-session-'));
    process.env.INSTA_SESSION_DIR = tmpDir;
  });

  afterEach(async () => {
    delete process.env.INSTA_SESSION_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('stores sessions under the overridden directory', () => {
    expect(getSessionDir()).toBe(tmpDir);
  });

  it('derives a safe, per-account filename from an email', () => {
    const file = getSessionFilePath('Maxime.Golfier+test@Gmail.com');
    expect(path.dirname(file)).toBe(tmpDir);
    expect(path.basename(file)).toBe('maxime_golfier_test_gmail_com.json');
  });

  it('falls back to a default filename when the email has no safe characters', () => {
    expect(path.basename(getSessionFilePath('@@@'))).toBe('default.json');
  });

  it('returns null when no session is saved', async () => {
    expect(await loadSession('nobody@example.com')).toBeNull();
  });

  it('round-trips a saved session', async () => {
    const state = { cookies: '{"a":1}', deviceString: 'device-x' };
    await saveSession('a@b.com', state);
    expect(await loadSession('a@b.com')).toEqual(state);
  });

  it('writes the session file with user-only permissions', async () => {
    await saveSession('a@b.com', { x: 1 });
    const stat = await fs.stat(getSessionFilePath('a@b.com'));
    // Mask to the permission bits; expect rw for the owner only (0o600).
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('returns null for a corrupt session file', async () => {
    const file = getSessionFilePath('a@b.com');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'not json{');
    expect(await loadSession('a@b.com')).toBeNull();
  });

  it('clears a saved session', async () => {
    await saveSession('a@b.com', { x: 1 });
    await clearSession('a@b.com');
    expect(await loadSession('a@b.com')).toBeNull();
  });

  it('clearSession is a no-op when nothing is saved', async () => {
    await expect(clearSession('ghost@b.com')).resolves.toBeUndefined();
  });
});
