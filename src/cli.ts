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
  const { username, password } = await prompts(
    questions,
  );
  return { username, password };
}

async function processUserInformations() {
  const { username, password } = await promptUser();
  if (!username || !password) {
    console.log('Missing informations 😭');
    return;
  }
  const listOfUnfollowers = await getUnfollowers(username, password);
  console.log(listOfUnfollowers);
}

export async function runCommand() {
  const program = new Command();

  program
    .name('insta-who-unfollowed-me')
    .description('Utility to make it easy to track unfollowers on Instagram')
    .action(() => processUserInformations());

  program.parse();
}