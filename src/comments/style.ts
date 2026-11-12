export type StyleIssueType = 'semicolon' | 'em-dash' | 'dash' | 'label-colon' | 'emphasis' | 'banner';

export interface StyleLine {
  /**
   * This is the 0-based line in the file.
   */
  readonly index: number;
  readonly text: string;
}

export interface StyleIssue {
  readonly type: StyleIssueType;
  readonly index: number;
}

/**
 * Matches four or more repeated characters at the start or end of a line, since three like `===`,
 * `---`, or `~~~` are operators, rules, and fences in prose. A run in the middle of a line is a
 * table rule like `| ---- |` or an arrow like `---->`, and a Markdown heading like `#### Examples`
 * isn't a banner either.
 */
const BANNER = /^(?!#{1,6}\s)([-=*#_~+/\\])\1{3,}|([-=*#_~])\2{3,}\s*$/;

/**
 * Runs of the same character separated only by spaces, like `--------  -----`, underline the
 * columns of a table.
 */
const COLUMN_RULE = /^([-=_~])\1*(?:\s+\1+)+$/;

/**
 * Matches an en-dash, a spaced hyphen, or a double hyphen between words, which may stand in for an
 * em-dash. An en-dash or hyphen between numbers, like `10 – 20`, is a range, and a double hyphen
 * next to a CLI flag, like `--watch -- file` or `npm test -- --watch`, separates arguments.
 */
const DASH = /(?<!\d)\s[–-]\s(?!\d)|(?<!(?:^|\s)-[\w-]*)\s--\s(?!-)/;
const SEMICOLON = /;(?:\s|$)/;

/**
 * Matches `*emphasis*` or `**bold**`, which starts with a letter or digit and whose
 * closing asterisks end the word, so that globs like `*foo*.ts` or `*.test.*` aren't
 * emphasis. Asterisks in quotes, like `'*foo*'`, are a string or glob.
 */
const EMPHASIS = /(?:^|[\s(])(\*\*?)(?=[\p{L}\p{N}])[^*]+?(?<!\s)\1(?=$|[\s)"']|[.,;:!?](?:$|[\s)"']))/u;

export const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+/;

/**
 * A code span, as in Markdown, closes with a run of as many backticks as it opened with,
 * like ``` `` `a` `` ```, and may continue on the next line.
 */
export const CODE_SPAN = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;

/**
 * Matches a colon after a word with more text after it on the same line, like `Optional: skips it`
 * or `...through its presets: the rules that...`. A colon that ends a line introduces what's below
 * it. Markers like `TODO:` or `WARNING:` that start a sentence are conventions read by tooling, and
 * a colon after a code span or `{@link}` (replaced by `code` in prose) introduces a definition, like
 * `` `width`: the maximum width ``, so neither counts. Neither does an identifier in camel or snake
 * case, like `maxRetries: 3`, which is a property.
 */
const COLON =
  /(?<=[\w)\]'"’])(?<!(?:^|[.!?]\s+)(?:[A-Z]{2,}|[Tt]odo|[Ff]ixme|[Hh]ack|[Xx]xx))(?<!\b(?:code|url|entity|[A-Za-z][a-z\d]*[A-Z]\w*|\w*_\w*)):\s+\S/;

export function replaceKeepingLines(text: string, pattern: RegExp, replacement: string): string {
  return text.replaceAll(pattern, (match) => `${replacement}${'\n'.repeat(match.split('\n').length - 1)}`);
}

export function stripNonProse(text: string): string {
  let stripped = replaceKeepingLines(text, CODE_SPAN, 'code');

  for (let previous = ''; previous !== stripped; ) {
    previous = stripped;
    stripped = replaceKeepingLines(stripped, /\{[^{}]*\}/g, 'code');
  }

  return stripped
    .replaceAll(/\b[a-z][\w+.-]*:\/\/\S+/gi, 'url')
    .replaceAll(/&(?:[a-z][a-z\d]*|#\d+|#x[\da-f]+);/gi, 'entity');
}

function hasExplanatoryColon(text: string): boolean {
  return COLON.test(text.replace(LIST_MARKER, ''));
}

export function isBanner(text: string): boolean {
  const prose = stripNonProse(text.trim());

  return BANNER.test(prose) && !COLUMN_RULE.test(prose);
}

export function findStyleIssues(lines: readonly StyleLine[]): StyleIssue[] {
  const issues: StyleIssue[] = [];
  const prose = stripNonProse(lines.map((line) => line.text.trim()).join('\n'));

  /**
   * A JSDoc tag's description starts a sentence after its `@param name -` style head.
   * The head, including its type, may wrap across lines.
   */
  const proseLines = replaceKeepingLines(prose, /^@\w+\s+(?:code\s+)?(?:\S+\s+-\s+)?/gm, '').split('\n');

  for (const [position, line] of lines.entries()) {
    const text = proseLines[position].trim();

    const report = (type: StyleIssueType): void => {
      issues.push({ type, index: line.index });
    };

    if (isBanner(line.text)) {
      report('banner');
    } else {
      if (SEMICOLON.test(text)) {
        report('semicolon');
      }

      if (text.includes('—')) {
        report('em-dash');
      }

      if (DASH.test(text)) {
        report('dash');
      }

      if (hasExplanatoryColon(text)) {
        report('label-colon');
      }

      if (EMPHASIS.test(text)) {
        report('emphasis');
      }
    }
  }

  return issues;
}
