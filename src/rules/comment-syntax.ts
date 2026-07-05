import type { AST, Rule } from 'eslint';

interface CommentLike {
  readonly type: string;
  readonly value: string;
  readonly range?: [number, number];
  readonly loc?: Rule.Node['loc'];
}

interface LineOptions {
  readonly requireLeadingSpace: boolean;
  readonly requireLowercase: boolean;
  readonly forbidTrailingPunctuation: boolean;
  readonly allowedEndings: readonly string[];
}

interface BlockOptions {
  readonly requireCapital: boolean;
  readonly requireTrailingPunctuation: boolean;
  readonly requireJSDocOpening: boolean;
  readonly enforceOpening: boolean;
  readonly enforceClosing: boolean;
  readonly requireSpaceAfterStar: boolean;
  readonly requireParagraphCapital: boolean;
  readonly paragraphEndings: readonly string[];
  readonly requireJSDocSpacing: boolean;
  readonly enforceParamStyle: boolean;
}

interface ResolvedOptions {
  readonly ignoredWords: ReadonlySet<string>;
  readonly ignoredPatterns: readonly RegExp[];
  readonly ignoreUrls: boolean;
  readonly ignoreDirectives: boolean;
  readonly line: LineOptions;
  readonly block: BlockOptions;
}

type MessageId =
  | 'lineLeadingSpace'
  | 'lineLowercase'
  | 'lineTrailingPunctuation'
  | 'blockCapital'
  | 'blockTrailingPunctuation'
  | 'blockSingleLineJSDoc'
  | 'blockJSDocOpening'
  | 'blockOpening'
  | 'blockClosing'
  | 'blockEmptyLineBeforeClose'
  | 'blockLineSpaceAfterStar'
  | 'blockParagraphCapital'
  | 'blockParagraphEnding'
  | 'blockJSDocBlankLine'
  | 'paramMissingDash'
  | 'paramDescriptionPeriod';

type AnyComment = CommentLike | AST.Token;

const URL_PATTERN = /\bhttps?:\/\//;

const DIRECTIVE_PATTERN =
  /^\s*(?:eslint(?:-[a-z-]+)?\b|@ts-[a-z-]+|@(?:jsx|jsxFrag|jsxImportSource|jsxRuntime)\b|istanbul\s|c8\s|v8\s|prettier-ignore\b|stylelint-[a-z-]+|webpack[A-Z][a-zA-Z]*|#(?:region|endregion)\b|type\s*:)/;

const TAG_PATTERN = /^\s*(?:TODO|FIXME|HACK|NOTE|BUG|XXX|SAFETY|WARNING|INFO|OPTIMIZE|REVIEW|PERF|DEPRECATED)\b/i;

const FIRST_WORD_PATTERN = /^\s*([A-Za-z_$][\w$]*)/;
const ALL_CAPS_WORD = /^[A-Z][A-Z0-9_]*$/;

const JSDOC_TAG_LINE = /^\s*\*\s*@[A-Za-z]/;
const SINGLE_LINE_JSDOC_TAG = /^@[A-Za-z][\w-]*$/;
const PARAM_DESC_RE = /^@param\s+(?:\{[^}]*\}\s+)?(\S+)\s+(.*\S)\s*$/;
const BLOCK_LINE_WITH_TEXT = /^(\s*\*)(\s*)(\S.*?)\s*$/;
const BLOCK_LINE_EMPTY = /^\s*\*\s*$/;
const CODE_FENCE_LINE = /^\s*\*\s*```/;
const LIST_ITEM_LINE = /^(?:[-*+]|\d+[.)])\s/;

const DEFAULT_LINE_ENDINGS = Object.freeze(['etc.', '...', 'e.g.', 'i.e.']);
const DEFAULT_PARAGRAPH_ENDINGS = Object.freeze(['.', '!', '?', ':', ';', '`', ')', ']', '}']);

const DEFAULT_OPTIONS: ResolvedOptions = {
  ignoredWords: new Set<string>(),
  ignoredPatterns: [],
  ignoreUrls: true,
  ignoreDirectives: true,
  line: {
    requireLeadingSpace: true,
    requireLowercase: true,
    forbidTrailingPunctuation: true,
    allowedEndings: DEFAULT_LINE_ENDINGS,
  },
  block: {
    requireCapital: true,
    requireTrailingPunctuation: true,
    requireJSDocOpening: true,
    enforceOpening: false,
    enforceClosing: false,
    requireSpaceAfterStar: true,
    requireParagraphCapital: true,
    paragraphEndings: DEFAULT_PARAGRAPH_ENDINGS,
    requireJSDocSpacing: true,
    enforceParamStyle: true,
  },
};

function isUpperCase(char: string): boolean {
  return char !== char.toLowerCase() && char === char.toUpperCase();
}

function isLowerCase(char: string): boolean {
  return char !== char.toUpperCase() && char === char.toLowerCase();
}

function isTrailingPunctuation(char: string): boolean {
  return char === '.' || char === '!' || char === '?' || char === ';' || char === ':';
}

function isBlockEndingPunctuation(char: string): boolean {
  return (
    char === '.' ||
    char === '!' ||
    char === '?' ||
    char === ';' ||
    char === ':' ||
    char === ')' ||
    char === ']' ||
    char === '}' ||
    char === '`' ||
    char === '>'
  );
}

function indexOfLastNonSpace(value: string): number {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const char = value.codePointAt(index);

    if (char !== 0x20 && char !== 0x09 && char !== 0x0a && char !== 0x0d) {
      return index;
    }
  }

  return -1;
}

function endsWithAny(value: string, endings: readonly string[]): boolean {
  for (const ending of endings) {
    if (value.endsWith(ending)) {
      return true;
    }
  }

  return false;
}

function resolveOptions(raw: unknown): ResolvedOptions {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_OPTIONS;
  }

  const input = raw as Record<string, unknown>;
  const line = (input.line ?? {}) as Partial<LineOptions>;
  const block = (input.block ?? {}) as Partial<BlockOptions>;

  const patterns = Array.isArray(input.ignoredPatterns)
    ? (input.ignoredPatterns as string[]).map((source) => new RegExp(source))
    : DEFAULT_OPTIONS.ignoredPatterns;

  return {
    ignoredWords: new Set(Array.isArray(input.ignoredWords) ? (input.ignoredWords as string[]) : []),
    ignoredPatterns: patterns,
    ignoreUrls: (input.ignoreUrls as boolean | undefined) ?? DEFAULT_OPTIONS.ignoreUrls,
    ignoreDirectives: (input.ignoreDirectives as boolean | undefined) ?? DEFAULT_OPTIONS.ignoreDirectives,
    line: { ...DEFAULT_OPTIONS.line, ...line },
    block: { ...DEFAULT_OPTIONS.block, ...block },
  };
}

function shouldSkipComment(value: string, options: ResolvedOptions): boolean {
  const trimmed = value.trim();

  if (!trimmed) {
    return true;
  }

  if (options.ignoreDirectives && (DIRECTIVE_PATTERN.test(trimmed) || TAG_PATTERN.test(trimmed))) {
    return true;
  }

  if (options.ignoreUrls && URL_PATTERN.test(trimmed)) {
    return true;
  }

  for (const pattern of options.ignoredPatterns) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  return false;
}

function checkLineComment(context: Rule.RuleContext, comment: AnyComment, options: ResolvedOptions): void {
  const { line } = options;
  const raw = comment.value;
  const loc = comment.loc;
  const range = comment.range;

  if (!loc || !range) {
    return;
  }

  const rangeStart = range[0];

  if (line.requireLeadingSpace && raw.length > 0) {
    const first = raw.codePointAt(0);

    // allow "///" banner comments and tab-indented comments
    if (first !== 0x20 && first !== 0x2f && first !== 0x09) {
      context.report({
        loc,
        messageId: 'lineLeadingSpace',
        fix: (fixer) => fixer.insertTextAfterRange([rangeStart, rangeStart + 2], ' '),
      });
    }
  }

  const trimmed = raw.trim();

  if (!trimmed) {
    return;
  }

  const firstWordMatch = FIRST_WORD_PATTERN.exec(trimmed);

  if (firstWordMatch && line.requireLowercase) {
    const word = firstWordMatch[1];
    const firstChar = word[0];

    if (isUpperCase(firstChar) && !ALL_CAPS_WORD.test(word) && !options.ignoredWords.has(word)) {
      context.report({
        loc,
        messageId: 'lineLowercase',
        fix: (fixer) => {
          const offset = rangeStart + 2 + raw.indexOf(firstChar);

          return fixer.replaceTextRange([offset, offset + 1], firstChar.toLowerCase());
        },
      });
    }
  }

  if (line.forbidTrailingPunctuation && !endsWithAny(trimmed, line.allowedEndings)) {
    const lastChar = trimmed.at(-1) ?? '';

    if (isTrailingPunctuation(lastChar)) {
      context.report({
        loc,
        messageId: 'lineTrailingPunctuation',
        fix: (fixer) => {
          const offset = rangeStart + 2 + indexOfLastNonSpace(raw);

          return fixer.removeRange([offset, offset + 1]);
        },
      });
    }
  }
}

function checkSingleLineBlock(context: Rule.RuleContext, comment: AnyComment, options: ResolvedOptions): void {
  const { block } = options;
  const raw = comment.value;
  const loc = comment.loc;
  const range = comment.range;

  if (!loc || !range) {
    return;
  }

  const trimmed = raw.trim();

  if (!trimmed) {
    return;
  }

  if (raw.startsWith('*')) {
    const inner = raw.slice(1).trim();

    if (!inner) {
      return;
    }

    if (SINGLE_LINE_JSDOC_TAG.test(inner)) {
      return;
    }

    const sourceCode = context.sourceCode;
    const sourceLine = sourceCode.lines[loc.start.line - 1] ?? '';
    const prefix = sourceLine.slice(0, loc.start.column);
    const canFix = /^\s*$/.test(prefix);

    context.report({
      loc,
      messageId: 'blockSingleLineJSDoc',
      fix: canFix ? (fixer) => fixer.replaceTextRange(range, `/**\n${prefix} * ${inner}\n${prefix} */`) : undefined,
    });

    return;
  }

  const rangeStart = range[0];
  const firstWordMatch = FIRST_WORD_PATTERN.exec(trimmed);

  if (firstWordMatch && block.requireCapital) {
    const word = firstWordMatch[1];
    const firstChar = word[0];

    if (isLowerCase(firstChar) && !ALL_CAPS_WORD.test(word) && !options.ignoredWords.has(word)) {
      context.report({
        loc,
        messageId: 'blockCapital',
        fix: (fixer) => {
          const offset = rangeStart + 2 + raw.indexOf(firstChar);

          return fixer.replaceTextRange([offset, offset + 1], firstChar.toUpperCase());
        },
      });
    }
  }

  if (block.requireTrailingPunctuation) {
    const lastChar = trimmed.at(-1) ?? '';

    if (!isBlockEndingPunctuation(lastChar)) {
      context.report({
        loc,
        messageId: 'blockTrailingPunctuation',
        fix: (fixer) => {
          const offset = rangeStart + 2 + indexOfLastNonSpace(raw);

          return fixer.insertTextAfterRange([offset, offset + 1], '.');
        },
      });
    }
  }
}

function offsetOfLine(comment: AnyComment, lines: readonly string[], lineIndex: number): number {
  const range = comment.range;

  if (!range) {
    return 0;
  }

  // base = range start + length of `/*`, then cumulative line lengths plus their '\n' separators
  let offset = range[0] + 2;

  for (let index = 0; index < lineIndex; index += 1) {
    offset += lines[index].length + 1;
  }

  return offset;
}

function skipParagraphFirstWord(text: string, options: ResolvedOptions): boolean {
  const match = FIRST_WORD_PATTERN.exec(text);

  if (!match) {
    return true;
  }

  const word = match[1];

  return ALL_CAPS_WORD.test(word) || options.ignoredWords.has(word);
}

function reportParagraphEnding(
  context: Rule.RuleContext,
  comment: AnyComment,
  text: string,
  options: ResolvedOptions,
): void {
  const { block } = options;
  const loc = comment.loc;

  if (!loc) {
    return;
  }

  for (const ending of block.paragraphEndings) {
    if (text.endsWith(ending)) {
      return;
    }
  }

  context.report({
    loc,
    messageId: 'blockParagraphEnding',
    data: { endings: `[${block.paragraphEndings.join(' ')}]` },
  });
}

function checkParameterLine(
  context: Rule.RuleContext,
  comment: AnyComment,
  lines: readonly string[],
  lineIndex: number,
  text: string,
  starSegment: string,
  spaces: string,
): void {
  const loc = comment.loc;

  if (!loc) {
    return;
  }

  const match = PARAM_DESC_RE.exec(text);

  if (!match) {
    return;
  }

  const descPart = match[2];
  const textStart = offsetOfLine(comment, lines, lineIndex) + starSegment.length + spaces.length;

  if (!descPart.startsWith('- ')) {
    const prefixMatch = /^@param\s+(?:\{[^}]*\}\s+)?\S+\s+/.exec(text);

    if (!prefixMatch) {
      return;
    }

    const descStartOffset = textStart + prefixMatch[0].length;

    context.report({
      loc,
      messageId: 'paramMissingDash',
      fix: (fixer) => fixer.insertTextBeforeRange([descStartOffset, descStartOffset + 1], '- '),
    });

    return;
  }

  const description = descPart.slice(2).trim();

  if (!description) {
    return;
  }

  if (!description.endsWith('.')) {
    const textEndOffset = textStart + text.length;

    context.report({
      loc,
      messageId: 'paramDescriptionPeriod',
      fix: (fixer) => fixer.insertTextAfterRange([textEndOffset - 1, textEndOffset], '.'),
    });
  }
}

function checkMultiLineBlock(context: Rule.RuleContext, comment: AnyComment, options: ResolvedOptions): void {
  const { block } = options;
  const loc = comment.loc;
  const range = comment.range;

  if (!loc || !range) {
    return;
  }

  const lines = comment.value.split('\n');
  const firstLine = lines[0];
  const lastLine = lines.at(-1) ?? '';

  // the comment value excludes the `/*` opener, so a `/**` comment has a value starting with `*`
  if (block.requireJSDocOpening && !comment.value.startsWith('*')) {
    const openerEnd = range[0] + 2;

    context.report({
      loc,
      messageId: 'blockJSDocOpening',
      fix: (fixer) => fixer.insertTextAfterRange([range[0], openerEnd], '*'),
    });
  }

  if (block.enforceOpening) {
    const opening = firstLine.trim();

    if (opening !== '' && opening !== '*') {
      context.report({ loc, messageId: 'blockOpening' });

      return;
    }
  }

  if (block.enforceClosing) {
    if (lastLine.trim() !== '') {
      context.report({ loc, messageId: 'blockClosing' });

      return;
    }

    if (lines.length >= 3 && BLOCK_LINE_EMPTY.test(lines.at(-2) ?? '')) {
      context.report({ loc, messageId: 'blockEmptyLineBeforeClose' });
    }
  }

  let insideCodeBlock = false;
  let paragraphStart = true;
  let skipParagraphEnding = false;
  let previousText: string | undefined;

  for (let index = 1; index < lines.length - 1; index += 1) {
    const line = lines[index];

    if (CODE_FENCE_LINE.test(line)) {
      insideCodeBlock = !insideCodeBlock;
      paragraphStart = true;
      skipParagraphEnding = false;
      previousText = undefined;

      continue;
    }

    if (insideCodeBlock) {
      continue;
    }

    if (BLOCK_LINE_EMPTY.test(line)) {
      if (previousText !== undefined && block.requireParagraphCapital && !skipParagraphEnding) {
        reportParagraphEnding(context, comment, previousText, options);
      }

      paragraphStart = true;
      skipParagraphEnding = false;
      previousText = undefined;

      continue;
    }

    const match = BLOCK_LINE_WITH_TEXT.exec(line);

    if (!match) {
      continue;
    }

    const [, starSegment, spaces, text] = match;

    // list items and JSDoc tags (plus wrapped continuation lines) are exempt from paragraph endings
    if (LIST_ITEM_LINE.test(text) || JSDOC_TAG_LINE.test(line)) {
      skipParagraphEnding = true;
    }

    if (block.requireSpaceAfterStar && spaces.length === 0) {
      const lineOffset = offsetOfLine(comment, lines, index);
      const starEnd = lineOffset + starSegment.length;

      context.report({
        loc,
        messageId: 'blockLineSpaceAfterStar',
        fix: (fixer) => fixer.insertTextAfterRange([starEnd - 1, starEnd], ' '),
      });

      continue;
    }

    if (block.requireJSDocSpacing && JSDOC_TAG_LINE.test(line) && previousText !== undefined) {
      const previousLine = lines[index - 1];

      if (!BLOCK_LINE_EMPTY.test(previousLine) && !JSDOC_TAG_LINE.test(previousLine)) {
        context.report({ loc, messageId: 'blockJSDocBlankLine' });
      }
    }

    if (paragraphStart && block.requireParagraphCapital && !JSDOC_TAG_LINE.test(line)) {
      const firstChar = text[0];

      if (firstChar && isLowerCase(firstChar) && !skipParagraphFirstWord(text, options)) {
        const lineOffset = offsetOfLine(comment, lines, index);
        const charOffset = lineOffset + starSegment.length + spaces.length;

        context.report({
          loc,
          messageId: 'blockParagraphCapital',
          fix: (fixer) => fixer.replaceTextRange([charOffset, charOffset + 1], firstChar.toUpperCase()),
        });
      }
    }

    paragraphStart = false;

    if (block.enforceParamStyle && /^@param\s/.test(text)) {
      checkParameterLine(context, comment, lines, index, text, starSegment, spaces);
      previousText = undefined;
    } else {
      previousText = text;
    }
  }

  if (previousText !== undefined && block.requireParagraphCapital && !skipParagraphEnding) {
    reportParagraphEnding(context, comment, previousText, options);
  }
}

const messages: Record<MessageId, string> = {
  lineLeadingSpace: 'Line comment should start with a space.',
  lineLowercase: 'Line comment should start with a lowercase letter.',
  lineTrailingPunctuation: 'Line comment should not end with punctuation.',
  blockCapital: 'Block comment should start with an uppercase letter.',
  blockTrailingPunctuation: 'Block comment should end with punctuation.',
  blockSingleLineJSDoc: 'JSDoc-style block comments (/** ... */) must span multiple lines.',
  blockJSDocOpening: "Multi-line block comments must start with '/**', not '/*'.",
  blockOpening: "Block comment should start with '/**\\n *' (or '/*\\n *').",
  blockClosing: "Block comment should end with '\\n */'.",
  blockEmptyLineBeforeClose: 'Block comment should not end with an empty line.',
  blockLineSpaceAfterStar: "Each line of a block comment requires a space after '*'.",
  blockParagraphCapital: 'Paragraph should start with an uppercase letter.',
  blockParagraphEnding: 'Paragraph should end with one of {{endings}}.',
  blockJSDocBlankLine: 'Insert a blank line before JSDoc tags.',
  paramMissingDash: "@param should use ' - ' between name and description.",
  paramDescriptionPeriod: '@param description should end with a period.',
};

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Enforce comment casing, punctuation, and JSDoc/paragraph structure for line, single-line block, and multi-line block comments.',
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          ignoredWords: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
          ignoredPatterns: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
          ignoreUrls: { type: 'boolean' },
          ignoreDirectives: { type: 'boolean' },
          line: {
            type: 'object',
            additionalProperties: false,
            properties: {
              requireLeadingSpace: { type: 'boolean' },
              requireLowercase: { type: 'boolean' },
              forbidTrailingPunctuation: { type: 'boolean' },
              allowedEndings: {
                type: 'array',
                items: { type: 'string' },
                uniqueItems: true,
              },
            },
          },
          block: {
            type: 'object',
            additionalProperties: false,
            properties: {
              requireCapital: { type: 'boolean' },
              requireTrailingPunctuation: { type: 'boolean' },
              requireJSDocOpening: { type: 'boolean' },
              enforceOpening: { type: 'boolean' },
              enforceClosing: { type: 'boolean' },
              requireSpaceAfterStar: { type: 'boolean' },
              requireParagraphCapital: { type: 'boolean' },
              paragraphEndings: {
                type: 'array',
                items: { type: 'string' },
                uniqueItems: true,
              },
              requireJSDocSpacing: { type: 'boolean' },
              enforceParamStyle: { type: 'boolean' },
            },
          },
        },
      },
    ],
    messages,
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const options = resolveOptions(context.options[0]);

    return {
      Program() {
        const comments = sourceCode.getAllComments();

        for (const comment of comments) {
          if (shouldSkipComment(comment.value, options)) {
            continue;
          }

          if (comment.type === 'Line') {
            checkLineComment(context, comment, options);

            continue;
          }

          if (comment.value.includes('\n')) {
            checkMultiLineBlock(context, comment, options);
          } else {
            checkSingleLineBlock(context, comment, options);
          }
        }
      },
    };
  },
};

export default rule;
