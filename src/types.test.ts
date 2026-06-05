import { InstagramError, InstagramErrorType } from './types';

/** Build an Error whose `name` mimics an instagram-private-api typed error. */
function namedError(
  name: string,
  message = 'Instagram API error was made.',
): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe('InstagramError.typeFromErrorName', () => {
  it.each([
    ['IgCheckpointError', InstagramErrorType.CHALLENGE_REQUIRED],
    ['IgChallengeWrongCodeError', InstagramErrorType.CHALLENGE_REQUIRED],
    ['IgLoginBadPasswordError', InstagramErrorType.INVALID_CREDENTIALS],
    ['IgLoginInvalidUserError', InstagramErrorType.INVALID_CREDENTIALS],
    ['IgLoginRequiredError', InstagramErrorType.AUTHENTICATION_FAILED],
  ])('maps %s to %s', (name, expected) => {
    expect(InstagramError.typeFromErrorName(name)).toBe(expected);
  });

  it('returns undefined for unknown names', () => {
    expect(
      InstagramError.typeFromErrorName('SomethingElseError'),
    ).toBeUndefined();
  });
});

describe('InstagramError.fromError', () => {
  it('classifies a wrong-code error by name even with a generic message', () => {
    // The message contains none of the keyword heuristics, so name-matching is
    // what saves this from being mislabeled UNKNOWN_ERROR.
    const result = InstagramError.fromError(
      namedError('IgChallengeWrongCodeError'),
    );
    expect(result.type).toBe(InstagramErrorType.CHALLENGE_REQUIRED);
  });

  it('classifies a checkpoint error by name', () => {
    const result = InstagramError.fromError(namedError('IgCheckpointError'));
    expect(result.type).toBe(InstagramErrorType.CHALLENGE_REQUIRED);
  });

  it('falls back to message heuristics for plain errors', () => {
    const result = InstagramError.fromError(
      new Error('Network timeout while connecting'),
    );
    expect(result.type).toBe(InstagramErrorType.NETWORK_ERROR);
  });

  it('passes through an existing InstagramError unchanged', () => {
    const original = new InstagramError(
      'boom',
      InstagramErrorType.RATE_LIMITED,
    );
    expect(InstagramError.fromError(original)).toBe(original);
  });

  it('defaults to UNKNOWN_ERROR for unrecognized errors', () => {
    const result = InstagramError.fromError(
      namedError('MysteryError', 'totally opaque'),
    );
    expect(result.type).toBe(InstagramErrorType.UNKNOWN_ERROR);
  });
});
