export {
  analyzeSource,
  codeFingerprint,
  hasVerdictIssues,
  isSuspicious,
  rewrapComment,
  type AnalyzeOptions,
  type CommentKind,
  type CommentReport,
  type IssueReport,
  type IssueTier,
  type ParagraphKind,
  type ParagraphReport,
} from './analyze.js';

export { DEFAULT_RULES } from './agent.js';

export {
  defineConfig,
  loadConfig,
  type AgentConfig,
  type AgentRunner,
  type AgentScope,
  type CommentsConfig,
  type HookConfig,
  type HookMode,
} from './config.js';

export { tokenize, wrapTokens } from './wrap.js';
