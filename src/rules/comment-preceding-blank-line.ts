import type { Rule } from 'eslint';

interface Comment {
  type: string;
  value: string;
  range?: [number, number];
  loc?: Rule.Node['loc'];
}

interface RuleOptions {
  allowInObjects?: boolean;
  allowInArrays?: boolean;
  allowInInterfaces?: boolean;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'layout',
    docs: {
      description:
        'Require a blank line before comments, with an exception for comments inside chained member-call expressions.',
    },
    fixable: 'whitespace',
    schema: [
      {
        type: 'object',
        properties: {
          allowInObjects: {
            type: 'boolean',
          },
          allowInArrays: {
            type: 'boolean',
          },
          allowInInterfaces: {
            type: 'boolean',
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingBlankLine: 'Expected blank line before comment.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    const options = (context.options[0] as RuleOptions | undefined) ?? {};

    const allowInObjects = options.allowInObjects ?? false;
    const allowInArrays = options.allowInArrays ?? false;
    const allowInInterfaces = options.allowInInterfaces ?? false;

    function isChainedCallContext(comment: Comment): boolean {
      if (!comment.range) {
        return false;
      }

      let current = (sourceCode.getNodeByRangeIndex(comment.range[0]) ?? undefined) as Rule.Node | undefined;

      while (current?.type === 'CallExpression' || current?.type === 'MemberExpression') {
        if (current.type === 'CallExpression' && current.callee.type === 'MemberExpression') {
          return true;
        }

        current = current.parent as Rule.Node | undefined;
      }

      return false;
    }

    function isCommentAllowedByEnclosure(comment: Comment): boolean {
      if (!comment.range) {
        return false;
      }

      const node = sourceCode.getNodeByRangeIndex(comment.range[0]) as Rule.Node | null;

      if (!node) {
        return false;
      }

      // TS-specific node types aren't part of the ESTree `Rule.Node` union
      const type = node.type as string;

      if (allowInObjects && (type === 'ObjectExpression' || type === 'ObjectPattern')) {
        return true;
      }

      if (allowInArrays && (type === 'ArrayExpression' || type === 'ArrayPattern')) {
        return true;
      }

      if (allowInInterfaces && (type === 'TSInterfaceBody' || type === 'TSTypeLiteral')) {
        return true;
      }

      return false;
    }

    function isAtBlockStart(comment: Comment): boolean {
      const tokenBefore = sourceCode.getTokenBefore(comment as unknown as Rule.Node, {
        includeComments: false,
      });

      if (!tokenBefore) {
        return true;
      }

      return ['{', '(', '['].includes(tokenBefore.value);
    }

    return {
      Program() {
        const comments = sourceCode.getAllComments();

        for (const comment of comments) {
          if (!comment.loc || !comment.range) {
            continue;
          }

          const commentLine = comment.loc.start.line;

          if (commentLine <= 1) {
            continue;
          }

          if (isAtBlockStart(comment)) {
            continue;
          }

          if (isChainedCallContext(comment)) {
            continue;
          }

          if (isCommentAllowedByEnclosure(comment)) {
            continue;
          }

          const tokenBefore = sourceCode.getTokenBefore(comment as unknown as Rule.Node, {
            includeComments: true,
          });

          if (!tokenBefore?.loc) {
            continue;
          }

          const linesBetween = commentLine - tokenBefore.loc.end.line;

          if (linesBetween >= 2) {
            continue;
          }

          if (linesBetween === 0) {
            continue;
          }

          /*
           * Insert the blank line before the comment's leading indentation so the
           * comment keeps its position instead of being dedented.
           */
          const commentStart = comment.range[0];
          const lineStart = sourceCode.getText().lastIndexOf('\n', commentStart - 1) + 1;

          context.report({
            loc: comment.loc,
            messageId: 'missingBlankLine',
            fix(fixer) {
              return fixer.insertTextBeforeRange([lineStart, lineStart], '\n');
            },
          });
        }
      },
    };
  },
};

export default rule;
