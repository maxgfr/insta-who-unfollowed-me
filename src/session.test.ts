import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { getSessionDir, getSessionFilePath } from './session';

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
    expect(path.basename(file)).toBe(
      'maxime_golfier_test_gmail_com.instagrapi.json',
    );
  });

  it('falls back to a default filename when the email has no safe characters', () => {
    expect(path.basename(getSessionFilePath('@@@'))).toBe(
      'default.instagrapi.json',
    );
  });
});
