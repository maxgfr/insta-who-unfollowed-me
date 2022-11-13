import { IgApiClient, Feed } from 'instagram-private-api';

export async function getNotFollowingUsers(username: string, password: string): Promise<string[]> {
  const ig = new IgApiClient();
  ig.state.generateDevice(username);
  await ig.simulate.preLoginFlow();
  await ig.account.login(username, password);
  const followersFeed = ig.feed.accountFollowers(ig.state.cookieUserId);
  const followingFeed = ig.feed.accountFollowing(ig.state.cookieUserId);
  const followers = await getAllItemsFromFeed(followersFeed);
  const following = await getAllItemsFromFeed(followingFeed);
  const followersUsername = new Set(followers.map(({ username }) => username));
  const notFollowingYou = following.filter(({ username }) => !followersUsername.has(username));
  return notFollowingYou.map(({ username }) => username);
}

async function getAllItemsFromFeed<T>(feed: Feed<any, T>): Promise<T[]> {
  let items: any = [];
  do {
    items = items.concat(await feed.items());
  } while (feed.isMoreAvailable());
  return items;
  
}