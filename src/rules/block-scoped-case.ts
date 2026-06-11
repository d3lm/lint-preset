import type { Rule } from 'eslint';

const leadingWhitespace = (line: string) => /^[ \t]*/.exec(line)?.[0].length ?? 0;

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require case clauses to use block scope (braces).',
    },
    fixable: 'code',
    schema: [],
    messages: {
      missingBlock: 'Case clause should be wrapped in a block (braces).',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      SwitchCase(node) {
        const { consequent } = node;

        if (consequent.length === 0) {
          return;
        }

        // already wrapped in a single BlockStatement
        if (consequent.length === 1 && consequent[0].type === 'BlockStatement') {
          return;
        }

        context.report({
          node,
          messageId: 'missingBlock',
          fix(fixer) {
            const caseKeyword = sourceCode.getFirstToken(node);

            if (!caseKeyword) {
              return [];
            }

            const colonToken = sourceCode.getTokenAfter(
              node.test ? (node.test as Rule.Node) : caseKeyword,
              (token) => token.value === ':',
            );

            if (!colonToken) {
              return [];
            }

            const lastConsequent = consequent.at(-1);
            const lastToken = sourceCode.getLastToken(lastConsequent as Rule.Node);

            if (!lastToken) {
              return [];
            }

            const caseIndent = ' '.repeat(caseKeyword.loc.start.column);
            const bodyIndent = caseIndent + '  ';

            const text = sourceCode.getText();
            const bodyText = text.slice(colonToken.range[1], lastToken.range[1]);

            const lines = bodyText.split('\n');

            /**
             * Lines after the colon line keep their relative nesting; we only shift
             * them so the shallowest one lands at the desired body indent.
             */
            const restLines = lines.slice(1);
            const restIndents = restLines.filter((line) => line.trim() !== '').map((line) => leadingWhitespace(line));
            const indentDelta = restIndents.length > 0 ? bodyIndent.length - Math.min(...restIndents) : 0;

            const bodyLines: string[] = [];

            // code sharing the colon line (e.g. `case 1: foo()`) must be preserved
            const firstLine = lines[0].trim();

            if (firstLine) {
              bodyLines.push(bodyIndent + firstLine);
            }

            for (const line of restLines) {
              if (line.trim() === '') {
                bodyLines.push('');
                continue;
              }

              const lead = leadingWhitespace(line);
              const newIndent = Math.max(0, lead + indentDelta);

              bodyLines.push(' '.repeat(newIndent) + line.slice(lead));
            }

            while (bodyLines.length > 0 && bodyLines[0] === '') {
              bodyLines.shift();
            }

            while (bodyLines.length > 0 && bodyLines.at(-1) === '') {
              bodyLines.pop();
            }

            const result = ` {\n${bodyLines.join('\n')}\n${caseIndent}}`;

            return fixer.replaceTextRange([colonToken.range[1], lastToken.range[1]], result);
          },
        });
      },
    };
  },
};

export default rule;
