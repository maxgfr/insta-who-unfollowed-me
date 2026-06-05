import { securePasswordPromptError } from './cli';

describe('securePasswordPromptError', () => {
  it('returns null when a password prompt is not needed (even with no interactive input)', () => {
    expect(securePasswordPromptError(false, false)).toBeNull();
  });

  it('returns null when a password is needed and an interactive terminal is available', () => {
    expect(securePasswordPromptError(true, true)).toBeNull();
  });

  it('returns an error when a password would be prompted with no interactive terminal', () => {
    const message = securePasswordPromptError(true, false);
    expect(message).not.toBeNull();
    // The whole point: warn that the password would otherwise be shown in clear text.
    expect(message).toMatch(/clear text/i);
    // And point the user at the secure alternatives.
    expect(message).toMatch(/INSTA_PASSWORD|-p/);
  });
});
