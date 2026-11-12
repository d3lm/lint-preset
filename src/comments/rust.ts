import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RustComment {
  /**
   * Holds the UTF-16 offset of the first character of the comment, like the `/` of `///`.
   */
  readonly start: number;

  /**
   * Holds the UTF-16 offset after the last character. A line comment ends before its line break.
   */
  readonly end: number;
  readonly block: boolean;
  readonly doc?: 'outer' | 'inner';
}

export interface RustScan {
  readonly comments: readonly RustComment[];

  /**
   * Describes the first token that never ends, like an unterminated block comment or string.
   */
  readonly error?: { readonly message: string; readonly offset: number };
}

interface NativeBinding {
  scanRust(source: string): RustScan;
  rustFingerprint(source: string): string;
  isRustCode(text: string): boolean;
}

const BINARY_NAME = 'comments';

/**
 * Lists the platform suffixes that `napi build --platform` gives the binary, in the order to try
 * them. A Linux binary is built for either glibc or musl, so both are candidates.
 */
function platformSuffixes(): string[] {
  const { platform, arch } = process;

  switch (platform) {
    case 'darwin': {
      return [`darwin-${arch}`, 'darwin-universal'];
    }

    case 'linux': {
      return arch === 'arm'
        ? ['linux-arm-gnueabihf', 'linux-arm-musleabihf']
        : [`linux-${arch}-gnu`, `linux-${arch}-musl`];
    }

    case 'win32': {
      return [`win32-${arch}-msvc`, `win32-${arch}-gnu`];
    }

    default: {
      return [`${platform}-${arch}`];
    }
  }
}

/**
 * The module runs from `src/comments`, `dist`, or `dist/bin`, so the `native` directory is looked
 * up in the directories above it.
 */
function findBinaries(): string[] {
  const names = platformSuffixes().map((suffix) => `${BINARY_NAME}.${suffix}.node`);

  for (let directory = path.dirname(fileURLToPath(import.meta.url)); ; directory = path.dirname(directory)) {
    const found = names.map((name) => path.join(directory, 'native', name)).filter((file) => existsSync(file));

    if (found.length > 0) {
      return found;
    }

    if (path.dirname(directory) === directory) {
      return [];
    }
  }
}

let binding: NativeBinding | undefined;

function loadBinding(): NativeBinding {
  if (binding) {
    return binding;
  }

  const require = createRequire(import.meta.url);
  const errors: string[] = [];

  for (const file of findBinaries()) {
    try {
      binding = require(file) as NativeBinding;

      return binding;
    } catch (error) {
      errors.push(`${file}: ${(error as Error).message}`);
    }
  }

  const reason = errors.length > 0 ? `, and loading it failed (${errors.join('; ')})` : '';

  throw new Error(
    `comments: Rust files need the native addon for ${process.platform}-${process.arch}${reason}. Build it with \`pnpm run build:native\`, or leave \`.rs\` out of \`extensions\`.`,
  );
}

export function scanRust(source: string): RustScan {
  return loadBinding().scanRust(source);
}

export function rustFingerprint(source: string): string {
  return loadBinding().rustFingerprint(source);
}

export function isRustCode(text: string): boolean {
  return loadBinding().isRustCode(text);
}
