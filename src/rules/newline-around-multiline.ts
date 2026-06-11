import type { Rule } from 'eslint';

function isAlwaysPadded(node: Rule.Node) {
  /*
   * Class methods and static blocks always get blank lines between
   * siblings, even when single-line, so they never feel crammed together.
   */
  return node.type === 'MethodDefinition' || node.type === 'StaticBlock';
}

function isImportOrExport(node: Rule.Node) {
  /*
   * Imports and re-exports are grouped together with no blank lines between
   * them, so this rule ignores them entirely, both as a subject and as a
   * neighbor. Declared exports (export const/function/class) still pad like
   * regular code, since they contain real multiline bodies.
   */
  if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') {
    return true;
  }

  return node.type === 'ExportNamedDeclaration' && !node.declaration;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'layout',
    docs: {
      description:
        'Require blank lines around multiline statements, class methods, static blocks, and switch case bodies.',
    },
    fixable: 'whitespace',
    schema: [],
    messages: {
      missingBlankBefore: 'Expected blank line before this.',
      missingBlankAfter: 'Expected blank line after this.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    function checkBody(body: Rule.Node[], options: { alwaysPadMembers?: boolean } = {}) {
      for (let index = 0; index < body.length; index++) {
        const node = body[index];

        if (!node.loc || isImportOrExport(node)) {
          continue;
        }

        const isMultiline = node.loc.start.line !== node.loc.end.line;
        const forceByKind = options.alwaysPadMembers === true && isAlwaysPadded(node);
        const needsPadding = isMultiline || forceByKind;

        if (!needsPadding) {
          continue;
        }

        if (index > 0) {
          const previous = body[index - 1];

          if (previous.loc && !isImportOrExport(previous)) {
            const linesBetween = node.loc.start.line - previous.loc.end.line;

            if (linesBetween < 2) {
              context.report({
                node,
                messageId: 'missingBlankBefore',
                fix(fixer) {
                  const previousToken = sourceCode.getLastToken(previous);

                  if (!previousToken) {
                    return null;
                  }

                  return fixer.insertTextAfter(previousToken, '\n');
                },
              });
            }
          }
        }

        if (index < body.length - 1) {
          const next = body[index + 1];

          if (next.loc && !isImportOrExport(next)) {
            const linesBetween = next.loc.start.line - node.loc.end.line;

            if (linesBetween < 2) {
              context.report({
                node,
                messageId: 'missingBlankAfter',
                fix(fixer) {
                  const lastToken = sourceCode.getLastToken(node);

                  if (!lastToken) {
                    return null;
                  }

                  return fixer.insertTextAfter(lastToken, '\n');
                },
              });
            }
          }
        }
      }
    }

    return {
      Program(node) {
        checkBody(node.body as Rule.Node[]);
      },
      BlockStatement(node) {
        checkBody(node.body as Rule.Node[]);
      },
      StaticBlock(node) {
        checkBody(node.body as Rule.Node[]);
      },
      SwitchCase(node) {
        checkBody(node.consequent as Rule.Node[]);
      },
      ClassBody(node) {
        checkBody(node.body as Rule.Node[], { alwaysPadMembers: true });
      },
    };
  },
};

export default rule;
