import { IgApiClient, IgResponseError } from 'instagram-private-api';
import {
  isSecurityCodeStep,
  withManualLink,
  isCheckpointRequired,
  extractCheckpointUrl,
  applyClientVersionOverrides,
} from './insta';

/** Build a real IgResponseError with the given JSON body. */
function responseError(body: Record<string, unknown>): IgResponseError {
  return new IgResponseError({
    request: {
      method: 'GET',
      uri: { path: '/api/v1/friendships/1/followers/' },
    },
    statusCode: 400,
    statusMessage: 'Bad Request',
    body,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

describe('isSecurityCodeStep', () => {
  it.each(['verify_code', 'verify_email', 'verify_sms', 'enter_code'])(
    'treats %s as a code-entry step',
    (step) => {
      expect(isSecurityCodeStep(step)).toBe(true);
    },
  );

  it.each([
    'delta_login_review',
    'change_password',
    'scraping_warning',
    'submit_phone',
    '',
  ])('treats %s as NOT a code-entry step', (step) => {
    expect(isSecurityCodeStep(step)).toBe(false);
  });

  it('returns false for an undefined step', () => {
    expect(isSecurityCodeStep(undefined)).toBe(false);
  });
});

describe('withManualLink', () => {
  it('appends the checkpoint URL when one is provided', () => {
    const result = withManualLink(
      'Blocked.',
      'https://i.instagram.com/challenge/abc/',
    );
    expect(result).toContain('Blocked.');
    expect(result).toContain('https://i.instagram.com/challenge/abc/');
  });

  it('returns the message unchanged when no URL is known', () => {
    expect(withManualLink('Blocked.', undefined)).toBe('Blocked.');
  });
});

describe('isCheckpointRequired', () => {
  it('detects a checkpoint_required IgResponseError', () => {
    expect(
      isCheckpointRequired(responseError({ message: 'checkpoint_required' })),
    ).toBe(true);
  });

  it('does not match other response errors', () => {
    expect(
      isCheckpointRequired(responseError({ message: 'feedback_required' })),
    ).toBe(false);
  });

  it('does not match plain errors', () => {
    expect(isCheckpointRequired(new Error('checkpoint_required'))).toBe(false);
  });
});

describe('extractCheckpointUrl', () => {
  it('returns an absolute checkpoint_url as-is', () => {
    const url = 'https://i.instagram.com/challenge/abc/def/';
    expect(extractCheckpointUrl({ checkpoint_url: url })).toBe(url);
  });

  it('absolutizes a relative checkpoint_url', () => {
    expect(
      extractCheckpointUrl({ checkpoint_url: '/challenge/abc/def/' }),
    ).toBe('https://i.instagram.com/challenge/abc/def/');
  });

  it('falls back to a nested challenge.url', () => {
    const url = 'https://i.instagram.com/challenge/x/';
    expect(extractCheckpointUrl({ challenge: { url } })).toBe(url);
  });

  it('returns undefined when no URL is present', () => {
    expect(
      extractCheckpointUrl({ message: 'checkpoint_required' }),
    ).toBeUndefined();
    expect(extractCheckpointUrl(null)).toBeUndefined();
    expect(extractCheckpointUrl('nope')).toBeUndefined();
  });
});

describe('applyClientVersionOverrides', () => {
  const VERSION_KEYS = [
    'INSTA_APP_VERSION',
    'INSTA_APP_VERSION_CODE',
    'INSTA_BLOKS_VERSION_ID',
    'INSTA_CAPABILITIES',
    'INSTA_DEVICE',
  ] as const;
  let savedEnv: Record<string, string | undefined>;
  let savedConstants: Record<string, string>;

  const newClient = (): IgApiClient => {
    const ig = new IgApiClient();
    ig.state.generateDevice('version-test@example.com');
    return ig;
  };

  beforeEach(() => {
    savedEnv = {};
    for (const key of VERSION_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    // `state.constants` is a shared module object; snapshot it to restore later.
    const c = newClient().state.constants as unknown as Record<string, string>;
    savedConstants = {
      APP_VERSION: c.APP_VERSION,
      APP_VERSION_CODE: c.APP_VERSION_CODE,
      BLOKS_VERSION_ID: c.BLOKS_VERSION_ID,
    };
  });

  afterEach(() => {
    for (const key of VERSION_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    Object.assign(
      newClient().state.constants as unknown as Record<string, string>,
      savedConstants,
    );
  });

  it('defaults to a current (instagrapi) version and modern device', () => {
    const ig = newClient();
    expect(applyClientVersionOverrides(ig)).toBe('428.0.0.47.67');
    // Replaces the library's stale Android 6–8 device with a modern one.
    expect(ig.state.deviceString).toContain('Pixel 8 Pro');
    expect(ig.state.appUserAgent).toContain('428.0.0.47.67');
    expect(ig.state.appUserAgent).toContain('Pixel 8 Pro');
  });

  it('overrides the app version, code and device from env vars', () => {
    process.env.INSTA_APP_VERSION = '999.0.0.0.1';
    process.env.INSTA_APP_VERSION_CODE = '123456789';
    process.env.INSTA_DEVICE =
      '34/14; 420dpi; 1080x2400; Samsung; SM-S911B; dm1q; qcom';
    const ig = newClient();

    expect(applyClientVersionOverrides(ig)).toBe('999.0.0.0.1');
    expect(ig.state.appVersion).toBe('999.0.0.0.1');
    expect(ig.state.appVersionCode).toBe('123456789');
    // The user-agent (what Instagram actually checks) reflects the overrides.
    expect(ig.state.appUserAgent).toContain('999.0.0.0.1');
    expect(ig.state.appUserAgent).toContain('SM-S911B');
  });
});
