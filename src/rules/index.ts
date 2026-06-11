import type { ESLint } from 'eslint';

import blockScopedCase from './block-scoped-case.js';
import commentPrecedingBlankLine from './comment-preceding-blank-line.js';
import commentSyntax from './comment-syntax.js';
import newlineAroundMultiline from './newline-around-multiline.js';
import noImplicitObjectReturn from './no-implicit-object-return.js';

export const customRules: ESLint.Plugin = {
  meta: {
    name: '@d3lm/lint-preset-rules',
    version: '0.1.0',
  },
  rules: {
    'newline-around-multiline': newlineAroundMultiline,
    'block-scoped-case': blockScopedCase,
    'comment-syntax': commentSyntax,
    'comment-preceding-blank-line': commentPrecedingBlankLine,
    'no-implicit-object-return': noImplicitObjectReturn,
  },
};

export default customRules;
