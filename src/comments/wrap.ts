export interface WrapOptions {
  /**
   * Sets whether a line may not end with the first word of a sentence or parenthetical, like
   * `This` or `(the`, or with the first word after a semicolon or colon. Such a word moves to
   * the next line instead. The word after a comma may end a line. It also sets whether a line
   * avoids ending with the first two words of a sentence, with the first word after a comma,
   * or with an article, and whether the first of two lines ends with a sentence instead of the
   * start of the next one, as long as the second line is then no longer than the first.
   */
  readonly avoidSentenceOrphans: boolean;

  /**
   * Sets how many columns a line may exceed its limit before it counts as overflowing. A layout
   * also uses those columns to save a line or to make its right edge more even, unless the last
   * line then sticks out past the lines before it.
   */
  readonly tolerance: number;

  /**
   * Sets how many extra columns a complete parenthetical may use beyond the preferred line limit.
   */
  readonly parentheticalOverflow?: number;
}

export type LineIssueType =
  | 'overflow'
  | 'underfill'
  | 'orphan'
  | 'widow'
  | 'unbalanced'
  | 'wide'
  | 'split-parenthetical';

export interface LineIssue {
  readonly type: LineIssueType;

  /**
   * Holds the index of the offending line within the paragraph.
   */
  readonly line: number;
}

// punctuation inside a code span, like `,` or `?.`, is code and doesn't end a clause or sentence
const CLAUSE_END = /[.!?,;:]["')\]*_]*$/;
const SENTENCE_END = /[.!?]["')\]*_]*$/;

/**
 * Matches a word that ends a sentence, or that ends with a semicolon or colon. The word after it
 * starts something new, so it stays off the end of a line. A comma is left out, because the sentence
 * goes on after one. A line may end with the word after a comma, like `and` in `...the paths, and`,
 * since keeping every such word off the end would make the lines less even. Such a word only costs a
 * little (see `CLAUSE_START_COST`).
 */
const STATEMENT_END = /[.!?;:]["')\]*_]*$/;

/**
 * Holds only abbreviations that never end a sentence, unlike `no.` or `max.`, which can also be the
 * last word of one.
 */
const ABBREVIATIONS = new Set([
  'e.g.',
  'i.e.',
  'etc.',
  'vs.',
  'cf.',
  'approx.',
  'incl.',
  'resp.',
  'al.',
  'viz.',
  'esp.',
  'ca.',
  'fig.',
  'figs.',
  'eq.',
  'vol.',
  'pp.',
  'mr.',
  'mrs.',
  'ms.',
  'dr.',
  'prof.',
  'st.',
]);

export function isAbbreviation(word: string): boolean {
  const bare = word
    .replace(/^[(["']+/, '')
    .replace(/[)\]"']+$/, '')
    .toLowerCase();

  return ABBREVIATIONS.has(bare) || /^(?:[a-z]\.){2,}$/.test(bare);
}

function findClosingBrace(text: string, start: number): number {
  let depth = 0;

  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '{') {
      depth += 1;
    } else if (text[index] === '}') {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function backtickRun(text: string, start: number): number {
  let end = start;

  while (text[end] === '`') {
    end += 1;
  }

  return end - start;
}

/**
 * As in Markdown, a code span opened by a run of backticks only closes with a run of the same
 * length, like the two in ``` `` `a` `` ```.
 */
function findCodeSpanEnd(text: string, start: number): number {
  const run = backtickRun(text, start);

  for (let index = text.indexOf('`', start + run); index !== -1; ) {
    const length = backtickRun(text, index);

    if (length === run) {
      return index + length - 1;
    }

    index = text.indexOf('`', index + length);
  }

  return -1;
}

/**
 * Returns whether a backslash escapes the character at `index`, as in Markdown. A backslash that
 * another one escapes, like the second of `\\[`, escapes nothing.
 */
function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;

  while (text[index - 1 - backslashes] === '\\') {
    backslashes += 1;
  }

  return backslashes % 2 === 1;
}

function findUnescaped(text: string, char: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1;
    } else if (text[index] === char) {
      return index;
    }
  }

  return -1;
}

/**
 * Returns the index of the `]` that closes the `[` at `start`, or -1 when it never closes.
 * Brackets pair up as in Markdown, where a bracket after a backslash or in a code span is no
 * bracket. A brace is no syntax in Markdown, so a `{` after the `[` never hides the `]`.
 */
function findClosingBracket(text: string, start: number): number {
  let depth = 0;

  for (let index = start; index < text.length; index += 1) {
    switch (text[index]) {
      case '\\': {
        index += 1;

        break;
      }
      case '`': {
        const close = findCodeSpanEnd(text, index);

        // a run of backticks that never closes is literal text
        index = close === -1 ? index + backtickRun(text, index) - 1 : close;

        break;
      }
      case '[': {
        depth += 1;

        break;
      }
      case ']': {
        depth -= 1;

        if (depth === 0) {
          return index;
        }

        break;
      }
    }
  }

  return -1;
}

/**
 * Returns the index of the `)` that closes the `(` at `start`, which opens the destination of a
 * Markdown link, or -1 when it never closes. Parentheses pair up. A destination in angle brackets,
 * like `(<a b>)`, and a title in quotes after the destination, like `(target "title")`, can hold a
 * parenthesis that pairs up with nothing.
 */
function findDestinationEnd(text: string, start: number): number {
  let depth = 0;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    let close = -1;

    if (char === '\\') {
      index += 1;
    } else if (char === '<' && text.slice(start + 1, index).trim() === '') {
      close = findUnescaped(text, '>', index + 1);
    } else if ((char === '"' || char === "'") && /\s/.test(text[index - 1])) {
      close = findUnescaped(text, char, index + 1);
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')' && --depth === 0) {
      return index;
    }

    index = close === -1 ? index : close;
  }

  return -1;
}

/**
 * Returns the index of the last character of the Markdown link that starts with the `[` at
 * `start`, or -1 when the bracket never closes. A link is the text in brackets, like `[text]`,
 * with the destination right after it, like `[text](target "title")`. The label of a reference
 * link, like the second pair of brackets in `[text][label]`, is a link that starts right after
 * the first one, so it needs no check of its own.
 *
 * Only the syntax counts. Whether the text in brackets resolves to anything, like an intra-doc link
 * in Rust or a link reference definition, is something only the renderer knows.
 */
function findLinkEnd(text: string, start: number): number {
  const close = findClosingBracket(text, start);

  if (close === -1 || text[close + 1] !== '(') {
    return close;
  }

  const end = findDestinationEnd(text, close + 1);

  return end === -1 ? close : end;
}

/**
 * Splits text into words. JSDoc writes types and `{@link ...}` tags as `{...}` groups, so they stay
 * intact like code spans.
 *
 * A Markdown link stays intact too, since a link that continues on the next line can't be followed
 * in an editor. rust-analyzer, for one, only resolves an intra-doc link that sits on one line of
 * a `///` comment. A link is one word, like a code span, but its own words keep one space between
 * them, like the words around it.
 */
export function tokenize(text: string): string[] {
  return splitWords(text, true);
}

function splitWords(text: string, keepLinks: boolean): string[] {
  const tokens: string[] = [];

  let current = '';
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    const linkEnd = keepLinks && char === '[' && !isEscaped(text, index) ? findLinkEnd(text, index) : -1;

    if (linkEnd !== -1) {
      current += splitWords(text.slice(index, linkEnd + 1), false).join(' ');
      index = linkEnd + 1;

      continue;
    }

    const close = char === '`' ? findCodeSpanEnd(text, index) : char === '{' ? findClosingBrace(text, index) : -1;

    // a run of backticks that never closes is literal text, and none of its backticks open a span
    if (char === '`' && close === -1) {
      const run = backtickRun(text, index);

      current += text.slice(index, index + run);
      index += run;

      continue;
    }

    if (close !== -1) {
      current += text.slice(index, close + 1);
      index = close + 1;

      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);

        current = '';
      }

      index += 1;

      continue;
    }

    current += char;
    index += 1;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function parentheticalEnd(text: string): number {
  let depth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '\\') {
      index += 1;

      continue;
    }

    const close = char === '`' ? findCodeSpanEnd(text, index) : char === '{' ? findClosingBrace(text, index) : -1;

    if (close !== -1) {
      index = close;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')' && --depth === 0) {
      return index;
    }
  }

  return -1;
}

function isParenthetical(token: string): boolean {
  return token.startsWith('(') && parentheticalEnd(token) !== -1;
}

export interface ParentheticalGroup {
  readonly start: number;
  readonly end: number;
}

function parentheticalGroups(tokens: readonly string[], limit: number): ParentheticalGroup[] {
  const groups: ParentheticalGroup[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].startsWith('(')) {
      const end = parentheticalEnd(tokens.slice(index).join(' '));

      let last = index;
      let length = tokens[index].length;

      while (length <= end && last + 1 < tokens.length) {
        length += 1 + tokens[++last].length;
      }

      if (end !== -1 && length <= limit) {
        groups.push({ start: index, end: last + 1 });

        index = last;

        continue;
      }
    }
  }

  return groups;
}

/**
 * Returns the parenthetical that a line break before the token at `at` splits, of those that fit
 * in `limit` columns.
 */
export function parentheticalAround(
  tokens: readonly string[],
  at: number,
  limit: number,
): ParentheticalGroup | undefined {
  return parentheticalGroups(tokens, limit).find((group) => group.start < at && at < group.end);
}

export function bindParentheticals(tokens: readonly string[], limit: number): string[] {
  const groups = new Map(parentheticalGroups(tokens, limit).map((group) => [group.start, group.end]));
  const units: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const end = groups.get(index) ?? index + 1;

    units.push(tokens.slice(index, end).join(' '));

    index = end - 1;
  }

  return units;
}

function endsStatement(token: string): boolean {
  return STATEMENT_END.test(token) && !isAbbreviation(token);
}

function endsSentence(token: string): boolean {
  return SENTENCE_END.test(token) && !isAbbreviation(token);
}

function opensAside(token: string): boolean {
  return /^[([]/.test(token) && !/[)\]]["'`.,;:!?]*$/.test(token);
}

/**
 * Returns whether a line shouldn't end with the token, because it is the first word of a
 * sentence, of the part after a semicolon or colon, or of a parenthetical. A word that ends
 * a clause itself, like `Done.` or `However,`, may end a line, and so may the word after a
 * comma (see `STATEMENT_END`).
 */
function isOrphan(previous: string, token: string): boolean {
  return opensAside(token) || (endsStatement(previous) && !CLAUSE_END.test(token));
}

/**
 * Returns whether Markdown or JSDoc reads a word as the start of a block when it begins a line, like a
 * list marker (`-`, `1.`), a heading (`#`), a quote (any word that starts with `>`, like `>=`), a fence,
 * a table row, an HTML tag, comment, or declaration (`<div>`, `<!--`, `<?`), or a JSDoc tag like `@param`.
 * A run of `-`, `=`, `*`, or `_` on a line of its own is a heading underline or a rule, so it never starts
 * a line either. Wrapping must never move such a word to the start of a line, or the paragraph would turn
 * into something else.
 */
export function startsBlock(token: string): boolean {
  return (
    /^(?:\+|-+|=+|\*+|_{3,}|\d+[.)]|#{1,6})$/.test(token) ||
    /^(?:>|@[A-Za-z]|`{3}|~{3}|\||<(?:\/?[A-Za-z]|[!?]))/.test(token)
  );
}

export function bindLineStarts(
  tokens: readonly string[],
  startsLine: (token: string, next: string | undefined) => boolean = startsBlock,
): string[] {
  const units: string[] = [];

  for (const [index, token] of tokens.entries()) {
    if (units.length > 0 && startsLine(token, tokens[index + 1])) {
      units[units.length - 1] += ` ${token}`;
    } else {
      units.push(token);
    }
  }

  return units;
}

function breaksBefore(previous: string, last: string, next: string, options: WrapOptions): boolean {
  return (options.avoidSentenceOrphans && isOrphan(previous, last)) || startsBlock(next);
}

function lineLength(tokens: readonly string[]): number {
  let length = 0;

  for (const token of tokens) {
    length += token.length;
  }

  return length + Math.max(0, tokens.length - 1);
}

/**
 * The first line can have a different limit than the rest, e.g. when a list marker takes up space
 * only on the first line.
 */
export function wrapTokens(
  tokens: readonly string[],
  firstLimit: number,
  restLimit: number,
  options: WrapOptions,
): string[][] {
  return wrapFrom(tokens, 0, firstLimit, restLimit, options, Infinity);
}

/**
 * Wraps the tokens from the one at `from` on, and stops after `maxLines` lines. A line
 * never depends on the lines after it, so the first lines of a wrap are the same with or
 * without the rest.
 */
function wrapFrom(
  tokens: readonly string[],
  from: number,
  firstLimit: number,
  restLimit: number,
  options: WrapOptions,
  maxLines: number,
): string[][] {
  const lines: string[][] = [];

  let line: string[] = [];
  let length = 0;

  for (let index = from; index < tokens.length; index += 1) {
    const token = tokens[index];

    while (line.length > 0) {
      const limit = lines.length === 0 ? firstLimit : restLimit;
      const nextLength = length + 1 + token.length;
      const extra = isParenthetical(token) ? (options.parentheticalOverflow ?? 0) : 0;

      if (nextLength <= limit + extra) {
        break;
      }

      const carry: string[] = [];

      while (line.length >= 2 && breaksBefore(line.at(-2) ?? '', line.at(-1) ?? '', carry[0] ?? token, options)) {
        carry.unshift(line.pop() ?? '');
      }

      lines.push(line);

      if (lines.length >= maxLines) {
        return lines;
      }

      line = carry;
      length = lineLength(carry);
    }

    line.push(token);

    length = lineLength(line);
  }

  if (line.length > 0) {
    lines.push(line);
  }

  return lines;
}

const MIN_LAST_LINE_WORDS = 3;

export function hasWidow(lines: readonly (readonly string[])[]): boolean {
  const last = lines.at(-1) ?? [];
  const words = last.reduce((count, token) => count + (isParenthetical(token) ? tokenize(token).length : 1), 0);

  return lines.length >= 2 && words < MIN_LAST_LINE_WORDS;
}

export interface LayoutOptions extends WrapOptions {
  /**
   * Keeps the first line out of the balancing, e.g. for a JSDoc tag whose first
   * line holds `@param {Type} name -`.
   */
  readonly keepFirstLine?: boolean;

  /**
   * Keeps the fewest lines even when a line sticks out far past the line before it.
   */
  readonly keepSteps?: boolean;

  /**
   * Sets which words at the end of a line cost extra. By default, the first few words of a
   * sentence, the first word after a comma, and an article do. With `sentences`, only the
   * first words of a sentence do, and with `none`, no word does.
   */
  readonly endWords?: 'sentences' | 'none';
}

/**
 * Sets how heavily lines that come close to the width count against lines that are even. With too
 * much weight, lines of 86 and 89 columns beat two of 86 at a width of 100, which leaves a word
 * like `as` at the end of the longer line, away from the words that it belongs to, and lines of
 * 87 and 90 columns beat lines of 87 and 86.
 */
const FULLNESS_WEIGHT = 0.045;
const PARENTHETICAL_SPLIT_WEIGHT = 2;

/**
 * Sets how much a line costs when it ends with the first `MAX_SENTENCE_START_WORDS` words or fewer
 * of a sentence, like `It allocates` in `...UDP opens. It allocates`. It costs as much as a line
 * that ends 5 columns before the others, so lines that are only a little less even win.
 */
const SENTENCE_START_COST = 25;
const MAX_SENTENCE_START_WORDS = 2;

/**
 * Sets how much a line costs when it ends with the first word after a comma, like `so` in
 * `...a symlink, so`, since that word starts what the next line says. A word that only joins
 * the two sides, like `and`, costs nothing (see `STATEMENT_END`).
 */
const CLAUSE_START_COST = 10;
const JOINING_WORDS = new Set(['and', 'or', 'nor']);
const ARTICLES = new Set(['a', 'an', 'the']);

/**
 * Holds what a line costs for the words that it ends with.
 */
interface EndWordCosts {
  /**
   * Holds the cost of ending with the first `MAX_SENTENCE_START_WORDS` words or fewer
   * of a sentence.
   */
  readonly sentenceStart: number;

  /**
   * Holds the cost of ending with the first word after a comma (see `CLAUSE_START_COST`).
   */
  readonly clauseStart: number;

  /**
   * Holds the cost of ending with an article, which belongs to the noun on the next line.
   */
  readonly article: number;

  /**
   * Holds the cost of ending inside a sentence instead of after one.
   */
  readonly insideSentence: number;
}

/**
 * Sets what the words at the end of a line cost in the even lines for one width. An article costs
 * a little, so that it moves to its noun when that leaves the lines about as even.
 */
const BALANCE_COSTS: EndWordCosts = {
  sentenceStart: SENTENCE_START_COST,
  clauseStart: CLAUSE_START_COST,
  article: 4,
  insideSentence: 0,
};

/**
 * Sets what the words at the end of a line cost when the layouts for the widths within the tolerance
 * compete (see `edgeCost`), in the units of a square column of a ragged right edge, so an even edge
 * wins over each of them. A line that ends inside a sentence costs about as much as one that ends 4
 * columns before the others, and an article, like `the`, at the end of a line about as much as one
 * that ends 3 columns before them. The first words of a sentence already cost their share in the
 * layout for each width.
 */
const EDGE_COSTS: EndWordCosts = {
  sentenceStart: 1,
  clauseStart: 5,
  article: 10,
  insideSentence: 15,
};

/**
 * Sets how much a line costs for the square of its columns past the limit when the layouts for the
 * widths within the tolerance compete, so of two edges that are about as even, the one closer to
 * the width wins.
 */
const PAST_LIMIT_WEIGHT = 0.05;

/**
 * Sets how many columns a line may stick out past the line before it.
 */
const MAX_STEP = 15;

/**
 * Sets how many lines more than its fewest a layout may take to keep a line from sticking out.
 */
const EXTRA_LINES = 2;

/**
 * Holds what the cost of a line depends on, besides the length that the lines aim for.
 */
interface BalanceInput {
  /**
   * Holds the column that each token starts at when all tokens share a line, and the column after
   * the last token.
   */
  readonly starts: readonly number[];
  readonly count: number;

  /**
   * Holds how many fewer columns the first line has than the other lines.
   */
  readonly offset: number;

  /**
   * Holds for each token whether it may not start a line.
   */
  readonly blockStarts: readonly boolean[];

  /**
   * Holds for each token whether a line of two or more tokens may not end before it.
   */
  readonly afterOrphan: readonly boolean[];
  readonly splitCosts: ReadonlyMap<number, number>;
}

/**
 * Holds the cheapest layouts that end one line, one for each token that the line can end before.
 */
interface LineCosts {
  /**
   * Holds the token that the first entry of `costs` and `origins` ends before.
   */
  readonly base: number;
  readonly costs: readonly number[];

  /**
   * Holds the token that the line starts with in the layout of each entry of `costs`.
   */
  readonly origins: readonly number[];

  /**
   * Holds the first token that the line can end before.
   */
  readonly low: number;

  /**
   * Holds the last token that the line can end before.
   */
  readonly high: number;
}

/**
 * Returns, for each token, the fewest lines of at most `target` columns that hold the tokens from
 * it on. No token is longer than `target`.
 */
function fewestLines(starts: readonly number[], target: number): Int32Array {
  const total = starts.length - 1;
  const fewest = new Int32Array(total + 1);

  let end = total;

  for (let index = total - 1; index >= 0; index -= 1) {
    while (starts[end] - starts[index] - 1 > target) {
      end -= 1;
    }

    fewest[index] = fewest[end] + 1;
  }

  return fewest;
}

/**
 * Returns the first index from `from` on whose value is at most `limit`. The values never grow as
 * the index rises, so a binary search can find it.
 */
function firstAtMost(values: Int32Array, limit: number, from: number): number {
  let low = from;
  let high = values.length - 1;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);

    if (values[middle] <= limit) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return low;
}

/**
 * Returns the cheapest layouts that end the given line, or `undefined` when the line can't end
 * anywhere. It only looks at the ends that a whole layout can use. The lines before it reach up
 * to an end, and the lines after it can hold the rest from an end on, which leaves a narrow band
 * of tokens instead of all of them.
 */
function costsOfLine(
  input: BalanceInput,
  target: number,
  line: number,
  previous: LineCosts,
  fewest: Int32Array,
): LineCosts | undefined {
  const { starts, afterOrphan } = input;
  const offset = line === 1 ? input.offset : 0;
  const linesLeft = input.count - line;

  // each line after this one needs a token
  const last = starts.length - 1 - linesLeft;
  const base = firstAtMost(fewest, linesLeft, Math.max(line, previous.low + 1));
  const costs: number[] = [];
  const origins: number[] = [];

  let low = -1;
  let high = -1;

  for (let end = base; end <= last; end += 1) {
    const nearest = Math.min(end - 1, previous.high);

    // from here on, a line is too long even when it starts at the last end of the line before it
    if (end > previous.high && starts[end] - starts[nearest] - 1 + offset > target) {
      break;
    }

    let cost = Infinity;
    let origin = -1;

    if (!input.blockStarts[end]) {
      const splitCost = input.splitCosts.get(end) ?? 0;

      for (let start = nearest; start >= previous.low; start -= 1) {
        const length = starts[end] - starts[start] - 1 + offset;

        if (length > target) {
          break;
        }

        const before = previous.costs[start - previous.base];

        if (before === Infinity || (afterOrphan[end] && end - start >= 2)) {
          continue;
        }

        const candidate = before + (target - length) ** 2 + splitCost;

        if (candidate <= cost) {
          cost = candidate;
          origin = start;
        }
      }
    }

    costs.push(cost);
    origins.push(origin);

    if (cost !== Infinity) {
      low = low === -1 ? end : low;
      high = end;
    }
  }

  return low === -1 ? undefined : { base, costs, origins, low, high };
}

/**
 * Lays the tokens out in `count` lines that are as even as possible. It tries every length that
 * the lines can aim for and keeps the layout with the lowest cost. Of two layouts with the same
 * cost, it keeps the one that aims for longer lines, and then the one with the longer last line.
 */
function balanceTokens(
  tokens: readonly string[],
  firstLimit: number,
  restLimit: number,
  count: number,
  options: LayoutOptions,
  preferredLimit = restLimit,
  splitCosts: ReadonlyMap<number, number> = new Map(),
): string[][] | undefined {
  const total = tokens.length;
  const starts = [0];

  let longest = -Infinity;

  for (const token of tokens) {
    starts.push((starts.at(-1) ?? 0) + token.length + 1);

    longest = Math.max(longest, token.length);
  }

  const input: BalanceInput = {
    starts,
    count,
    offset: restLimit - firstLimit,
    blockStarts: tokens.map((token) => startsBlock(token)),
    afterOrphan: tokens.map((_, index) => {
      return options.avoidSentenceOrphans && index >= 2 && isOrphan(tokens[index - 2], tokens[index - 1]);
    }),
    splitCosts: withWordCosts(tokens, splitCosts, options),
  };

  const targets: number[] = [];

  for (let target = restLimit; target >= Math.max(longest, Math.floor(restLimit / 2)); target -= 1) {
    targets.push(target);
  }

  // the lines before the last one hold at most this many columns together, which is when the last line is empty
  const most = starts[total] - count + input.offset;

  let best: { cost: number; target: number; breaks: number[] } | undefined;

  /**
   * Short targets come first. They rule most layouts out, so they are cheap, and their cost lets
   * the loop skip the long targets, whose lines can't all be full.
   */
  for (const target of targets.toReversed()) {
    const fullness = FULLNESS_WEIGHT * (count - 1) * (preferredLimit - target) ** 2;
    const spare = (count - 1) * target - most;

    // lines that are `spare` columns short together cost the least when they are all equally short
    const least = count > 1 && spare > 0 ? Math.max(spare ** 2 / (count - 1) - 1, 0) : 0;

    if (best !== undefined && least + fullness > best.cost) {
      continue;
    }

    const fewest = fewestLines(starts, target);
    const rows: LineCosts[] = [{ base: 0, costs: [0], origins: [-1], low: 0, high: 0 }];

    for (let line = 1; line < count; line += 1) {
      const row = costsOfLine(input, target, line, rows[line - 1], fewest);

      if (!row) {
        break;
      }

      rows.push(row);
    }

    if (rows.length < count) {
      continue;
    }

    const row = rows[count - 1];

    for (let start = row.low; start <= row.high; start += 1) {
      const score = row.costs[start - row.base] + fullness;

      const improves = score < (best?.cost ?? Infinity) || (score === best?.cost && target > best.target);

      if (!improves || starts[total] - starts[start] - 1 > target || hasWidow([[], tokens.slice(start)])) {
        continue;
      }

      const breaks = [start];

      for (let line = count - 1; line > 1; line -= 1) {
        breaks.unshift(rows[line].origins[breaks[0] - rows[line].base]);
      }

      best = { cost: score, target, breaks };
    }
  }

  if (!best) {
    return undefined;
  }

  const bounds = [0, ...best.breaks, total];

  return bounds.slice(0, -1).map((start, index) => tokens.slice(start, bounds[index + 1]));
}

/**
 * Returns whether a line sticks out more than `MAX_STEP` columns past the line before it.
 * The first line starts `offset` columns after the others, so it ends that much later too.
 */
function hasStep(lines: readonly (readonly string[])[], offset = 0): boolean {
  return lines.some((line, index) => {
    if (index === 0) {
      return false;
    }

    const before = lineLength(lines[index - 1]) + (index === 1 ? offset : 0);

    return lineLength(line) - before > MAX_STEP;
  });
}

/**
 * Returns how many columns each line may hold when the lines take the tolerance. A line may end
 * `tolerance` columns past its limit. The last line may only end past its limit when it then ends
 * at most `tolerance` columns after the longest line before it. A last line that sticks out past
 * the limit and past every line above it holds what belongs on a line of its own. The first line
 * starts `restLimit - firstLimit` columns after the others, so it ends that much later too.
 */
export function toleranceLimits(
  lines: readonly (readonly string[])[],
  firstLimit: number,
  restLimit: number,
  tolerance: number,
): number[] {
  const last = lines.length - 1;

  const longestBefore = Math.max(
    0,
    ...lines.slice(0, last).map((line, index) => lineLength(line) + (index === 0 ? restLimit - firstLimit : 0)),
  );

  return lines.map((_, index) => {
    const limit = index === 0 ? firstLimit : restLimit;

    // the only line of a paragraph has no line above it to stick out past
    if (index < last || last === 0) {
      return limit + tolerance;
    }

    return Math.max(limit, Math.min(limit, longestBefore) + tolerance);
  });
}

/**
 * Returns whether the last line ends past what the tolerance allows it (see `toleranceLimits`).
 */
function lastLineSticksOut(
  lines: readonly (readonly string[])[],
  firstLimit: number,
  restLimit: number,
  tolerance: number,
): boolean {
  const limit = toleranceLimits(lines, firstLimit, restLimit, tolerance).at(-1) ?? Infinity;

  return lineLength(lines.at(-1) ?? []) > limit;
}

function splitCostsOf(tokens: readonly string[], limit: number): Map<number, number> {
  const splitCosts = new Map<number, number>();

  for (const group of parentheticalGroups(tokens, limit)) {
    const length = lineLength(tokens.slice(group.start, group.end));

    for (let at = group.start + 1; at < group.end; at += 1) {
      splitCosts.set(at, length * PARENTHETICAL_SPLIT_WEIGHT);
    }
  }

  return splitCosts;
}

/**
 * Returns what each line break costs for the words that it leaves at the end of the line
 * before it, keyed by the token that the next line starts with. A break after a whole
 * sentence of `MAX_SENTENCE_START_WORDS` words or fewer costs nothing for its sentence start.
 * With `endWords: 'sentences'`, only the words of a sentence count, and with `none`, no word does.
 */
function endWordCosts(tokens: readonly string[], options: LayoutOptions, costs: EndWordCosts): Map<number, number> {
  const breaks = new Map<number, number>();

  if (!options.avoidSentenceOrphans || options.endWords === 'none') {
    return breaks;
  }

  const add = (end: number, cost: number) => {
    if (cost > 0) {
      breaks.set(end, (breaks.get(end) ?? 0) + cost);
    }
  };

  for (const [index, token] of tokens.entries()) {
    const next = tokens[index + 1] ?? '';

    if (options.endWords === undefined) {
      if (/,["')\]*_]*$/.test(token) && !CLAUSE_END.test(next) && !JOINING_WORDS.has(next.toLowerCase())) {
        add(index + 2, costs.clauseStart);
      }

      if (ARTICLES.has(token.toLowerCase())) {
        add(index + 1, costs.article);
      }
    }

    if (!endsSentence(token)) {
      add(index + 1, costs.insideSentence);

      continue;
    }

    const last = Math.min(index + 1 + MAX_SENTENCE_START_WORDS, tokens.length - 1);

    for (let end = index + 2; end <= last && !endsSentence(tokens[end - 1]); end += 1) {
      add(end, costs.sentenceStart);
    }
  }

  return breaks;
}

function withWordCosts(
  tokens: readonly string[],
  splitCosts: ReadonlyMap<number, number>,
  options: LayoutOptions,
): ReadonlyMap<number, number> {
  const costs = new Map(splitCosts);

  for (const [end, cost] of endWordCosts(tokens, options, BALANCE_COSTS)) {
    costs.set(end, (costs.get(end) ?? 0) + cost);
  }

  return costs;
}

/**
 * Returns how far the lines are from a straight right edge. Each line but the last costs
 * the square of the columns that it ends before the longest of them, and each line costs
 * `PAST_LIMIT_WEIGHT` for the square of its columns past its limit. The words at the end
 * of each line add `EDGE_COSTS`. The first line starts `restLimit - firstLimit` columns
 * after the others, so it ends that much later too.
 */
function edgeCost(
  lines: readonly (readonly string[])[],
  firstLimit: number,
  restLimit: number,
  options: LayoutOptions,
): number {
  const ends = lines.map((line, index) => lineLength(line) + (index === 0 ? restLimit - firstLimit : 0));

  // the only line of a paragraph has no line before it to stick out past
  const longest = ends.length > 1 ? Math.max(...ends.slice(0, -1)) : Infinity;
  const breaks = endWordCosts(lines.flat(), options, EDGE_COSTS);

  let cost = 0;
  let next = 0;

  for (const [index, end] of ends.entries()) {
    next += lines[index].length;
    cost += PAST_LIMIT_WEIGHT * Math.max(0, end - restLimit) ** 2;

    // a last line that ends past the lines before it is part of the edge, while a shorter one isn't
    cost += index < ends.length - 1 ? (longest - end) ** 2 + (breaks.get(next) ?? 0) : Math.max(0, end - longest) ** 2;
  }

  return cost;
}

function hasParentheticals(tokens: readonly string[], restLimit: number, options: WrapOptions): boolean {
  if (options.parentheticalOverflow === undefined) {
    return false;
  }

  return bindParentheticals(tokens, restLimit + options.parentheticalOverflow).some((token) => isParenthetical(token));
}

/**
 * Lays the tokens out in even lines. When a line sticks out far past the line before it, like a
 * full second line after a first line that the orphan rule keeps short, the layout takes up to
 * `EXTRA_LINES` more lines if those avoid the step.
 */
export function layoutTokens(
  tokens: readonly string[],
  firstLimit: number,
  restLimit: number,
  options: LayoutOptions,
): string[][] {
  const lines = layoutLines(tokens, firstLimit, restLimit, options);
  const offset = restLimit - firstLimit;

  // the first line of a JSDoc tag is never balanced, and the lines after it get their own layout
  if (options.keepFirstLine || options.keepSteps || !hasStep(lines, offset)) {
    return lines;
  }

  const overflow = hasParentheticals(tokens, restLimit, options) ? (options.parentheticalOverflow ?? 0) : 0;
  const splitCosts = overflow > 0 ? splitCostsOf(tokens, restLimit + overflow) : new Map<number, number>();

  for (let count = lines.length + 1; count <= lines.length + EXTRA_LINES; count += 1) {
    const even = balanceTokens(
      tokens,
      firstLimit + overflow,
      restLimit + overflow,
      count,
      options,
      restLimit,
      splitCosts,
    );

    if (even && !hasStep(even, offset)) {
      return even;
    }
  }

  return lines;
}

/**
 * Lays the tokens out for the limits and for the limits up to `tolerance` columns wider, and
 * returns the layout with the fewest lines and then the straightest right edge (see `edgeCost`).
 * The tolerance is room to save a line or to even the edge, so a wider layout only competes when
 * it has no step and no last line that sticks out (see `toleranceLimits`), and a paragraph of
 * two lines keeps them, since its second line would have to join the first. Of two layouts that
 * are as straight, the one for the narrower limit wins.
 */
function layoutLines(
  tokens: readonly string[],
  firstLimit: number,
  restLimit: number,
  options: LayoutOptions,
): string[][] {
  const within = layoutWithinLimit(tokens, firstLimit, restLimit, options);

  /**
   * The first line of a JSDoc tag is never balanced, and the lines after it get the tolerance of
   * their own. A paragraph with a parenthetical that may go past the width already has room up to
   * the maximum, which the tolerance doesn't add to.
   */
  if (options.tolerance === 0 || options.keepFirstLine || hasParentheticals(tokens, restLimit, options)) {
    return within;
  }

  let best = { lines: within, cost: edgeCost(within, firstLimit, restLimit, options) };

  for (let extra = 1; extra <= options.tolerance; extra += 1) {
    // the room of a parenthetical ends at the same column for every width
    const lines = layoutWithinLimit(tokens, firstLimit + extra, restLimit + extra, {
      ...options,
      parentheticalOverflow:
        options.parentheticalOverflow === undefined ? undefined : options.parentheticalOverflow - extra,
    });

    if (
      (lines.length < 2 && within.length >= 2) ||
      hasStep(lines, restLimit - firstLimit) ||
      lastLineSticksOut(lines, firstLimit, restLimit, options.tolerance)
    ) {
      continue;
    }

    const cost = edgeCost(lines, firstLimit, restLimit, options);

    if (lines.length < best.lines.length || (lines.length === best.lines.length && cost < best.cost)) {
      best = { lines, cost };
    }
  }

  return best.lines;
}

function layoutWithinLimit(
  tokens: readonly string[],
  firstLimit: number,
  restLimit: number,
  options: LayoutOptions,
): string[][] {
  if (options.parentheticalOverflow !== undefined) {
    const grouped = bindParentheticals(tokens, restLimit + options.parentheticalOverflow);

    if (grouped.some((token) => isParenthetical(token))) {
      const minimumLines = Math.max(
        2,
        Math.ceil((lineLength(tokens) + 1 + restLimit - firstLimit) / Math.max(1, restLimit + 1)),
      );

      let preserved = wrapTokens(grouped, firstLimit, restLimit, options);
      let extra = 0;

      if (minimumLines === 2 && preserved.length > 2) {
        const wide = wrapTokens(
          grouped,
          firstLimit + options.parentheticalOverflow,
          restLimit + options.parentheticalOverflow,
          { ...options, parentheticalOverflow: undefined },
        );

        if (wide.length === 2 && !hasWidow(wide)) {
          preserved = wide;
          extra = options.parentheticalOverflow;
        }
      }

      if (preserved.length <= 2 && !hasWidow(preserved)) {
        // a parenthetical that only fits past the limit keeps the lines as they are
        const fits = preserved.every(
          (line, index) => lineLength(line) <= (index === 0 ? firstLimit : restLimit) + extra,
        );

        const even =
          preserved.length === 2 && fits
            ? balanceTokens(grouped, firstLimit + extra, restLimit + extra, 2, options, restLimit)
            : undefined;

        let cursor = 0;

        return (even ?? preserved).map((line) => {
          const expanded: string[] = [];
          const length = lineLength(line);

          let used = -1;

          while (cursor < tokens.length && used < length) {
            const token = tokens[cursor++];

            expanded.push(token);

            used += token.length + 1;
          }

          return expanded;
        });
      }

      const splitCosts = splitCostsOf(tokens, restLimit + options.parentheticalOverflow);
      const preferred = wrapTokens(tokens, firstLimit, restLimit, { ...options, parentheticalOverflow: undefined });

      for (let count = minimumLines; count <= Math.max(preferred.length + 1, preserved.length); count += 1) {
        const balanced = balanceTokens(
          tokens,
          firstLimit + options.parentheticalOverflow,
          restLimit + options.parentheticalOverflow,
          count,
          options,
          restLimit,
          splitCosts,
        );

        if (balanced) {
          return balanced;
        }
      }
    }
  }

  const greedy = wrapTokens(tokens, firstLimit, restLimit, options);

  if (greedy.length < 2) {
    return greedy;
  }

  if (options.keepFirstLine) {
    const [head] = greedy;
    const rest = layoutTokens(tokens.slice(head.length), restLimit, restLimit, { ...options, keepFirstLine: false });
    const lines = [head, ...rest];

    if (!hasWidow(lines)) {
      return lines;
    }
  }

  return balanceTokens(tokens, firstLimit, restLimit, greedy.length, options) ?? greedy;
}

/**
 * Ends the first of two lines with a sentence when the rest fits on the second line without
 * sticking out past the first. A second line that would stick out keeps the lines as they are.
 */
export function breakAfterSentence(
  lines: string[][],
  firstLimit: number,
  restLimit: number,
  options: WrapOptions,
): string[][] {
  if (lines.length !== 2 || !options.avoidSentenceOrphans) {
    return lines;
  }

  const tokens = lines.flat();

  // the first line starts this many columns after the second, so it ends that much later too
  const offset = restLimit - firstLimit;

  for (let end = tokens.length - 1; end > 0; end -= 1) {
    const first = tokens.slice(0, end);
    const second = tokens.slice(end);

    // a second line that is no longer than a first line within its limit is within its own limit too
    if (
      endsSentence(tokens[end - 1]) &&
      !hasWidow([first, second]) &&
      !breaksBefore(tokens[end - 2] ?? '', tokens[end - 1], tokens[end], options) &&
      lineLength(first) <= firstLimit &&
      lineLength(second) <= lineLength(first) + offset
    ) {
      return [first, second];
    }
  }

  return lines;
}

/**
 * A wrap produced by `wrapTokens` with the same arguments never has issues, unless a single token
 * is wider than the limit.
 */
export function findLineIssues(
  lines: readonly (readonly string[])[],
  firstLimit: number,
  restLimit: number,
  options: WrapOptions,
): LineIssue[] {
  const issues: LineIssue[] = [];
  const tokens = lines.flat();

  let next = 0;

  for (const [index, line] of lines.entries()) {
    const limit = index === 0 ? firstLimit : restLimit;
    const length = lineLength(line);
    const start = next;

    next += line.length;

    if (line.length > 1 && length > limit + options.tolerance) {
      issues.push({ type: 'overflow', line: index });
    }

    if (index === lines.length - 1 || line.length === 0) {
      continue;
    }

    if (options.avoidSentenceOrphans && line.length >= 2 && isOrphan(line.at(-2) ?? '', line.at(-1) ?? '')) {
      issues.push({ type: 'orphan', line: index });
    }

    /**
     * Only the first line of a wrap of the rest counts. A line that may end with the start of a
     * sentence is measured too, because the words that fit on it don't depend on its last word.
     */
    const [expected] = wrapFrom(tokens, start, limit, restLimit, options, 1);

    if (expected.length > line.length) {
      issues.push({ type: 'underfill', line: index });
    }
  }

  return issues;
}
