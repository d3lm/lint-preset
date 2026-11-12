export interface RandomCommentOptions {
  /**
   * Adds more words that can end up anywhere on a line.
   */
  readonly extra?: readonly string[];

  /**
   * Whether paragraphs can be JSDoc tags like `@param name - ...`.
   * Without tags, those paragraphs are plain prose.
   */
  readonly tags?: boolean;

  /**
   * Replaces the structures a paragraph can take instead of prose, like a table or a code block.
   */
  readonly structures?: readonly (readonly string[])[];
}

export interface RandomCommentBody {
  readonly indent: string;

  /**
   * Holds the text of each line without its comment prefix, with an empty
   * string between paragraphs.
   */
  readonly lines: readonly string[];
}

const STRUCTURES = [
  ['| a | b |', '| - | - |'],
  ['```ts', 'const a = 1;', '```'],
  ['┌──┐', '└──┘'],
];

/**
 * Generates comments from words, sentence ends, long words, and words that start a block when they
 * begin a line.
 */
export function randomComments(initialSeed: number, options: RandomCommentOptions = {}) {
  const { extra = [], tags = true, structures = STRUCTURES } = options;

  let seed = initialSeed;

  // the constants are those of the Park-Miller generator
  const random = (): number => {
    seed = (seed * 16_807) % 2_147_483_647;

    return (seed - 1) / 2_147_483_646;
  };

  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const between = (low: number, high: number): number => low + Math.floor(random() * (high - low + 1));

  const words = ['the', 'request', 'socket', 'closes', 'a', 'of', 'it', 'returns', 'config', 'width', 'lines'];

  const ends = [
    'done.',
    'here.',
    'stops!',
    'why?',
    'first,',
    'then,',
    'e.g.',
    'i.e.',
    'etc.',
    'vs.',
    '(the',
    '(see',
    ...extra,
  ];

  const starts = [
    '@types/node',
    '@param',
    '-',
    '*',
    '+',
    '1.',
    '2)',
    '#',
    '>',
    '<div>',
    '```',
    '~~~',
    'eslint-disable',
    'prettier-ignore',
  ];

  const token = (): string => {
    const roll = random();

    if (roll < 0.6) {
      return pick(words);
    }

    if (roll < 0.78) {
      return pick(ends);
    }

    if (roll < 0.92) {
      return pick(starts);
    }

    return roll < 0.96 ? `\`${'x'.repeat(between(4, 90))}\`` : `https://example.com/${'a'.repeat(between(4, 90))}`;
  };

  const lines = (count: number): string[][] => {
    const result: string[][] = [[pick(words)]];

    for (let index = 1; index < count; index += 1) {
      const next = token();

      if (random() < 0.25 && !starts.includes(next)) {
        result.push([next]);
      } else {
        result.at(-1)?.push(next);
      }
    }

    return result;
  };

  const paragraph = (): readonly string[] => {
    const roll = random();
    const body = lines(between(1, 30));

    if (roll < 0.5) {
      return body.map((line) => line.join(' '));
    }

    if (roll < 0.7) {
      return body.map((line, index) => `${index === 0 ? '- ' : '  '}${line.join(' ')}`);
    }

    if (roll < 0.85) {
      return body.map((line, index) => `${index === 0 && tags ? '@param name - ' : ''}${line.join(' ')}`);
    }

    return pick(structures);
  };

  const commentBody = (): RandomCommentBody => {
    const indent = pick(['', '  ', '\t']);
    const paragraphs = Array.from({ length: between(1, 3) }, paragraph);

    return { indent, lines: paragraphs.flatMap((body, index) => (index === 0 ? body : ['', ...body])) };
  };

  const comment = (): string => {
    const { indent, lines: body } = commentBody();

    return `${indent}/**\n${body.map((line) => `${indent} *${line ? ` ${line}` : ''}`).join('\n')}\n${indent} */\n`;
  };

  return { random, between, pick, comment, commentBody };
}
