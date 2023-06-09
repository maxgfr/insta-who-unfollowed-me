import prompts from 'prompts';
import { Command } from 'commander';
import { getUnfollowers } from './insta';

type PromptResult = {
  username: string;
  password: string;
};

const questions: Array<prompts.PromptObject> = [
  {
    type: 'text',
    name: 'username',
    message: 'My instagram username:',
  },
  {
    type: 'password',
    name: 'password',
    message: 'My instagram password:',
  },
];

async function promptUser(): Promise<Partial<PromptResult>> {
  const { username, password } = await prompts(questions);
  return { username, password };
}

async function processUserInformations() {
  const { username, password } = await promptUser();
  if (!username || !password) {
    console.log('Missing informations 😭');
    return;
  }

  let listOfUnfollowers: Array<string> | null = null;
  let retryCount = 0;
  const maxRetries = 3;

  while (retryCount < maxRetries) {
    try {
      listOfUnfollowers = await getUnfollowers(
        username,
        password,
        retryCount === 0,
      );
      break;
    } catch (error) {
      retryCount++;
      console.log(`Retrying... (${retryCount}/${maxRetries})`);
    }
  }

  if (listOfUnfollowers) {
    console.log('List of unfollowers:');
    console.log(listOfUnfollowers);
  } else {
    console.log('Failed to get unfollowers after maximum retries. 😢');
  }
}

export async function runCommand() {
  const program = new Command();

  program
    .name('insta-who-unfollowed-me')
    .description('Utility to make it easy to track unfollowers on Instagram')
    .action(() => processUserInformations());

  program.parse();
}
