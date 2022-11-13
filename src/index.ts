#! /usr/bin/env node
import { runCommand } from './cli';

if (require.main === module) {
  runCommand();
}