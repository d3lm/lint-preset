#!/usr/bin/env node

/**
 * Fails when the native addon of a target in `napi.json` is missing, so that a release never ships
 * without Rust support for one of the platforms. CI builds each target on its own runner and puts
 * the binaries in place before publishing.
 */

import { readNapiConfig } from '@napi-rs/cli';
import { existsSync } from 'node:fs';
import path from 'node:path';

const NATIVE = import.meta.dirname;
const config = await readNapiConfig(path.join(NATIVE, '../package.json'), path.join(NATIVE, 'napi.json'));

const missing = config.targets
  .map((target) => `${config.binaryName}.${target.platformArchABI}.node`)
  .filter((file) => !existsSync(path.join(NATIVE, file)));

if (missing.length > 0) {
  console.error(`Missing native addons in native/: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`Found the native addons of ${config.targets.length} targets`);
