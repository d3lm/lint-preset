import type { AST, Rule } from 'eslint';

interface Comment {
  type: string;
  value: string;
  range?: [number, number];
  loc?: Rule.Node['loc'];
}

type TokenOrComment = AST.Token | Comment;

const rule: Rule.RuleModule = {
  meta: {
    type: 'layout',
    docs: {
      description: 'Disallow blank lines between import declarations so all imports form a single block.',
    },
    fixable: 'whitespace',
    schema: [],
    messages: {
      blankLineBetweenImports: 'Imports must form a single block without blank lines.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    function checkGap(left: TokenOrComment, right: TokenOrComment) {
      if (!left.loc || !right.loc || !left.range || !right.range) {
        return;
      }

      if (right.loc.start.line - left.loc.end.line < 2) {
        return;
      }

      const gapRange: [number, number] = [left.range[1], right.range[0]];
      const gapText = sourceCode.getText().slice(gapRange[0], gapRange[1]);
      const indentation = gapText.slice(gapText.lastIndexOf('\n') + 1);

      context.report({
        loc: right.loc,
        messageId: 'blankLineBetweenImports',
        fix(fixer) {
          return fixer.replaceTextRange(gapRange, `\n${indentation}`);
        },
      });
    }

    return {
      Program(program) {
        const body = program.body;

        for (let index = 1; index < body.length; index++) {
          const previous = body[index - 1];
          const current = body[index];

          if (previous.type !== 'ImportDeclaration' || current.type !== 'ImportDeclaration') {
            continue;
          }

          const lastToken = sourceCode.getLastToken(previous);
          const firstToken = sourceCode.getFirstToken(current);

          if (!lastToken || !firstToken) {
            continue;
          }

          const tokens: TokenOrComment[] = [
            lastToken,
            ...sourceCode.getTokensBetween(previous, current, { includeComments: true }),
            firstToken,
          ];

          for (let tokenIndex = 1; tokenIndex < tokens.length; tokenIndex++) {
            checkGap(tokens[tokenIndex - 1], tokens[tokenIndex]);
          }
        }
      },
    };
  },
};

export default rule;
