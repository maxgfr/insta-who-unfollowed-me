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
import { loadSession, saveSession, clearSession } from './session';

/** Minimal shape we rely on from a follower/following feed item. */
interface FeedUser {
  username: string;
}

/**
 * Options controlling how unfollowers are fetched.
 */
export interface GetUnfollowersOptions {
  /** Simulate Instagram's pre-login traffic before a fresh login (recommended on the first attempt). */
  withPreLoginFlow?: boolean;
  /** Cap the number of followers/following fetched per feed. */
  limit?: number;
  /** Called when Instagram requires a verification challenge; should resolve with the code. */
  onChallenge?: ChallengeHandler;
  /** Emit diagnostic details (e.g. the challenge step) to stderr. */
  verbose?: boolean;
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
 * @see https://github.com/subzeroid/instagrapi/blob/master/instagrapi/config.py
 */
const DEFAULT_APP_VERSION = '428.0.0.47.67';
const DEFAULT_APP_VERSION_CODE = '961145276';
const DEFAULT_BLOKS_VERSION_ID =
  '7189b949425f9bf80ea8bd880cf5a3080b292d9b1c4b38a18d112f7c4b71e7a8';
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
 * Reuses a persisted session when one exists (avoiding most checkpoints), falls
 * back to a fresh login otherwise, and recovers from a verification challenge —
 * whether it fires during login or mid-request — by driving the challenge flow
 * through the provided handler.
 *
 * @param email - Instagram email
 * @param password - Instagram password
 * @param options - Fetch options (pre-login flow, limit, challenge handler)
 * @returns Promise resolving to UnfollowerResult with list and statistics
 * @throws {InstagramError} If authentication fails or an API error occurs
 */
export async function getUnfollowers(
  email: string,
  password: string,
  options: GetUnfollowersOptions = {},
): Promise<UnfollowerResult> {
  const {
    withPreLoginFlow = true,
    limit,
    onChallenge,
    verbose = false,
  } = options;

  const ig = new IgApiClient();
  ig.state.generateDevice(email);
  // Replace the library's outdated bundled app version (Instagram rejects it as
  // `unsupported_version`) with whatever the env supplies.
  const appVersion = applyClientVersionOverrides(ig, verbose);

  try {
    const restored = await restoreSession(ig, email);
    if (!restored) {
      await login(ig, email, password, withPreLoginFlow, onChallenge, verbose);
    }

    let data: { followers: FeedUser[]; following: FeedUser[] };
    try {
      data = await fetchFollowData(ig, limit);
    } catch (error) {
      if (restored && error instanceof IgLoginRequiredError) {
        // The persisted session has expired — drop it and log in fresh.
        if (verbose)
          console.error('   🔎 Saved session expired; logging in fresh.');
        await clearSession(email);
        await login(
          ig,
          email,
          password,
          withPreLoginFlow,
          onChallenge,
          verbose,
        );
        data = await fetchFollowData(ig, limit);
      } else if (error instanceof IgCheckpointError) {
        // A checkpoint fired mid-request (Instagram's anti-bot defense).
        if (verbose)
          console.error(
            '   🔎 Checkpoint hit during fetch; attempting challenge.',
          );
        await resolveChallenge(ig, onChallenge, verbose);
        await saveSession(email, await serializeState(ig));
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
      } else {
        throw error;
      }
    }

    return computeResult(data.followers, data.following);
  } catch (error) {
    // `checkpoint_required` (distinct from `challenge_required`) is a generic
    // IgResponseError the library doesn't special-case. Surface the browser link
    // so the user can clear it manually, whether it fired at login or mid-fetch.
    if (isCheckpointRequired(error)) {
      const body = error.response?.body;
      if (verbose) {
        console.error(
          `   🔎 checkpoint_required body: ${JSON.stringify(body)}`,
        );
      }
      const url = extractCheckpointUrl(body);

      // `/web/unsupported_version/` means Instagram rejected the CLIENT version,
      // not your account — the bundled library is simply too old.
      if (typeof url === 'string' && /unsupported_version/i.test(url)) {
        throw new InstagramError(
          `Instagram rejected the client as an unsupported app version (the bundled ` +
            `library uses ${appVersion}, which is outdated). This is NOT an account ` +
            `problem. Set a current Instagram Android version via the INSTA_APP_VERSION ` +
            `and INSTA_APP_VERSION_CODE env vars (get them from apkmirror.com), then ` +
            `re-run. Note: instagram-private-api is unmaintained, so even an updated ` +
            `version may not work — see the README.`,
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
 * Restore a persisted session into the client.
 *
 * @returns `true` if a usable session was applied, `false` if none existed or it
 *          was corrupt (in which case it's discarded and a fresh login is needed).
 */
async function restoreSession(
  ig: IgApiClient,
  email: string,
): Promise<boolean> {
  const saved = await loadSession(email);
  if (!saved) return false;
  try {
    await ig.state.deserialize(saved);
    return true;
  } catch {
    await clearSession(email);
    return false;
  }
}

/**
 * Perform a fresh login: simulate pre-login traffic, authenticate, resolve a
 * challenge if one fires, then persist the session for next time.
 */
async function login(
  ig: IgApiClient,
  email: string,
  password: string,
  withPreLoginFlow: boolean,
  onChallenge?: ChallengeHandler,
  verbose = false,
): Promise<void> {
  if (withPreLoginFlow) {
    await ig.simulate.preLoginFlow();
  }

  try {
    await ig.account.login(email, password);
  } catch (error) {
    if (error instanceof IgCheckpointError) {
      await resolveChallenge(ig, onChallenge, verbose);
    } else {
      throw error;
    }
  }

  await saveSession(email, await serializeState(ig));
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
 * Serialize the client's auth state for persistence, stripping the volatile
 * `constants` key the library advises not to store.
 */
async function serializeState(
  ig: IgApiClient,
): Promise<Record<string, unknown>> {
  const state = (await ig.state.serialize()) as Record<string, unknown>;
  delete state.constants;
  return state;
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
