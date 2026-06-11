import type { Rule } from 'eslint';

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow returning an object literal from an arrow function concise body (e.g. `() => ({})`); require a block body with an explicit return.',
    },
    fixable: 'code',
    schema: [],
    messages: {
      implicitObjectReturn:
        'Avoid returning an object literal directly from an arrow function; use a block body with an explicit return.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      ArrowFunctionExpression(node) {
        const body = node.body;

        // only concise bodies that resolve straight to an object literal
        if (!node.expression || body.type !== 'ObjectExpression') {
          return;
        }

        context.report({
          node: body,
          messageId: 'implicitObjectReturn',
          fix(fixer) {
            const arrowToken = sourceCode.getTokenBefore(body, (token) => token.value === '=>');

            // an object concise body is always parenthesized, otherwise it parses as a block
            const openParen = sourceCode.getTokenBefore(body);
            const closeParen = sourceCode.getTokenAfter(body);

            if (!arrowToken || openParen?.value !== '(' || closeParen?.value !== ')') {
              return null;
            }

            const objectText = sourceCode.getText(body);

            return fixer.replaceTextRange([arrowToken.range[1], closeParen.range[1]], ` { return ${objectText}; }`);
          },
        });
      },
    };
  },
};

export default rule;
