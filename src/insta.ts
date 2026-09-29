import {
  IgApiClient,
  Feed,
  IgCheckpointError,
  IgLoginRequiredError,
  IgResponseError,
} from 'instagram-private-api';
import {
  UnfollowerResult,
  InstagramError,
  InstagramErrorType,
  ChallengeHandler,
} from './types';
import { config } from './config';
import { applyInstagrapiSession, loginWithInstagrapi } from './instagrapi';

/** Minimal shape we rely on from a follower/following feed item. */
interface FeedUser {
  username: string;
}

/**
 * Options controlling how unfollowers are fetched.
 */
export interface GetUnfollowersOptions {
  /** Cap the number of followers/following fetched per feed. */
  limit?: number;
  /** Called when Instagram requires a verification challenge; should resolve with the code. */
  onChallenge?: ChallengeHandler;
  /** Emit diagnostic details (e.g. the challenge step) to stderr. */
  verbose?: boolean;
  /**
   * A logged-in `sessionid` cookie copied from instagram.com. When set, the
   * password login is skipped entirely and this session is used as-is.
   */
  sessionId?: string;
}

/** A browser session, normalized to the form the mobile API expects. */
export interface BrowserSession {
  /** The cookie value, URL-encoded as browsers store it (`123%3Aabc%3A…`). */
  sessionId: string;
  /** The account's numeric id — the part before the first colon. */
  userId: string;
}

/**
 * Parse a `sessionid` cookie pasted by the user. Accepts it as devtools shows it
 * (URL-encoded), decoded (plain colons), quoted, or with a `sessionid=` prefix.
 *
 * @throws {InstagramError} INVALID_CREDENTIALS when it doesn't look like a session.
 */
export function parseSessionId(raw: string): BrowserSession {
  const value = raw
    .trim()
    .replace(/;+$/, '')
    .replace(/^sessionid=/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Not valid percent-encoding: validate it as-is below.
  }

  const match = /^(\d+):/.exec(decoded);
  if (!match || decoded.length < 30) {
    throw new InstagramError(
      'That does not look like an Instagram sessionid cookie. It should start with ' +
        'your numeric user id, e.g. "123456789%3AAbC…". See "Log in with a browser ' +
        'session" in the README.',
      InstagramErrorType.INVALID_CREDENTIALS,
    );
  }
  return { sessionId: decoded.replace(/:/g, '%3A'), userId: match[1] };
}

/**
 * The `Authorization` header the Android app sends once logged in
 * (`Bearer IGT:2:<base64 JSON>`), built from a browser session. Mirrors
 * instagrapi's `login_by_sessionid`.
 */
export function sessionAuthorization(session: BrowserSession): string {
  const payload = JSON.stringify({
    ds_user_id: session.userId,
    sessionid: session.sessionId,
    should_use_header_over_cookies: true,
  });
  return `Bearer IGT:2:${Buffer.from(payload).toString('base64')}`;
}

/**
 * Whether Instagram refused the current session on an API call: the library's
 * `login_required` error, or a bare 401 ("Please wait a few minutes before you
 * try again"), which is what a stale saved session gets.
 */
export function isSessionRejected(error: unknown): boolean {
  return (
    error instanceof IgLoginRequiredError ||
    (error instanceof IgResponseError && error.response?.statusCode === 401)
  );
}

/** Instagram challenge steps that can be satisfied by submitting a security code. */
export function isSecurityCodeStep(step?: string): boolean {
  // e.g. verify_code, verify_email, verify_sms — anything that asks for a code.
  return !!step && /verify|code/i.test(step);
}

/**
 * The web URL Instagram provides for resolving the current checkpoint in a
 * browser, if one is pending. Useful when the challenge can't be completed from
 * the CLI and the user wants to verify manually.
 */
function checkpointUrl(ig: IgApiClient): string | undefined {
  return ig.state.checkpoint?.challenge?.url;
}

/*
 * Current client identity, mirrored from the maintained Python library
 * `instagrapi` (subzeroid/instagrapi, config.py) as of mid-2026.
 *
 * The bundled instagram-private-api is years stale — app version `222.0.0.13.114`
 * (≈2021) and Android 6–8 devices — which Instagram rejects as
 * `unsupported_version` (the `/web/unsupported_version/` checkpoint). We ship
 * current values instead, and let every field be overridden from the env when
 * they eventually go stale (refresh from instagrapi's config.py or APKMirror).
 *
 * @see https://github.com/subzeroid/instagrapi/blob/3.0.15/instagrapi/config.py
 */
const DEFAULT_APP_VERSION = '448.0.0.0.20';
const DEFAULT_APP_VERSION_CODE = '1065560286';
const DEFAULT_BLOKS_VERSION_ID =
  '0bc46a03e177bfc9bc8d611918815acf248fa9c77754d807d6a5951dc9ce9432';
// android_version/android_release; dpi; resolution; manufacturer; model; device; cpu
const DEFAULT_DEVICE =
  '34/14; 480dpi; 1344x2992; Google/google; Pixel 8 Pro; husky; husky';

/**
 * Replace the library's stale client identity (app version + device) with
 * current values, taking env overrides where provided. Must be called AFTER
 * `generateDevice` (which seeds the stable per-account ids); overriding
 * `deviceString` afterwards keeps those ids and only changes the reported device.
 *
 * @returns The app version in effect.
 */
export function applyClientVersionOverrides(
  ig: IgApiClient,
  verbose = false,
): string {
  const env = process.env;
  // The constants object is mutable at runtime even though typed as readonly.
  const constants = ig.state.constants as unknown as Record<string, string>;

  constants.APP_VERSION = env.INSTA_APP_VERSION || DEFAULT_APP_VERSION;
  constants.APP_VERSION_CODE =
    env.INSTA_APP_VERSION_CODE || DEFAULT_APP_VERSION_CODE;
  constants.BLOKS_VERSION_ID =
    env.INSTA_BLOKS_VERSION_ID || DEFAULT_BLOKS_VERSION_ID;
  ig.state.deviceString = env.INSTA_DEVICE || DEFAULT_DEVICE;
  if (env.INSTA_CAPABILITIES) {
    ig.state.capabilitiesHeader = env.INSTA_CAPABILITIES;
  }

  if (verbose) {
    console.error(
      `   🔎 Client: Instagram ${ig.state.appVersion} (code ${ig.state.appVersionCode}); ` +
        `device ${ig.state.deviceString}`,
    );
  }
  return ig.state.appVersion;
}

/**
 * Whether an error is Instagram's `checkpoint_required` anti-automation block.
 *
 * The library only recognises `challenge_required` (which becomes an
 * IgCheckpointError and populates challenge state). `checkpoint_required` falls
 * through to a generic IgResponseError and is NOT resolvable via the code flow —
 * it must be cleared in a browser/app.
 */
export function isCheckpointRequired(error: unknown): error is IgResponseError {
  return (
    error instanceof IgResponseError &&
    (error.response?.body as { message?: string } | undefined)?.message ===
      'checkpoint_required'
  );
}

/**
 * Pull the browser checkpoint URL out of a `checkpoint_required` response body.
 * Instagram puts it in `checkpoint_url` (sometimes a relative path); we also fall
 * back to a nested `challenge.url`.
 */
export function extractCheckpointUrl(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;

  // Known fields first.
  const candidates = [
    b.checkpoint_url,
    (b.challenge as { url?: unknown } | undefined)?.url,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return /^https?:\/\//i.test(candidate)
        ? candidate
        : `https://i.instagram.com${candidate.startsWith('/') ? '' : '/'}${candidate}`;
    }
  }

  // Last resort: any value that already looks like a challenge/checkpoint link.
  for (const value of Object.values(b)) {
    if (
      typeof value === 'string' &&
      /^https?:\/\/\S*(challenge|checkpoint)/i.test(value)
    ) {
      return value;
    }
  }
  return undefined;
}

/** Append a "resolve in your browser" pointer to a message when a URL is known. */
export function withManualLink(message: string, url?: string): string {
  return url ? `${message}\n   🔗 Resolve it manually here: ${url}` : message;
}

/**
 * Retrieves the list of users who don't follow back on Instagram.
 *
 * Logs in through instagrapi (which reuses its saved session when still valid)
 * and continues that session on the same device — or, with `sessionId`, uses a
 * browser session directly. Recovers from a verification challenge fired
 * mid-request by driving the challenge flow through the provided handler.
 *
 * @param email - Instagram email
 * @param password - Instagram password
 * @param options - Fetch options (limit, challenge handler, browser session)
 * @returns Promise resolving to UnfollowerResult with list and statistics
 * @throws {InstagramError} If authentication fails or an API error occurs
 */
export async function getUnfollowers(
  email: string,
  password: string,
  options: GetUnfollowersOptions = {},
): Promise<UnfollowerResult> {
  const { limit, onChallenge, verbose = false, sessionId } = options;

  const session = sessionId ? parseSessionId(sessionId) : undefined;

  const ig = new IgApiClient();
  if (session) {
    ig.state.generateDevice(session.userId);
    // Replace the library's outdated bundled app version (Instagram rejects it
    // as `unsupported_version`) with current values or the env's.
    applyClientVersionOverrides(ig, verbose);
    ig.state.authorization = sessionAuthorization(session);
    if (verbose) {
      console.error(
        `   🔎 Using browser session for user id ${session.userId}.`,
      );
    }
  } else {
    applyInstagrapiSession(
      ig,
      await loginWithInstagrapi(email, password, verbose),
    );
    if (verbose) {
      console.error(
        `   🔎 Logged in with instagrapi; continuing on its device: Instagram ` +
          `${ig.state.appVersion}, ${ig.state.deviceString}`,
      );
    }
  }

  try {
    let data: { followers: FeedUser[]; following: FeedUser[] };
    try {
      data = await fetchFollowData(ig, limit);
    } catch (error) {
      if (!(error instanceof IgCheckpointError)) throw error;
      // A checkpoint fired mid-request (Instagram's anti-bot defense).
      if (verbose)
        console.error(
          '   🔎 Checkpoint hit during fetch; attempting challenge.',
        );
      await resolveChallenge(ig, onChallenge, verbose);
      // Retry once. If Instagram immediately re-checkpoints, the challenge did
      // not actually lift the block — it's an anti-scraping flag, not something
      // a code can clear.
      try {
        data = await fetchFollowData(ig, limit);
      } catch (retryError) {
        if (retryError instanceof IgCheckpointError) {
          throw new InstagramError(
            withManualLink(
              'Instagram re-issued a checkpoint right after verification. This is an ' +
                'anti-automation block on your account or IP, not a wrong code. Confirm ' +
                "it's you, then wait a while before retrying (and consider --limit to " +
                'fetch fewer profiles).',
              retryError.url ?? checkpointUrl(ig),
            ),
            InstagramErrorType.CHALLENGE_REQUIRED,
          );
        }
        throw retryError;
      }
    }

    return computeResult(data.followers, data.following);
  } catch (error) {
    if (session && isSessionRejected(error)) {
      throw new InstagramError(
        'Instagram rejected the sessionid (expired, logged out, or copied incorrectly). ' +
          'Log in again on instagram.com and copy a fresh "sessionid" cookie.',
        InstagramErrorType.INVALID_CREDENTIALS,
        { originalError: error instanceof Error ? error.message : error },
      );
    }
    // `checkpoint_required` (distinct from `challenge_required`) is a generic
    // IgResponseError the library doesn't special-case. Surface the browser link
    // so the user can clear it manually.
    if (isCheckpointRequired(error)) {
      const body = error.response?.body;
      if (verbose) {
        console.error(
          `   🔎 checkpoint_required body: ${JSON.stringify(body)}`,
        );
      }
      const url = extractCheckpointUrl(body);

      // `/web/unsupported_version/` means Instagram rejected the CLIENT version,
      // not your account.
      if (typeof url === 'string' && /unsupported_version/i.test(url)) {
        throw new InstagramError(
          `Instagram rejected the client as an unsupported app version ` +
            `(${ig.state.appVersion}). This is NOT an account problem. Set a current ` +
            `Instagram Android version via the INSTA_APP_VERSION and ` +
            `INSTA_APP_VERSION_CODE env vars (see the README), then re-run.`,
          InstagramErrorType.CHALLENGE_REQUIRED,
        );
      }

      throw new InstagramError(
        withManualLink(
          'Instagram returned a "checkpoint_required" block on your account or IP. ' +
            "It's an anti-automation flag the API can't clear on its own. Confirm " +
            "it's you in a browser (link below, or just open instagram.com), wait a " +
            'while, then re-run.',
          url,
        ),
        InstagramErrorType.CHALLENGE_REQUIRED,
      );
    }
    throw InstagramError.fromError(error);
  }
}

/**
 * Drive Instagram's verification challenge: auto-select a verify method
 * (prefers email), ask the handler for the code the user received, submit it,
 * and confirm the checkpoint actually cleared.
 *
 * Only code-entry challenges can be handled here. A web-only checkpoint (any
 * other step) is reported as such instead of prompting for a code that was never
 * sent. A wrong/expired code, or a checkpoint that stays open, surfaces as a
 * CHALLENGE_REQUIRED error.
 */
async function resolveChallenge(
  ig: IgApiClient,
  onChallenge?: ChallengeHandler,
  verbose = false,
): Promise<void> {
  // Capture the browser link before driving the flow (auto() may mutate state).
  const url = checkpointUrl(ig);
  if (url) {
    console.error(
      `\n   🔗 To verify manually, open this in your browser:\n      ${url}`,
    );
  }

  if (!onChallenge) {
    throw new InstagramError(
      withManualLink(
        'A verification challenge is required but no challenge handler was provided.',
        url,
      ),
      InstagramErrorType.CHALLENGE_REQUIRED,
    );
  }

  // `auto(true)` resets then, for a method-selection step, picks Instagram's
  // default method (typically email) and triggers the code. For any other step
  // it just returns the current challenge without sending anything.
  const challenge = await ig.challenge.auto(true);
  const step = challenge?.step_name ?? ig.state.challenge?.step_name;
  if (verbose) console.error(`   🔎 Challenge step: ${step ?? 'unknown'}`);

  // If we're not at a code-entry step, no code was sent — prompting for one would
  // just produce a guaranteed "wrong code". Tell the user to verify in a browser.
  if (!isSecurityCodeStep(step)) {
    throw new InstagramError(
      withManualLink(
        `This checkpoint can't be completed from the CLI (challenge step: ${step ?? 'unknown'}). ` +
          "Confirm it's you, then re-run.",
        url,
      ),
      InstagramErrorType.CHALLENGE_REQUIRED,
    );
  }

  const code = await onChallenge();
  if (!code) {
    throw new InstagramError(
      'No verification code was provided.',
      InstagramErrorType.CHALLENGE_REQUIRED,
    );
  }

  await ig.challenge.sendSecurityCode(code.trim());

  // The library clears `state.checkpoint` only when Instagram replies
  // `action: 'close'` — i.e. the challenge was genuinely satisfied. If it's still
  // set, the code wasn't accepted (or Instagram kept the checkpoint open).
  if (ig.state.checkpoint) {
    throw new InstagramError(
      withManualLink(
        'The verification code was not accepted, or Instagram kept the checkpoint open. ' +
          'Double-check the code, or complete the challenge in your browser.',
        checkpointUrl(ig) ?? url,
      ),
      InstagramErrorType.CHALLENGE_REQUIRED,
    );
  }
}

/**
 * Fetch followers and following.
 *
 * Fetched sequentially with a short delay between feeds: hammering both
 * paginated endpoints in parallel right after auth is a classic bot signal and
 * is what triggers checkpoints on otherwise-valid sessions.
 */
async function fetchFollowData(
  ig: IgApiClient,
  limit?: number,
): Promise<{ followers: FeedUser[]; following: FeedUser[] }> {
  const userId = ig.state.cookieUserId;

  const followers = await getAllItemsFromFeed(
    ig.feed.accountFollowers(userId),
    limit,
  );
  await delay(config.rateLimit.minDelay);
  const following = await getAllItemsFromFeed(
    ig.feed.accountFollowing(userId),
    limit,
  );

  return { followers, following };
}

/**
 * Compute the unfollowers list and statistics from the two follow lists.
 */
function computeResult(
  followers: ReadonlyArray<FeedUser>,
  following: ReadonlyArray<FeedUser>,
): UnfollowerResult {
  const followersUsername = new Set(followers.map(({ username }) => username));
  const followingUsername = new Set(following.map(({ username }) => username));

  const unfollowers = following
    .filter(({ username }) => !followersUsername.has(username))
    .map(({ username }) => username);

  const mutual = followers.filter(({ username }) =>
    followingUsername.has(username),
  ).length;

  return {
    unfollowers,
    stats: {
      followers: followers.length,
      following: following.length,
      unfollowers: unfollowers.length,
      mutual,
      ratio: following.length > 0 ? followers.length / following.length : 0,
    },
  };
}

/**
 * Fetches all items from an Instagram feed with an optional limit.
 *
 * @param feed - The Instagram feed to fetch items from
 * @param limit - Optional limit on the number of items to fetch
 * @returns Promise resolving to an array of feed items
 */
async function getAllItemsFromFeed<T>(
  feed: Feed<unknown, T>,
  limit?: number,
): Promise<T[]> {
  let items: T[] = [];
  do {
    const batch = await feed.items();
    items = items.concat(batch);

    if (limit && items.length >= limit) {
      return items.slice(0, limit);
    }
  } while (feed.isMoreAvailable());

  return items;
}

/** Resolve after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
