import path from 'path';
import { IgApiClient } from 'instagram-private-api';
import {
  applyInstagrapiSession,
  parseHelperEvent,
  parseHelperOutput,
  venvPython,
  InstagrapiSession,
} from './instagrapi';
import { InstagramErrorType } from './types';

const SESSION: InstagrapiSession = {
  authorization: 'Bearer IGT:2:eyJkc191c2VyX2lkIjoiNDIifQ==',
  user_id: '42',
  mid: 'aBcMid',
  uuids: {
    phone_id: 'phone-1',
    uuid: 'uuid-1',
    advertising_id: 'adid-1',
    android_device_id: 'android-abc',
  },
  device_settings: {
    app_version: '448.0.0.0.20',
    version_code: '1065560286',
    bloks_versioning_id: 'bloks-hash',
    android_version: 34,
    android_release: '14',
    dpi: '480dpi',
    resolution: '1344x2992',
    manufacturer: 'Google/google',
    model: 'Pixel 8 Pro',
    device: 'husky',
    cpu: 'husky',
  },
  locale: 'fr_FR',
  timezone_offset: 7200,
};

describe('parseHelperOutput', () => {
  it('reads the session from the last JSON line, ignoring library chatter', () => {
    const stdout = `some log line\n\n${JSON.stringify(SESSION)}\n`;
    expect(parseHelperOutput(stdout, 0)).toEqual(SESSION);
  });

  it('turns a reported error into an InstagramError of the given type', () => {
    const stdout = JSON.stringify({
      error: 'The password you entered is incorrect.',
      type: 'INVALID_CREDENTIALS',
    });
    expect(() => parseHelperOutput(stdout, 1)).toThrow(
      expect.objectContaining({
        message: 'The password you entered is incorrect.',
        type: InstagramErrorType.INVALID_CREDENTIALS,
      }),
    );
  });

  it('falls back to a non-retryable error for an unknown type', () => {
    const stdout = JSON.stringify({ error: 'boom', type: 'NOPE' });
    expect(() => parseHelperOutput(stdout, 1)).toThrow(
      expect.objectContaining({ type: InstagramErrorType.CHALLENGE_REQUIRED }),
    );
  });

  it('does not mistake a trailing event for the result', () => {
    expect(() =>
      parseHelperOutput('{"event": "step", "text": "Logging in"}', 1),
    ).toThrow(
      expect.objectContaining({ type: InstagramErrorType.SETUP_REQUIRED }),
    );
  });

  it('reports a crash without JSON output as a setup problem', () => {
    expect(() =>
      parseHelperOutput('Traceback (most recent call last): …', 1),
    ).toThrow(
      expect.objectContaining({ type: InstagramErrorType.SETUP_REQUIRED }),
    );
  });
});

describe('parseHelperEvent', () => {
  it('recognises progress steps and prompts', () => {
    expect(
      parseHelperEvent('{"event": "step", "text": "Logging in to Instagram"}'),
    ).toEqual({ event: 'step', text: 'Logging in to Instagram' });
    expect(
      parseHelperEvent('{"event": "prompt", "message": "Enter the 2FA code."}'),
    ).toEqual({ event: 'prompt', message: 'Enter the 2FA code.' });
  });

  it('ignores the result line, malformed events and library chatter', () => {
    expect(parseHelperEvent(JSON.stringify(SESSION))).toBeUndefined();
    expect(parseHelperEvent('{"event": "step"}')).toBeUndefined();
    expect(
      parseHelperEvent('Code entered "123456" for someone'),
    ).toBeUndefined();
    expect(parseHelperEvent('')).toBeUndefined();
  });
});

describe('applyInstagrapiSession', () => {
  it("makes the Node client present instagrapi's exact device and session", () => {
    const ig = new IgApiClient();
    ig.state.generateDevice('someone@example.com');

    applyInstagrapiSession(ig, SESSION);

    expect(ig.state.uuid).toBe('uuid-1');
    expect(ig.state.phoneId).toBe('phone-1');
    expect(ig.state.adid).toBe('adid-1');
    expect(ig.state.deviceId).toBe('android-abc');
    expect(ig.state.appVersion).toBe('448.0.0.0.20');
    expect(ig.state.appVersionCode).toBe('1065560286');
    expect(ig.state.bloksVersionId).toBe('bloks-hash');
    expect(ig.state.deviceString).toBe(
      '34/14; 480dpi; 1344x2992; Google/google; Pixel 8 Pro; husky; husky',
    );
    expect(ig.state.language).toBe('fr_FR');
    expect(ig.state.timezoneOffset).toBe('7200');
    expect(ig.state.authorization).toBe(SESSION.authorization);
    expect(ig.state.cookieUserId).toBe('42');
    expect(ig.state.extractCookieValue('mid')).toBe('aBcMid');
    // Same user agent shape instagrapi sends.
    expect(ig.state.appUserAgent).toBe(
      'Instagram 448.0.0.0.20 Android (34/14; 480dpi; 1344x2992; Google/google; ' +
        'Pixel 8 Pro; husky; husky; fr_FR; 1065560286)',
    );
  });
});

describe('venvPython', () => {
  it('uses bin/python on POSIX and Scripts\\python.exe on Windows', () => {
    expect(venvPython('/v', 'darwin')).toBe(path.join('/v', 'bin', 'python'));
    expect(venvPython('/v', 'win32')).toBe(
      path.join('/v', 'Scripts', 'python.exe'),
    );
  });
});
