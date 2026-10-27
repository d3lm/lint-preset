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
  allowInUnions?: boolean;
}

const UNION_OR_INTERSECTION_TYPES = new Set(['TSUnionType', 'TSIntersectionType']);

function isMultiLineBlock(comment: { type: string; value: string }): boolean {
  return comment.type === 'Block' && comment.value.includes('\n');
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
          allowInUnions: {
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
    const allowInUnions = options.allowInUnions ?? false;

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

      if (allowInUnions && UNION_OR_INTERSECTION_TYPES.has(type)) {
        return true;
      }

      return false;
    }

    /**
     * A comment before the leading `|` or `&` of a multiline union or intersection
     * type describes its first member, so it's treated like a comment at block start.
     */
    function isBeforeFirstTypeConstituent(comment: Comment): boolean {
      const tokenAfter = sourceCode.getTokenAfter(comment as unknown as Rule.Node);

      if (!tokenAfter || (tokenAfter.value !== '|' && tokenAfter.value !== '&')) {
        return false;
      }

      const node = sourceCode.getNodeByRangeIndex(tokenAfter.range[0]);

      return node !== null && UNION_OR_INTERSECTION_TYPES.has(node.type) && node.range?.[0] === tokenAfter.range[0];
    }

    function findEnclosingImport(index: number): Rule.Node | undefined {
      let current = (sourceCode.getNodeByRangeIndex(index) ?? undefined) as Rule.Node | undefined;

      while (current && current.type !== 'ImportDeclaration') {
        current = (current.parent ?? undefined) as Rule.Node | undefined;
      }

      return current;
    }

    /**
     * Imports must form a single block (see `no-blank-line-between-imports`),
     * so a comment between two imports can't be preceded by a blank line.
     */
    function isBetweenImports(comment: Comment): boolean {
      const tokenBefore = sourceCode.getTokenBefore(comment as unknown as Rule.Node);
      const tokenAfter = sourceCode.getTokenAfter(comment as unknown as Rule.Node);

      if (!tokenBefore || !tokenAfter) {
        return false;
      }

      const importBefore = findEnclosingImport(tokenBefore.range[0]);
      const importAfter = findEnclosingImport(tokenAfter.range[0]);

      return importBefore !== undefined && importAfter !== undefined && importBefore !== importAfter;
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

    function isExempt(comment: Comment): boolean {
      return (
        isAtBlockStart(comment) ||
        isBeforeFirstTypeConstituent(comment) ||
        isChainedCallContext(comment) ||
        isCommentAllowedByEnclosure(comment) ||
        isBetweenImports(comment)
      );
    }

    /**
     * Stacked multi-line block comments must always be separated by a blank line,
     * even where the exemptions would let a comment hug the preceding line.
     */
    function followsMultiLineBlock(comment: Comment): boolean {
      if (!isMultiLineBlock(comment)) {
        return false;
      }

      const previous = sourceCode.getTokenBefore(comment as unknown as Rule.Node, { includeComments: true });

      return previous !== null && isMultiLineBlock(previous);
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

          if (!followsMultiLineBlock(comment) && isExempt(comment)) {
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

          /**
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
