import {
  breakAfterSentence,
  findLineIssues,
  hasWidow,
  isAbbreviation,
  startsBlock,
  tokenize,
  wrapTokens,
  type WrapOptions,
} from '../wrap.js';

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

  it('moves the first word of a new clause to the next line', () => {
    expect(wrap('the add button, these selected items', 20)).toEqual(['the add button,', 'these selected items']);
    expect(wrap('the add button; and the selected items', 22)).toEqual(['the add button;', 'and the selected items']);
    expect(wrap('red, green, and blue', 11)).toEqual(['red, green,', 'and blue']);
    expect(wrap('see e.g. the docs', 12)).toEqual(['see e.g. the', 'docs']);
  });

  it('moves a sentence start and a parenthetical down together', () => {
    expect(wrap('It ends. This (the aside) goes on', 16)).toEqual(['It ends.', 'This (the aside)', 'goes on']);
  });

  it('does not treat abbreviations as sentence ends', () => {
    expect(wrap('Use a helper, e.g. Foo works fine', 18)).toEqual(['Use a helper, e.g.', 'Foo works fine']);
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
