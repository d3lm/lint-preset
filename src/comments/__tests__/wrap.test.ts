import {
  bindLineStarts,
  breakAfterSentence,
  findLineIssues,
  hasWidow,
  isAbbreviation,
  layoutTokens,
  startsBlock,
  tokenize,
  toleranceLimits,
  wrapTokens,
  type LayoutOptions,
  type WrapOptions,
} from '../wrap.js';
import { randomComments } from './helpers/random-comments.js';

const options: WrapOptions = { tolerance: 0, avoidSentenceOrphans: true };

function wrap(text: string, limit: number, overrides: Partial<WrapOptions> = {}): string[] {
  return wrapTokens(tokenize(text), limit, limit, { ...options, ...overrides }).map((line) => line.join(' '));
}

function breakAfter(text: string, limit: number, overrides: Partial<WrapOptions> = {}): string[] {
  const wrapOptions = { ...options, ...overrides };
  const lines = wrapTokens(tokenize(text), limit, limit, wrapOptions);

  return breakAfterSentence(lines, limit, limit, wrapOptions).map((line) => line.join(' '));
}

function lines(...values: string[]): string[][] {
  return values.map((value) => tokenize(value));
}

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('  one two\tthree  ')).toEqual(['one', 'two', 'three']);
  });

  it('keeps code spans intact, including their spaces', () => {
    expect(tokenize('use `foo bar` and (`a b`).')).toEqual(['use', '`foo bar`', 'and', '(`a b`).']);
  });

  it('keeps code spans delimited by several backticks intact, like in Markdown', () => {
    expect(tokenize('like `` `width`: the width `` here')).toEqual(['like', '`` `width`: the width ``', 'here']);
    expect(tokenize('a ``` `` ``` b')).toEqual(['a', '``` `` ```', 'b']);
  });

  it('treats a backtick run that never closes as literal text', () => {
    expect(tokenize('an `` unclosed run and `code span` here')).toEqual([
      'an',
      '``',
      'unclosed',
      'run',
      'and',
      '`code span`',
      'here',
    ]);
  });

  it('keeps balanced braces intact', () => {
    expect(tokenize('@param {Map<string, { a: 1 }>} x see {@link Foo bar}')).toEqual([
      '@param',
      '{Map<string, { a: 1 }>}',
      'x',
      'see',
      '{@link Foo bar}',
    ]);
  });

  it('treats an unmatched backtick as a regular character', () => {
    expect(tokenize('a ` b')).toEqual(['a', '`', 'b']);
  });

  it('keeps each form of a Markdown link intact, including its spaces', () => {
    const links = [
      '[a link to an anchor](crate::Provider#method.reads)',
      '[the provider module][`provider`]',
      '[the provider module][]',
      '[HashMap<K, V>]',
      '[`Result<T, E>`]',
      '![an image of it](./image.png)',
      '[link](https://example.com/a-path?query=value#anchor "with a title")',
      "[link](https://example.com 'with a title')",
      '[link](https://example.com (with a title))',
      '[link](<a path with spaces.md>)',
      '[link]( crate::path )',
    ];

    for (const link of links) {
      expect(tokenize(`see ${link} for more`), link).toEqual(['see', link, 'for', 'more']);
      expect(tokenize(`(see ${link}), then`), link).toEqual(['(see', `${link}),`, 'then']);
    }
  });

  it('pairs up the brackets and parentheses of a link like Markdown', () => {
    for (const link of [
      '[an [inner pair] of brackets](a::b)',
      String.raw`[an escaped \] bracket](a::b)`,
      String.raw`[an escaped \[ bracket][label one]`,
      '[a code span `with ] in it` here]',
      '[a call](crate::call(a, b) "a title")',
      String.raw`[a paren](crate::call\) "a title")`,
      '[a title](crate::a "with a ) in it")',
      "[a title](crate::a 'with a ) in it')",
      '[a path](<with a ) in it> "and a title")',
    ]) {
      expect(tokenize(`see ${link} for more`), link).toEqual(['see', link, 'for', 'more']);
    }
  });

  it('gives the words of a link one space each, like the words around it, but keeps its code spans', () => {
    expect(tokenize('a   [the   provider\tmodule](crate::a   "a   title")   b')).toEqual([
      'a',
      '[the provider module](crate::a "a title")',
      'b',
    ]);

    expect(tokenize('[the  `a  b`  and  {c  d}  parts]')).toEqual(['[the `a  b` and {c  d} parts]']);
    expect(tokenize('- [ ] an open task')).toEqual(['-', '[ ]', 'an', 'open', 'task']);
  });

  it('treats a bracket that never closes, or that a backslash escapes, as a regular character', () => {
    expect(tokenize('the range [0, 1) and [a b]')).toEqual(['the', 'range', '[0,', '1)', 'and', '[a b]']);
    expect(tokenize('a [ b [c d](e) f')).toEqual(['a', '[', 'b', '[c d](e)', 'f']);

    expect(tokenize(String.raw`an escaped \[a b\] pair`)).toEqual([
      'an',
      'escaped',
      String.raw`\[a`,
      String.raw`b\]`,
      'pair',
    ]);

    expect(tokenize(String.raw`a backslash \\[a b] before`)).toEqual(['a', 'backslash', String.raw`\\[a b]`, 'before']);
    expect(tokenize('a [code `span ] that` goes on')).toEqual(['a', '[code', '`span ] that`', 'goes', 'on']);
  });

  it('keeps whichever of a link and a `{...}` group starts first', () => {
    // a brace is no syntax in Markdown, so one in the text of a link never hides the end of the link
    expect(tokenize('see [a {b c](d) and } more')).toEqual(['see', '[a {b c](d)', 'and', '}', 'more']);
    expect(tokenize('see [a {b  c} d](e) more')).toEqual(['see', '[a {b  c} d](e)', 'more']);
    expect(tokenize('see {@link Foo | [a b} c] more')).toEqual(['see', '{@link Foo | [a b}', 'c]', 'more']);
  });

  it('only joins a destination or label that comes right after the text of a link', () => {
    expect(tokenize('[a b] (c d) [e f] [g h]')).toEqual(['[a b]', '(c', 'd)', '[e f]', '[g h]']);
    expect(tokenize('[a b](c d and more')).toEqual(['[a b](c', 'd', 'and', 'more']);
    expect(tokenize('items[i + 1](a, b) and [x]: y z')).toEqual(['items[i + 1](a, b)', 'and', '[x]:', 'y', 'z']);
  });
});

describe('wrapTokens', () => {
  it('fills lines greedily', () => {
    expect(wrap('aaa bbb ccc ddd eee', 11)).toEqual(['aaa bbb ccc', 'ddd eee']);
  });

  it('puts a token longer than the limit on its own line', () => {
    expect(wrap('a https://example.com/very/long b', 10)).toEqual(['a', 'https://example.com/very/long', 'b']);
  });

  it('moves the first word of a new sentence to the next line', () => {
    expect(wrap('It ends here. This continues on', 18)).toEqual(['It ends here.', 'This continues on']);

    expect(wrap('It ends here. This continues on', 18, { avoidSentenceOrphans: false })).toEqual([
      'It ends here. This',
      'continues on',
    ]);
  });

  it('moves the first word of a parenthetical to the next line', () => {
    expect(wrap('when the text reflows (the editor replaces it)', 26)).toEqual([
      'when the text reflows',
      '(the editor replaces it)',
    ]);

    expect(wrap('a word (`code`) and more text here', 15)).toEqual(['a word (`code`)', 'and more text', 'here']);
  });

  it('moves the first word after a semicolon or colon to the next line', () => {
    expect(wrap('the add button; and the selected items', 22)).toEqual(['the add button;', 'and the selected items']);
    expect(wrap('the add button: these selected items', 21)).toEqual(['the add button:', 'these selected items']);
  });

  it('lets the first word after a comma end a line', () => {
    expect(wrap('the add button, these selected items', 21)).toEqual(['the add button, these', 'selected items']);
    expect(wrap('red, green, and blue', 15)).toEqual(['red, green, and', 'blue']);

    // the same text ends its first line early after any other punctuation
    for (const mark of ['.', '!', '?', ';', ':']) {
      expect(wrap(`the add button${mark} these selected items`, 21), mark).toEqual([
        `the add button${mark}`,
        'these selected items',
      ]);
    }
  });

  it('lets the first word after a comma end a line when a bracket or quote closes after the comma', () => {
    expect(wrap('(the add button), these selected items', 23)).toEqual(['(the add button), these', 'selected items']);
    expect(wrap('"the add button," these selected items', 23)).toEqual(['"the add button," these', 'selected items']);
    expect(wrap('the add `button`, these selected items', 23)).toEqual(['the add `button`, these', 'selected items']);

    expect(wrap('(the add button.) These selected items', 23)).toEqual(['(the add button.)', 'These selected items']);
    expect(wrap('"the add button;" these selected items', 23)).toEqual(['"the add button;"', 'these selected items']);
  });

  it('lets the first word after a comma that follows an abbreviation end a line', () => {
    expect(wrap('use a helper, e.g., the one here', 23)).toEqual(['use a helper, e.g., the', 'one here']);
    expect(wrap('use a helper (etc.), the one here', 24)).toEqual(['use a helper (etc.), the', 'one here']);
  });

  it('wraps text whose only punctuation is commas the same with and without the orphan rule', () => {
    const text =
      'the add button, the selection filter dropdown, "the selected item count," the `select mode` toggle, and the media view controls';

    const limitsThatDiffer = (value: string): number[] => {
      const limits = Array.from({ length: 80 }, (_, index) => index + 8);

      return limits.filter((limit) => {
        return wrap(value, limit).join('\n') !== wrap(value, limit, { avoidSentenceOrphans: false }).join('\n');
      });
    };

    expect(limitsThatDiffer(text)).toEqual([]);

    // the rule does move words of the same text once a sentence ends in it
    expect(limitsThatDiffer(text.replace('dropdown,', 'dropdown.'))).not.toEqual([]);
  });

  it('moves a sentence start and a parenthetical down together', () => {
    expect(wrap('It ends. This (the aside) goes on', 16)).toEqual(['It ends.', 'This (the aside)', 'goes on']);
  });

  it('does not treat abbreviations as sentence ends', () => {
    expect(wrap('Use a helper, e.g. Foo works fine', 18)).toEqual(['Use a helper, e.g.', 'Foo works fine']);
    expect(wrap('see e.g. the docs', 12)).toEqual(['see e.g. the', 'docs']);
  });

  it('does not treat abbreviations inside brackets or quotes as sentence ends', () => {
    expect(findLineIssues(lines('It hits a limit (e.g. the', 'width) and more'), 25, 25, options)).toEqual([]);
    expect(findLineIssues(lines('It takes a, b, etc.) and', 'more words here'), 24, 24, options)).toEqual([]);
    expect(findLineIssues(lines('It reads "i.e." as', 'one word'), 18, 18, options)).toEqual([]);
  });

  it('still treats a sentence end after an abbreviation in brackets as one', () => {
    expect(findLineIssues(lines('It takes a, b, etc.). This', 'goes on'), 26, 26, options)).toEqual([
      { type: 'orphan', line: 0 },
    ]);
  });

  it('allows a one-word sentence at the end of a line', () => {
    expect(wrap('It works. Done. And more text', 15)).toEqual(['It works. Done.', 'And more text']);
  });

  it('uses a separate limit for the first line', () => {
    const lines = wrapTokens(tokenize('aa bb cc dd ee ff'), 5, 8, options).map((line) => line.join(' '));

    expect(lines).toEqual(['aa bb', 'cc dd ee', 'ff']);
  });

  it('never starts a line with a word that would begin a list, heading, or JSDoc tag', () => {
    expect(wrap('aaaa bbbb - cccc', 9)).toEqual(['aaaa', 'bbbb -', 'cccc']);
    expect(wrap('aaaa bbbb 2. cccc', 9, { avoidSentenceOrphans: false })).toEqual(['aaaa', 'bbbb 2.', 'cccc']);
    expect(wrap('aaaa bbbb @types/node', 16)).toEqual(['aaaa', 'bbbb @types/node']);
    expect(wrap('aaaa bbbb # cccc', 9)).toEqual(['aaaa', 'bbbb #', 'cccc']);
  });

  it('keeps a block-starting word at the start when no earlier word can move with it', () => {
    expect(wrap('aaaaaaaaa - b', 9)).toEqual(['aaaaaaaaa', '- b']);
  });

  it('never breaks a line inside a link, however narrow the lines are', () => {
    const links = [
      '[the provider module][`provider`]',
      '[a link to an anchor](crate::Provider#method.reads)',
      '[HashMap<K, V>]',
      '[link](https://example.com/a-path "with a title")',
    ];

    const text = `See ${links[0]} for the rest. A ${links[1]} also resolves, and so do ${links[2]} and a ${links[3]} here.`;

    for (let limit = 1; limit <= 120; limit += 1) {
      for (const avoidSentenceOrphans of [true, false]) {
        const wrapped = wrap(text, limit, { avoidSentenceOrphans });

        for (const link of links) {
          expect(
            wrapped.filter((line) => line.includes(link)),
            `${link} at ${limit}`,
          ).toHaveLength(1);
        }

        expect(wrapped.join(' ')).toBe(text);
      }
    }

    // a link that no longer fits after the words before it moves to the next line as a whole
    expect(wrap(text, 37)[0]).toBe('See [the provider module][`provider`]');
    expect(wrap(text, 36).slice(0, 2)).toEqual(['See', '[the provider module][`provider`]']);
  });
});

describe('breakAfterSentence', () => {
  it('ends the first of two lines with the last sentence whose rest fits on the second line', () => {
    expect(breakAfter('A wrap goes on to the end. It ends here now', 34)).toEqual([
      'A wrap goes on to the end.',
      'It ends here now',
    ]);

    expect(breakAfter('One two three four. Five six. Seven eight nine', 41)).toEqual([
      'One two three four. Five six.',
      'Seven eight nine',
    ]);
  });

  it('keeps the break when the second line would stick out past the first', () => {
    expect(breakAfter('It ends here. A wrap goes on to the end', 25)).toEqual([
      'It ends here. A wrap goes',
      'on to the end',
    ]);

    expect(breakAfter('It ends here. A wrap goes on to the end', 24)).toEqual([
      'It ends here. A wrap',
      'goes on to the end',
    ]);
  });

  it('moves the break when the second line is as long as the first, but not when it is one column longer', () => {
    expect(breakAfter('Aaa bbb cc. Ddd eee fff', 19)).toEqual(['Aaa bbb cc.', 'Ddd eee fff']);
    expect(breakAfter('Aaa bbb c. Ddd eee fff', 18)).toEqual(['Aaa bbb c. Ddd eee', 'fff']);
  });

  it('compares the columns that the lines end at when the first line has a lower limit', () => {
    const breakAt = (text: string): string[] => {
      const wrapped = wrapTokens(tokenize(text), 20, 24, options);

      return breakAfterSentence(wrapped, 20, 24, options).map((line) => line.join(' '));
    };

    expect(breakAt('Aaa bbb c. Ddd eee fff gg')).toEqual(['Aaa bbb c.', 'Ddd eee fff gg']);
    expect(breakAt('Aaa bbb c. Ddd eee fff ggg')).toEqual(['Aaa bbb c. Ddd eee', 'fff ggg']);
  });

  it('does not treat abbreviations as sentence ends', () => {
    expect(breakAfter('See all of the docs, e.g. Foo and Bar here', 33)).toEqual([
      'See all of the docs, e.g. Foo and',
      'Bar here',
    ]);
  });

  it('only moves the break of two lines, and only when sentence orphans are avoided', () => {
    expect(breakAfter('Alpha beta. Gamma delta epsilon zeta eta theta iota kappa', 24)).toEqual([
      'Alpha beta. Gamma delta',
      'epsilon zeta eta theta',
      'iota kappa',
    ]);

    expect(breakAfter('A wrap goes on to the end. It ends here now', 34, { avoidSentenceOrphans: false })).toEqual([
      'A wrap goes on to the end. It ends',
      'here now',
    ]);
  });
});

describe('findLineIssues', () => {
  it('flags overflowing lines with more than one token', () => {
    expect(findLineIssues(lines('aaa bbb ccc', 'd'), 7, 7, options)).toEqual([{ type: 'overflow', line: 0 }]);
    expect(findLineIssues(lines('https://example.com/long'), 7, 7, options)).toEqual([]);
  });

  it('respects the overflow tolerance', () => {
    expect(findLineIssues(lines('aaa bbb', 'c'), 6, 6, { ...options, tolerance: 1 })).toEqual([]);
  });

  it('flags lines that end early', () => {
    expect(findLineIssues(lines('aaa', 'bbb ccc'), 11, 11, options)).toEqual([{ type: 'underfill', line: 0 }]);
  });

  it('flags lines that end with the first word of a sentence', () => {
    expect(findLineIssues(lines('It ends. This', 'goes on'), 13, 13, options)).toEqual([{ type: 'orphan', line: 0 }]);
  });

  it('also flags a line that ends with the first word of a sentence when it ends early', () => {
    expect(findLineIssues(lines('It ends. This', 'goes on'), 20, 20, options)).toEqual([
      { type: 'orphan', line: 0 },
      { type: 'underfill', line: 0 },
    ]);
  });

  it('flags lines that end with the first word after a semicolon or colon, or of a parenthetical', () => {
    for (const first of ['It ends; this', 'It ends: this', 'It ends (this']) {
      expect(findLineIssues(lines(first, 'goes on'), 13, 13, options), first).toEqual([{ type: 'orphan', line: 0 }]);
    }
  });

  it('does not flag a line that ends with the first word after a comma', () => {
    for (const first of ['It ends, this', 'It ends), and', 'It ends," and', 'It e.g., this']) {
      expect(findLineIssues(lines(first, 'goes on'), 13, 13, options), first).toEqual([]);
    }
  });

  it('never flags its own output', () => {
    const words =
      'the `quick brown` fox. Jumps (over a) lazy (dog, e.g. Rex! It (then sleeps) for https://x.y/z hours'.split(' ');

    for (let seed = 1; seed <= 200; seed += 1) {
      const count = 5 + (seed % 40);
      const text = Array.from({ length: count }, (_, index) => words[(seed * 7 + index * 13) % words.length]).join(' ');

      for (const limit of [8, 20, 33, 60]) {
        for (const avoidSentenceOrphans of [true, false]) {
          const wrapOptions = { tolerance: 0, avoidSentenceOrphans };
          const wrapped = wrapTokens(tokenize(text), limit, limit, wrapOptions);

          expect(findLineIssues(wrapped, limit, limit, wrapOptions)).toEqual([]);
        }
      }
    }
  });
});

describe('toleranceLimits', () => {
  it('lets every line but the last end the tolerance past its limit', () => {
    expect(toleranceLimits(lines('aaaa bbbb', 'cccc dddd', 'eeee'), 20, 20, 3)).toEqual([23, 23, 20]);
    expect(toleranceLimits(lines('aaaa bbbb'), 20, 20, 3)).toEqual([23]);
    expect(toleranceLimits([], 20, 20, 3)).toEqual([]);
  });

  it('lets the last line end the tolerance after the longest line before it, but never before its limit', () => {
    // a line before it that reaches the limit leaves the last line all of the tolerance
    expect(toleranceLimits(lines('a'.repeat(20), 'b'), 20, 20, 3)).toEqual([23, 23]);
    expect(toleranceLimits(lines('a'.repeat(23), 'b'), 20, 20, 3)).toEqual([23, 23]);

    expect(toleranceLimits(lines('a'.repeat(19), 'b'), 20, 20, 3)).toEqual([23, 22]);
    expect(toleranceLimits(lines('a'.repeat(18), 'b'), 20, 20, 3)).toEqual([23, 21]);
    expect(toleranceLimits(lines('a'.repeat(17), 'b'), 20, 20, 3)).toEqual([23, 20]);
    expect(toleranceLimits(lines('a'.repeat(5), 'b'), 20, 20, 3)).toEqual([23, 20]);
  });

  it('measures the last line against the longest line before it, not against the line right before it', () => {
    expect(toleranceLimits(lines('a'.repeat(19), 'b'.repeat(12), 'c'), 20, 20, 3)).toEqual([23, 23, 22]);
    expect(toleranceLimits(lines('a'.repeat(12), 'b'.repeat(19), 'c'), 20, 20, 3)).toEqual([23, 23, 22]);
  });

  it('counts the columns that the first line starts after the others', () => {
    // the first line holds 15 columns and starts 4 columns later, so it ends at column 19 of the others
    expect(toleranceLimits(lines('a'.repeat(15), 'b'), 16, 20, 3)).toEqual([19, 22]);
  });

  it('gives every line its limit without a tolerance', () => {
    expect(toleranceLimits(lines('aaaa', 'bbbb', 'cccc'), 16, 20, 0)).toEqual([16, 20, 20]);
  });
});

describe('layoutTokens', () => {
  const settings: LayoutOptions = { tolerance: 3, avoidSentenceOrphans: true };

  function layout(text: string, limit: number, overrides: Partial<LayoutOptions> = {}): string[] {
    return layoutTokens(tokenize(text), limit, limit, { ...settings, ...overrides }).map((line) => line.join(' '));
  }

  describe('the tolerance as room to even the right edge', () => {
    const edge: LayoutOptions = { tolerance: 5, avoidSentenceOrphans: true };

    function lengths(text: string, limit: number, overrides: Partial<LayoutOptions> = {}): number[] {
      return layoutTokens(bindLineStarts(tokenize(text)), limit, limit, { ...edge, ...overrides }).map((line) => {
        return line.join(' ').length;
      });
    }

    it('takes the layout for a wider limit whose lines end closer together', () => {
      const text =
        'Hydrates the regular file behind a description the syscall already resolved. The entries resolve the fd once and hand the same description to hydration and to the transfer, because hydration can park and a concurrent close and reopen may rebind the fd number meanwhile. Linux keeps an in-flight operation on the open file it started with, so the transfer must never re-resolve the fd after this returns. A `position` marks a positional read, which the description refuses with `ESPIPE` on an object that has no position, in the lock this step takes anyway.';

      // the layout for a limit of 99, which saves a line, and whose lines but the last end within 3 columns
      expect(lengths(text, 95)).toEqual([96, 97, 99, 99, 96, 64]);
      expect(lengths(text, 99, { tolerance: 0 })).toEqual([96, 97, 99, 99, 96, 64]);
      expect(lengths(text, 95, { tolerance: 0 })).toEqual([88, 91, 88, 89, 87, 89, 18]);
    });

    it('keeps the layout for the limit when no wider one ends its lines closer together', () => {
      const text =
        "Holds the longest reference video the model accepts in seconds, for models that cap the reference video's length or bill it on top of the output. The client measures the connected video and sends its length with the request so the server can check it and the charge can include it when the model's price table bills it.";

      // the second line ends with `the`, which the even lines are worth
      expect(lengths(text, 95)).toEqual([83, 85, 84, 64]);
      expect(lengths(text, 95, { tolerance: 0 })).toEqual([83, 85, 84, 64]);
    });

    it('prefers lines that end with a sentence to an edge that is only a little more even', () => {
      const text =
        'Selects how `utimensat` updates one timestamp, mirroring the timespec forms of Linux. `Set` carries wall-clock milliseconds like the existing atime and mtime arguments, `Now` matches `UTIME_NOW`, and `Omit` matches `UTIME_OMIT`.';

      expect(lengths(text, 96)).toEqual([85, 82, 59]);

      // the layout for a limit of 103 ends its lines at the same column, but the first one inside a sentence
      expect(lengths(text, 103, { tolerance: 0 })).toEqual([99, 99, 28]);
      expect(lengths(text, 96, { endWords: 'none' })).toEqual([99, 99, 28]);
    });

    it('never takes the tolerance in a paragraph with a parenthetical, which has room up to the maximum', () => {
      const text =
        "Update a path's timestamps relative to a dirfd like utimensat(2). Each timestamp is either wall-clock milliseconds, 'now', or 'omit', and a null times argument behaves like a NULL times pointer (both timestamps become now). AtFlags.AT_SYMLINK_NOFOLLOW updates the symlink itself like lutimes.";

      const parenthetical = { parentheticalOverflow: 25 };

      expect(lengths(text, 95, parenthetical)).toEqual(lengths(text, 95, { ...parenthetical, tolerance: 0 }));
      expect(Math.max(...lengths(text, 95, parenthetical))).toBeLessThanOrEqual(95);
    });
  });

  describe('the tolerance on the last line', () => {
    // the first line can't take the long word after it, so only the last line can take the words that save a line
    const head = 'aaaaaaaaa bbbbbbbbb';

    it('saves a line when the last line then ends at most the tolerance after the line before it', () => {
      // lines of 19 and 22 columns
      expect(layout(`${head} cccccccccc ddd eee fff`, 20)).toEqual([head, 'cccccccccc ddd eee fff']);

      // lines of 20 and 23 columns
      expect(layout(`a${head} cccccccccc ddd eee ffff`, 20)).toEqual([`a${head}`, 'cccccccccc ddd eee ffff']);
    });

    it('keeps the line when the last line would stick out', () => {
      // one column more on the last line, which would end 4 columns after the first
      expect(layout(`${head} cccccccccc ddd eee ffff`, 20)).toEqual([head, 'cccccccccc', 'ddd eee ffff']);

      // one column less on the first line, which the last line of 22 columns would end 4 columns after
      expect(layout(`${head.slice(1)} cccccccccc ddd eee fff`, 20)).toEqual([
        head.slice(1),
        'cccccccccc',
        'ddd eee fff',
      ]);
    });

    it('lays the paragraph out like without a tolerance when the last line would stick out', () => {
      for (const text of [`${head} cccccccccc ddd eee ffff`, `${head.slice(1)} cccccccccc ddd eee fff`]) {
        expect(layout(text, 20)).toEqual(layout(text, 20, { tolerance: 0 }));
      }
    });

    it('lets a last line within its limit end any number of columns after the line before it', () => {
      // lines of 9 and 20 columns, which take no tolerance
      expect(layout('aaaaaaaaa bbbbbbbbbbbb ccc ddd', 20)).toEqual(['aaaaaaaaa', 'bbbbbbbbbbbb ccc ddd']);
    });

    it('never leaves a last line that sticks out, whatever the words and limits are', () => {
      const { random, between, commentBody } = randomComments(86_028_121);

      let stickingOut = 0;
      let saved = 0;

      for (let run = 0; run < 2000; run += 1) {
        const tokens = tokenize(commentBody().lines.join(' '));
        const restLimit = between(12, 96);
        const firstLimit = restLimit - (random() < 0.3 ? between(1, 6) : 0);

        const overrides: LayoutOptions = {
          tolerance: between(1, 8),
          avoidSentenceOrphans: random() < 0.7,
          keepFirstLine: random() < 0.2,
        };

        const laidOut = layoutTokens(tokens, firstLimit, restLimit, overrides);
        const within = layoutTokens(tokens, firstLimit, restLimit, { ...overrides, tolerance: 0 });
        const limits = toleranceLimits(laidOut, firstLimit, restLimit, overrides.tolerance);
        const last = laidOut.at(-1)?.join(' ').length ?? 0;
        const context = `${JSON.stringify({ firstLimit, restLimit, ...overrides })}\n${tokens.join(' ')}`;

        // a word that is too long for its line sticks out without a tolerance too
        if (last > (limits.at(-1) ?? Infinity)) {
          expect(laidOut, context).toEqual(within);

          stickingOut += 1;
        }

        saved += laidOut.length < within.length ? 1 : 0;
      }

      // the tolerance still saves lines, and words that are too long still end paragraphs
      expect(saved).toBeGreaterThan(100);
      expect(stickingOut).toBeGreaterThan(0);
    });
  });

  describe('lines that stick out far past a line above them', () => {
    const plain: LayoutOptions = { tolerance: 0, avoidSentenceOrphans: true };

    function lengths(text: string, limit: number, overrides: Partial<LayoutOptions> = {}): number[] {
      return layoutTokens(tokenize(text), limit, limit, { ...plain, ...overrides }).map((line) => {
        return line.join(' ').length;
      });
    }

    it('takes another line when the fewest lines climb in small steps', () => {
      const text =
        'Caps a host-supplied timeout at about thirty years in milliseconds. `Duration::from_secs_f64` panics on values that overflow a `Duration`, and a trusted-but-buggy host passing `Infinity` or a huge number must not abort the kernel.';

      // the orphan rule keeps the first line short, and the even lines climb 18 columns in two steps of 9
      expect(lengths(text, 96, { keepSteps: true })).toEqual([67, 76, 85]);

      expect(layoutTokens(tokenize(text), 96, 96, plain).map((line) => line.join(' '))).toEqual([
        'Caps a host-supplied timeout at about thirty years in milliseconds.',
        '`Duration::from_secs_f64` panics on values that overflow a `Duration`,',
        'and a trusted-but-buggy host passing `Infinity` or a huge number must',
        'not abort the kernel.',
      ]);
    });

    it('keeps the fewest lines when another line brings the lines too little closer together', () => {
      const text =
        'Reads the names the loader keeps in [the table of every section in a file][sections] whenever something asks for the name of one section.';

      // lines of 35, 48, 36, and 15 columns would end 13 columns apart instead of 17, which is no straight edge
      expect(lengths(text, 56)).toEqual([35, 48, 52]);
    });

    it('keeps the fewest lines when two more lines are worth less than two lines', () => {
      const text =
        "Implements the socket-only `recv(2)`/`send(2)` syscall family and its msghdr-shaped `recvmsg(2)`/`sendmsg(2)` siblings. These resolve the fd straight to its socket endpoint (failing `ENOTSOCK` on anything else) and carry the message flags the generic `read`/`write` path has no room for. With zero flags `recv` and `send` behave like `read` and `write` on the same socket apart from two Linux-mandated differences. Errors report the calling syscall's name, and a zero-length `recv` on a datagram socket pops and discards the front datagram the way `recvfrom` does, while a zero-length `read` consumes nothing. The msghdr pair adds scatter/gather segments, an optional destination address, `msg_flags` reporting, and the `SCM_RIGHTS` control plane on top of the same bodies. All four work on stream and datagram sockets through the shared endpoint dispatch.";

      /**
       * The lines end 16 columns apart. One more line leaves them 10 columns apart, and two more
       * lines 7 columns, which is 9 columns closer together, not the 16 that they cost.
       */
      expect(lengths(text, 96, { parentheticalOverflow: 20 })).toEqual([83, 88, 97, 93, 95, 97, 99, 97, 99]);
    });

    it('takes the fewest more lines without a step when no more lines are worth it', () => {
      const text =
        'Returns more than the short form, like the [values of an argument][crate::Matches::get_many], their [order among the other arguments][crate::Matches::indices_of], and [what set each of them][crate::Matches::value_source]. The short form only returns the values and none of the rest.';

      // the third line sticks out 21 columns past the second
      expect(lengths(text, 94, { keepSteps: true })).toEqual([93, 72, 93, 21]);

      // the links leave no straight edge, so the lines still climb 20 columns, but in steps of 14 at most
      expect(lengths(text, 94)).toEqual([42, 56, 62, 58, 60]);
    });
  });
});

describe('hasWidow', () => {
  it('counts the words inside a parenthetical instead of counting the group as one word', () => {
    expect(hasWidow([['First', 'line'], ['(one two three)']])).toBe(false);
    expect(hasWidow([['First', 'line'], ['(one two)']])).toBe(true);
  });
});

describe('startsBlock', () => {
  it('detects words that Markdown or JSDoc read as the start of a block', () => {
    for (const token of ['-', '*', '+', '>', '1.', '12)', '#', '###', '@types/node', '@param', '```ts', '|', '<div>']) {
      expect(startsBlock(token)).toBe(true);
    }
  });

  it('ignores ordinary words, numbers, and code spans', () => {
    for (const token of ['-1', 'a-b', '2.5', '1.0.0', '#123', 'foo@bar', '`@x`', '{@link Foo}', '<', '->', '=>']) {
      expect(startsBlock(token)).toBe(false);
    }
  });
});

describe('isAbbreviation', () => {
  it('recognizes known abbreviations and initialisms, also in brackets', () => {
    for (const word of ['e.g.', 'i.e.', 'etc.', 'vs.', '(e.g.', 'etc.)', 'a.k.a.', '(a.k.a.', 'U.S.', 'Fig.', 'Dr.']) {
      expect(isAbbreviation(word)).toBe(true);
    }
  });

  it('does not treat words that end a sentence as abbreviations', () => {
    for (const word of ['done.', 'Node.js.', 'v2.', 'a.', '`e.g.`', 'no.', 'max.']) {
      expect(isAbbreviation(word)).toBe(false);
    }
  });
});

describe('findLineIssues with initialisms', () => {
  it('does not report a word after an initialism as the start of a new sentence', () => {
    expect(findLineIssues(lines('the shell, also known a.k.a. the', 'wrapper'), 35, 35, options)).toEqual([]);
  });

  it('does not report a number after an abbreviation like `Fig.` as an orphan', () => {
    expect(findLineIssues(lines('the layout is shown in Fig. 3', 'for the full picture'), 30, 30, options)).toEqual([]);

    expect(findLineIssues(lines('the layout is shown below. It', 'has the full picture'), 30, 30, options)).toEqual([
      { type: 'orphan', line: 0 },
    ]);
  });
});
