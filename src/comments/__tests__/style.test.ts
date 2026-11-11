import { stripIndent } from 'common-tags';
import { analyzeSource, isSuspicious, type AnalyzeOptions } from '../analyze.js';
import { findStyleIssues, isBanner } from '../style.js';

function issuesOf(...texts: string[]): string[] {
  const lines = texts.map((text, index) => {
    return { index, text };
  });

  return findStyleIssues(lines).map((issue) => `${issue.index}:${issue.type}`);
}

describe('findStyleIssues', () => {
  it('flags semicolons, em-dashes, dashes, label colons, and asterisk emphasis', () => {
    expect(issuesOf('Opens the socket; closes it later.')).toEqual(['0:semicolon']);
    expect(issuesOf('Opens the socket — then closes it.')).toEqual(['0:em-dash']);
    expect(issuesOf('Opens the socket -- then closes it.')).toEqual(['0:dash']);
    expect(issuesOf('Optional: without it the default applies.')).toEqual(['0:label-colon']);
    expect(issuesOf('Closes the socket. Default: refuse.')).toEqual(['0:label-colon']);
    expect(issuesOf('This is *really* important.')).toEqual(['0:emphasis']);
  });

  it('flags a colon with more of the sentence after it, but not one that ends a line', () => {
    expect(issuesOf('It supports two modes', 'default: refuse')).toEqual(['1:label-colon']);
    expect(issuesOf('It supports two modes.', 'Default: refuse')).toEqual(['1:label-colon']);
    expect(issuesOf('Reaches ESLint through its presets: the rules that need no types.')).toEqual(['0:label-colon']);
    expect(issuesOf('Accepts these values:')).toEqual([]);
    expect(issuesOf('@param {boolean} force - Optional: skips the flush.')).toEqual(['0:label-colon']);
    expect(issuesOf('@returns Default: the socket.')).toEqual(['0:label-colon']);
    expect(issuesOf('Waits until 10:30 before retrying.')).toEqual([]);
  });

  it('ignores code spans, JSDoc types, URLs, and conventional tags', () => {
    expect(issuesOf('Matches `a; b` and `x — y` and `Default: refuse` and `*glob*`.')).toEqual([]);
    expect(issuesOf('@param {{ a: string; b: number }} options - The options.')).toEqual([]);
    expect(issuesOf('See https://example.com/a;b for details.')).toEqual([]);
    expect(issuesOf('TODO: remove after the migration.')).toEqual([]);
  });

  it('ignores HTML entities, which end with a semicolon', () => {
    expect(issuesOf('Separates words with &nbsp; and &#160; or &#xA0; here.')).toEqual([]);
    expect(issuesOf('Uses &nbsp; here; and a real semicolon.')).toEqual(['0:semicolon']);
  });

  it('ignores all-caps markers and nested JSDoc types', () => {
    expect(issuesOf('NOTE: keep in sync.', 'WARNING: slow.', 'todo: remove.')).toEqual([]);
    expect(issuesOf('Done. TODO: remove.')).toEqual([]);
    expect(issuesOf('@param {{ a: { b: string }; c: number }} options - The options.')).toEqual([]);
  });

  it('flags a colon after any phrase, since only the agent can tell an explanation from a definition', () => {
    expect(issuesOf('Side effect: the socket closes.')).toEqual(['0:label-colon']);
    expect(issuesOf('Supports three formats: ESM, CJS, and IIFE.')).toEqual(['0:label-colon']);
    expect(issuesOf('It ends here. Returns one of: a, b, or c.')).toEqual(['0:label-colon']);

    expect(issuesOf('1. Build: compiles the sources.', 'Uses a map, e.g. key: value pairs.')).toEqual([
      '0:label-colon',
      '1:label-colon',
    ]);
  });

  it('ignores tooling markers regardless of their case', () => {
    expect(issuesOf('Todo: remove later.', 'Fixme: broken.', 'Hack: works around a bug.')).toEqual([]);
  });

  it('does not treat a colon after a code span, link, or URL as a label', () => {
    expect(issuesOf('`width`: the maximum line length.')).toEqual([]);
    expect(issuesOf('See {@link Foo}: it does the work.')).toEqual([]);
    expect(issuesOf('Closes it. See `close`: it flushes first.')).toEqual([]);
    expect(issuesOf('Barcode: scanned on arrival.')).toEqual(['0:label-colon']);
  });

  it('flags bold like emphasis', () => {
    expect(issuesOf('This is **really** important.', 'It is **fast**, and small.')).toEqual([
      '0:emphasis',
      '1:emphasis',
    ]);

    expect(issuesOf('Matches **/*.ts and **/*.js files.', 'Matches src/**/*.ts here.')).toEqual([]);
    expect(issuesOf('Mixed **markers* stay unflagged.')).toEqual([]);
  });

  it('does not mistake globs, math, or list markers for emphasis', () => {
    expect(issuesOf('Matches src/**/*.ts files.', 'Computes a * b * c.', '* a list item')).toEqual([]);
    expect(issuesOf('Matches files like *foo*.ts or *bar*.js here.')).toEqual([]);
  });

  it('does not treat a camel or snake case identifier before a colon as a label', () => {
    expect(issuesOf('turbopackIgnore: true', 'Sets maxRetries: 3 here.', 'Done. retry_count: 3 here.')).toEqual([]);
    expect(issuesOf('Optional flag: skips the flush.')).toEqual(['0:label-colon']);
  });

  it('strips code spans delimited by several backticks', () => {
    expect(issuesOf('Matches `` `a; b` `` and `` `Default: refuse` `` here.')).toEqual([]);
  });

  it('strips code spans and types that continue on the next line', () => {
    expect(issuesOf('Joins them like `a;', 'b` in the output.')).toEqual([]);
    expect(issuesOf('@param {{ a: string;', 'b: number }} options - The options.')).toEqual([]);
    expect(issuesOf('Joins them like `a;', 'b`; and more.')).toEqual(['1:semicolon']);
  });

  it('flags emphasis that ends a sentence or clause', () => {
    expect(issuesOf('This is *important*.', 'It is *fast*, and small.', 'Keep it *simple*')).toEqual([
      '0:emphasis',
      '1:emphasis',
      '2:emphasis',
    ]);
  });
});

describe('findStyleIssues false positives', () => {
  it('does not mistake globs that start with punctuation or sit in quotes for emphasis', () => {
    expect(issuesOf('Ignores *.test.* and *.spec.* files.', "Matches '*foo*' globs.", 'Uses "**" here.')).toEqual([]);

    expect(issuesOf('This is *really* important.', 'It is (*fast*) and **2x** faster.')).toEqual([
      '0:emphasis',
      '1:emphasis',
    ]);
  });

  it('reports only the em-dash character as an em-dash, and other dashes between words as a dash', () => {
    expect(issuesOf('Opens the socket—then closes it.', 'Opens the socket — then closes it.')).toEqual([
      '0:em-dash',
      '1:em-dash',
    ]);

    expect(issuesOf('Opens the socket – then closes it.', 'Opens the socket -- then closes it.')).toEqual([
      '0:dash',
      '1:dash',
    ]);

    expect(issuesOf('Opens the socket — then closes it -- later.')).toEqual(['0:em-dash', '0:dash']);
    expect(issuesOf('Uses a `—` and a `--` in code.', 'Uses a well-known pre-built option.')).toEqual([]);
  });

  it('does not treat a double hyphen next to a CLI flag as a dash', () => {
    expect(issuesOf('Run it with --watch -- file.ts to keep going.', 'Runs npm test -- --watch here.')).toEqual([]);
    expect(issuesOf('Opens the socket -- then closes it.', 'Uses a-b -- then c-d.')).toEqual(['0:dash', '1:dash']);
  });

  it('reports a spaced hyphen between words as a dash, but not a hyphenated word or a list marker', () => {
    expect(issuesOf('Windows - where Node differs - refuses first.')).toEqual(['0:dash']);
    expect(issuesOf('- Opens a well-known socket.', 'Uses `a - b` in code.')).toEqual([]);
  });

  it('does not treat an en-dash or hyphen between numbers as a dash', () => {
    expect(issuesOf('Pages 10 – 20 are blank.', 'Pages 10 - 20 are blank.')).toEqual([]);
    expect(issuesOf('Opens the socket – then closes it.')).toEqual(['0:dash']);
  });

  it('strips any JSDoc name before a dash, so the description starts a sentence', () => {
    expect(issuesOf("@param {string} [mode='fast'] - Optional: picks the mode.")).toEqual(['0:label-colon']);
    expect(issuesOf('@param {string} props.on-change - Optional: picks the mode.')).toEqual(['0:label-colon']);
  });
});

describe('isBanner', () => {
  it('detects dividers and headings made of repeated characters', () => {
    for (const text of ['----------', '========== Handlers ==========', 'Handlers ----------', '#####', '//////////']) {
      expect(isBanner(text)).toBe(true);
    }

    for (const text of [
      'Handlers for control mode',
      'a -- b',
      'x == y',
      'Compares with === so null stays distinct',
      '=== is strict equality',
      'Use ~~~ fences',
      '...',
      'e.g. `// ----- Handlers -----`.',
      '| ---- | ----- |',
      'client ----> server',
      'Fill in ____ later.',
      '#### Examples',
      '--------  -----',
      '====  ======  ===',
    ]) {
      expect(isBanner(text)).toBe(false);
    }
  });
});

describe('analyzeSource style issues', () => {
  const options: AnalyzeOptions = { width: 80, tabWidth: 2, tolerance: 0, avoidSentenceOrphans: true, style: true };

  function types(source: string, overrides: Partial<AnalyzeOptions> = {}): string[] {
    return analyzeSource(source, 'file.ts', { ...options, ...overrides }).flatMap((comment) =>
      comment.paragraphs.flatMap((paragraph) => paragraph.issues.map((issue) => `${issue.line}:${issue.type}`)),
    );
  }

  it('makes otherwise well-formatted comments suspicious', () => {
    const source = '/**\n * Retries the request; gives up after three tries.\n */\n';
    const [comment] = analyzeSource(source, 'file.ts', options);

    expect(isSuspicious(comment)).toBe(true);
    expect(types(source)).toEqual(['2:semicolon']);
  });

  it('flags banner comments in every form', () => {
    const source = stripIndent`
      /* ========== Section ========== */
      const c = 3;

      /******************************/
      const d = 4;

      /*
       * ==========
       * Section
       * ==========
       */
      const e = 5;
    `;

    expect(types(source)).toEqual(['1:banner', '4:banner', '8:banner', '10:banner']);
  });

  it('flags the borders of a box drawing or table as possible banners, which the agent may keep', () => {
    const source = stripIndent`
      /*
       * ==============
       * Name    Value
       * ==============
       */
      const b = 2;
    `;

    expect(types(source)).toEqual(['2:banner', '4:banner']);
  });

  it('flags dividers around a plain title or prose', () => {
    const source = stripIndent`
      /**
       * ---------- Handlers ----------
       * Handles requests from the server.
       */
      const a = 1;

      /* ========== */
      const b = 2;
    `;

    expect(types(source)).toEqual(['2:banner', '7:banner']);
  });

  it('does not flag the column rule of a table', () => {
    const source = stripIndent`
      /**
       * Name      Value
       * --------  -----
       * width     80
       */
    `;

    expect(types(source)).toEqual([]);
  });

  it('checks single-line block comments and JSDoc tag descriptions', () => {
    expect(types('/** Optional: without it the default applies. */\nconst a = 1;\n')).toEqual(['1:label-colon']);
    expect(types('/**\n * @returns the socket — or null.\n */\n')).toEqual(['2:em-dash']);
  });

  it('never checks code blocks or @example', () => {
    const source = stripIndent`
      /**
       * \`\`\`ts
       * const a = 1; // ---- not a banner
       * \`\`\`
       *
       * @example run(); stop();
       */
    `;

    expect(types(source)).toEqual([]);
  });

  it('can be turned off', () => {
    expect(types('/**\n * Retries the request; gives up.\n */\n', { style: false })).toEqual([]);
  });
});
