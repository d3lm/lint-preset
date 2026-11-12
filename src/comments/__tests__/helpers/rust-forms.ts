import type { AnalyzeOptions, CommentReport } from '../../analyze.js';
import type { RandomCommentBody } from './random-comments.js';

export type RustForm = 'outer-line-doc' | 'inner-line-doc' | 'outer-block-doc' | 'inner-block-doc' | 'block';

export const RUST_FORMS: readonly RustForm[] = [
  'outer-line-doc',
  'inner-line-doc',
  'outer-block-doc',
  'inner-block-doc',
  'block',
];

const LINE_MARKERS: Partial<Record<RustForm, string>> = { 'outer-line-doc': '///', 'inner-line-doc': '//!' };

const BLOCK_OPENERS: Partial<Record<RustForm | 'jsdoc', string>> = {
  jsdoc: '/**',
  'outer-block-doc': '/**',
  'inner-block-doc': '/*!',
  block: '/*',
};

export function isLineForm(form: RustForm): boolean {
  return form in LINE_MARKERS;
}

/**
 * Writes the lines of a comment body as a JSDoc comment or as one of the Rust comment forms.
 */
export function renderComment(body: RandomCommentBody, form: RustForm | 'jsdoc'): string {
  const marker = form === 'jsdoc' ? undefined : LINE_MARKERS[form];
  const { indent, lines } = body;

  if (marker) {
    return `${lines.map((line) => `${indent}${marker}${line ? ` ${line}` : ''}`).join('\n')}\n`;
  }

  return `${indent}${BLOCK_OPENERS[form]}\n${lines.map((line) => `${indent} *${line ? ` ${line}` : ''}`).join('\n')}\n${indent} */\n`;
}

/**
 * A line doc comment has no opening line, so its lines come one earlier than those of a block
 * comment, and its prefix, like `/// `, is one column longer than ` * `. Widening every width
 * by that column leaves the same room for the text.
 */
export function rustOptionsFor(settings: AnalyzeOptions, form: RustForm): AnalyzeOptions {
  const shift = isLineForm(form) ? 1 : 0;

  return {
    ...settings,
    width: settings.width + shift,
    maxWidth: settings.maxWidth === undefined ? undefined : settings.maxWidth + shift,
    singleLineWidth: settings.singleLineWidth === undefined ? undefined : settings.singleLineWidth + shift,
  };
}

/**
 * Describes a report so that a JSDoc comment and a Rust comment with the same text compare equal,
 * after moving the lines and columns of the JSDoc comment by `shift`.
 */
export function comparableReport(
  report: CommentReport,
  body: RandomCommentBody,
  shift?: { readonly line: number; readonly column: number },
) {
  const { line: lineShift = 0, column: columnShift = 0 } = shift ?? {};

  const withoutPrefix = (line: string): string => {
    for (const marker of [' *', '///', '//!']) {
      if (line.startsWith(`${body.indent}${marker}`)) {
        return `${body.indent}<prefix>${line.slice(body.indent.length + marker.length)}`;
      }
    }

    return line;
  };

  // the lines of the text, without the opening and closing lines of a block comment
  const opened = report.text.split('\n')[0].trim().startsWith('/*');
  const lengths = opened ? report.lengths.slice(1, -1) : report.lengths;

  return {
    lengths: lengths.map((length) => length + columnShift),
    paragraphs: report.paragraphs.map((paragraph) => {
      return {
        kind: paragraph.kind,
        reason: paragraph.reason,
        reflowable: paragraph.reflowable,
        startLine: paragraph.startLine + lineShift,
        endLine: paragraph.endLine + lineShift,
        issues: paragraph.issues.map((issue) => {
          return `${issue.line + lineShift}:${issue.type}:${issue.tier}:${issue.length + columnShift}`;
        }),
        suggestion: paragraph.suggestion?.map((line) => withoutPrefix(line)) ?? null,
      };
    }),
  };
}

/**
 * Returns how to move the lines and columns of a JSDoc report to compare it with a
 * report of `form`.
 */
export function shiftFor(form: RustForm): { readonly line: number; readonly column: number } {
  return isLineForm(form) ? { line: -1, column: 1 } : { line: 0, column: 0 };
}
