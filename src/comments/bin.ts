#!/usr/bin/env node
import { log, main } from './cli.js';

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  log((error as Error).message);

  process.exitCode = 2;
}
