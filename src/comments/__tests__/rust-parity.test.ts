import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { analyzeSource, isJavaScriptCode, type AnalyzeOptions } from '../analyze.js';
import { randomComments } from './helpers/random-comments.js';
import {
  comparableReport,
  isLineForm,
  renderComment,
  RUST_FORMS,
  rustOptionsFor,
  shiftFor,
} from './helpers/rust-forms.js';

/**
 * The languages differ in the check for whether a paragraph is code, since each one reads code with
 * its own parser, and in a code span that continues on the next line, which only JavaScript joins
 * (see `rust.test.ts`). With the JavaScript check in place of the Rust one, and without such code
 * spans, every other part of the analysis has to agree on every comment, which these tests compare.
 */
vi.mock('../rust.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../rust.js')>();

  return { ...original, isRustCode: (text: string) => isJavaScriptCode(text) };
});

const options: AnalyzeOptions = { width: 80, tabWidth: 2, tolerance: 0, avoidSentenceOrphans: true, style: true };

// an odd number of backtick runs on a line starts or ends a code span that continues on another line
function hasCodeSpanAcrossLines(lines: readonly string[]): boolean {
  return lines.some((line) => (line.match(/`+/g)?.length ?? 0) % 2 === 1);
}

describe('Rust comments with the same code check as JavaScript', () => {
  it('report the same paragraphs, issues, and rewraps as a JSDoc comment with the same text in every form', () => {
    // words that read as code at the start or end of a line, and delimiters that pair up across lines
    const { random, between, commentBody } = randomComments(104_729, {
      tags: false,
      extra: ['thus;', 'f();', '(one)', 'b)', ')', '{', '}', '>=', '<!--', '--', '='],
    });

    let checked = 0;

    for (let run = 0; run < 3000; run += 1) {
      const body = commentBody();
      const width = between(16, 100);
      const hard = random() < 0.5;

      const settings: AnalyzeOptions = {
        ...options,
        width,
        maxWidth: hard ? width + between(0, 40) : undefined,
        tolerance: hard ? 0 : between(0, 2),
        singleLineWidth: random() < 0.5 ? width + between(0, 40) : undefined,
        tabWidth: between(1, 8),
        avoidSentenceOrphans: random() < 0.7,
        style: random() < 0.5,
      };

      if (hasCodeSpanAcrossLines(body.lines)) {
        continue;
      }

      const [jsdoc] = analyzeSource(renderComment(body, 'jsdoc'), 'file.ts', settings);

      for (const form of RUST_FORMS) {
        const source = renderComment(body, form);
        const reports = analyzeSource(source, 'lib.rs', rustOptionsFor(settings, form));
        const context = `${form} ${JSON.stringify(settings)}\n${renderComment(body, 'jsdoc')}\n${source}`;

        expect(
          reports.map((report) => report.kind),
          context,
        ).toEqual([form]);

        expect(comparableReport(reports[0], body), context).toEqual(comparableReport(jsdoc, body, shiftFor(form)));

        checked += 1;
      }
    }

    // most comments have no code span across lines
    expect(checked).toBeGreaterThan(2000 * RUST_FORMS.length);
  }, 120_000);

  it('report the same as the JSDoc comments of this repository, written in every Rust form', () => {
    const root = path.resolve(import.meta.dirname, '../../..');

    const files = readdirSync(path.join(root, 'src'), { recursive: true, encoding: 'utf8' }).filter((file) => {
      return file.endsWith('.ts') && !file.includes('fixtures');
    });

    let checked = 0;

    for (const file of files) {
      const source = readFileSync(path.join(root, 'src', file), 'utf8');

      for (const settings of [options, { ...options, width: 100, maxWidth: 120, singleLineWidth: 120 }]) {
        for (const jsdoc of analyzeSource(source, file, settings)) {
          const lines = jsdoc.text.split('\n');
          const body = lines.slice(1, -1).map((line) => /^(\s*) \*(?: (.*))?$/.exec(line));

          /**
           * Only comments that each Rust form can hold line for line count, without JSDoc tags,
           * which Rust doesn't have, and without a code span that continues on the next line,
           * which an odd number of backticks on a line starts or ends.
           */
          if (
            jsdoc.kind !== 'jsdoc' ||
            lines[0].trim() !== '/**' ||
            body.some((match) => !match || match[1] !== jsdoc.indent || /^@\w/.test(match.at(2) ?? '')) ||
            hasCodeSpanAcrossLines(body.map((match) => match?.at(2) ?? ''))
          ) {
            continue;
          }

          const comment = { indent: jsdoc.indent, lines: body.map((match) => match?.at(2) ?? '') };

          for (const form of RUST_FORMS) {
            // rust block comments nest, so a `/*` in the text, even in a code span, opens another comment
            if (!isLineForm(form) && comment.lines.some((line) => line.includes('/*'))) {
              continue;
            }

            const rust = renderComment(comment, form);
            const reports = analyzeSource(rust, 'lib.rs', rustOptionsFor(settings, form));
            const context = `${file}:${jsdoc.startLine} ${form}\n${rust}`;

            expect(
              reports.map((report) => report.kind),
              context,
            ).toEqual([form]);

            const shift = shiftFor(form);

            expect(comparableReport(reports[0], comment), context).toEqual(
              comparableReport(jsdoc, comment, { ...shift, line: shift.line - (jsdoc.startLine - 1) }),
            );

            checked += 1;
          }
        }
      }
    }

    // the sources hold hundreds of such comments
    expect(checked).toBeGreaterThan(1000);
  });
});
