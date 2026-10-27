import type { Rule } from 'eslint';

// type-only wrappers that leave the ternary as the runtime receiver, e.g. `(a ? b : c)!.push()`
const TYPE_WRAPPERS = new Set(['TSNonNullExpression', 'TSAsExpression', 'TSSatisfiesExpression', 'TSTypeAssertion']);

interface MaybeWrapped {
  type: string;
  expression?: MaybeWrapped;
}

function unwrapTypeWrappers(node: MaybeWrapped): MaybeWrapped {
  let current = node;

  while (TYPE_WRAPPERS.has(current.type) && current.expression) {
    current = current.expression;
  }

  return current;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow calling a method or accessing a property on a ternary (e.g. `(a ? b : c).push(x)`); assign the ternary to a named variable first.',
    },
    schema: [],
    messages: {
      memberAccessOnTernary:
        'Avoid accessing a member on a ternary; assign the ternary to a named variable first, then use the variable.',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        const receiver = unwrapTypeWrappers(node.object as MaybeWrapped);

        if (receiver.type !== 'ConditionalExpression') {
          return;
        }

        context.report({
          node,
          messageId: 'memberAccessOnTernary',
        });
      },
    };
  },
};

export default rule;
