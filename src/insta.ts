import { IgApiClient, Feed } from 'instagram-private-api';
import { UnfollowerResult, InstagramError } from './types';

/**
 * Retrieves the list of users who don't follow back on Instagram.
 *
 * @param email - Instagram email
 * @param password - Instagram password
 * @param withPreLoginFlow - Whether to simulate pre-login flow (recommended for first attempt)
 * @param limit - Optional limit on the number of followers/following to fetch
 * @returns Promise resolving to UnfollowerResult with list and statistics
 * @throws {InstagramError} If authentication fails or API error occurs
 */
export async function getUnfollowers(
  email: string,
  password: string,
  withPreLoginFlow: boolean,
  limit?: number,
): Promise<UnfollowerResult> {
  try {
    const ig = new IgApiClient();
    ig.state.generateDevice(email);
    
    if (withPreLoginFlow) {
      await ig.simulate.preLoginFlow();
    }
    
    await ig.account.login(email, password);
    
    const followersFeed = ig.feed.accountFollowers(ig.state.cookieUserId);
    const followingFeed = ig.feed.accountFollowing(ig.state.cookieUserId);
    
    // Fetch followers and following in parallel for better performance
    const [followers, following] = await Promise.all([
      getAllItemsFromFeed(followersFeed, limit),
      getAllItemsFromFeed(followingFeed, limit),
    ]);
    
    const followersUsername = new Set(followers.map(({ username }) => username));
    const notFollowingYou = following.filter(
      ({ username }) => !followersUsername.has(username),
    );
    
    const unfollowers = notFollowingYou.map(({ username }) => username);
    const mutual = followers.filter(({ username }) => 
      following.some(f => f.username === username)
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
  } catch (error) {
    throw InstagramError.fromError(error);
  }
}

/**
 * Fetches all items from an Instagram feed with optional limit.
 * 
 * @param feed - The Instagram feed to fetch items from
 * @param limit - Optional limit on the number of items to fetch
 * @returns Promise resolving to an array of feed items
 */
async function getAllItemsFromFeed<T>(
  feed: Feed<unknown, T>,
  limit?: number
): Promise<T[]> {
  try {
    let items: T[] = [];
    do {
      const batch = await feed.items();
      items = items.concat(batch);
      
      if (limit && items.length >= limit) {
        return items.slice(0, limit);
      }
    } while (feed.isMoreAvailable());
    
    return items;
  } catch (error) {
    throw InstagramError.fromError(error);
  }
}
