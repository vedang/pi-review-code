export type ReviewDiffAgainstTarget = {
  kind: "diff-against";
  ref: string;
  targetHint: string;
};

export type ReviewPromptTarget = {
  kind: "prompt";
  prompt: string;
  targetHint: string;
};

export type ReviewPrTarget = {
  kind: "pr";
  selector: string;
  targetHint: string;
};

export type ReviewTarget =
  | ReviewDiffAgainstTarget
  | ReviewPromptTarget
  | ReviewPrTarget;

export type ReviewCommand = {
  kind: "review";
  target: ReviewTarget;
};

export type ReviewFixLatestSelector = {
  kind: "latest";
};

export type ReviewFixRunIdSelector = {
  kind: "run-id";
  runId: string;
};

export type ReviewFixSelector =
  | ReviewFixLatestSelector
  | ReviewFixRunIdSelector;

export type ReviewFixCommand = {
  kind: "review-fix";
  selector: ReviewFixSelector;
};

export const REVIEW_STATE_VERSION = 1 as const;
export const REVIEW_STATE_ENTRY_TYPE = "pi-review-code:state";
export const REVIEW_COMMENT_ENTRY_TYPE = "pi-review-code:comment";

export type ReviewStateKind = "review" | "fix" | null;

export interface ReviewStateBase {
  version: typeof REVIEW_STATE_VERSION;
  activeKind: ReviewStateKind;
}

export interface ReviewActiveRunInfo {
  runId: string;
  originLeafId: string;
  targetHint: string;
  reviewPrompt: string;
  originModelProvider: string;
  originModelId: string;
  originThinkingLevel: string;
}

export interface ReviewFixRunInfo extends ReviewActiveRunInfo {
  sourceReviewRunId: string;
  commentIds: string[];
}

export interface ReviewActiveState
  extends ReviewStateBase,
    ReviewActiveRunInfo {
  activeKind: "review";
}

export interface ReviewInactiveState extends ReviewStateBase {
  activeKind: null;
}

export interface ReviewFixState extends ReviewStateBase, ReviewFixRunInfo {
  activeKind: "fix";
}

export type ReviewState =
  | ReviewInactiveState
  | ReviewActiveState
  | ReviewFixState;

export type ReviewStateStart = ReviewActiveRunInfo;
export type ReviewFixStateStart = ReviewFixRunInfo;

export type ReviewCommentPriority = "P0" | "P1" | "P2" | "P3";

export const REVIEW_COMMENT_PRIORITIES: readonly ReviewCommentPriority[] = [
  "P0",
  "P1",
  "P2",
  "P3",
] as const;

export interface AddReviewCommentReference {
  filePath: string;
  startLine: number;
  endLine?: number;
}

export interface AddReviewCommentInput {
  priority: ReviewCommentPriority;
  comment: string;
  references?: AddReviewCommentReference[];
}

export interface ReviewComment {
  version: typeof REVIEW_STATE_VERSION;
  id: string;
  runId: string;
  priority: ReviewCommentPriority;
  comment: string;
  references: AddReviewCommentReference[];
  createdAt: number;
  targetHint: string;
}

export type CommandInvocation = {
  command: string;
  args: string[];
};

export type ReviewTargetCommandHint = CommandInvocation & {
  label: string;
};

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type ExecCommand = (
  command: string,
  args: string[],
) => Promise<ExecResult>;

export type GitHubPrSelector = {
  kind: "github";
  selector: string;
  owner?: string;
  repo?: string;
  number: number;
};

export type GitLabMrSelector = {
  kind: "gitlab";
  selector: string;
  host: string;
  projectPath: string;
  number: number;
};

export type ResolvedDiffAgainstTarget = {
  kind: "diff-against";
  ref: string;
  targetHint: string;
  files: string[];
  diffStat: string;
  commandHints: ReviewTargetCommandHint[];
};

export type ResolvedPromptTarget = {
  kind: "prompt";
  targetHint: string;
  prompt: string;
  commandHints: ReviewTargetCommandHint[];
};

export type ResolvedGitHubPrMetadata = {
  provider: "github";
  number: number;
  title: string;
  body: string;
  url: string;
  author: string;
  baseRefName: string;
  headRefName: string;
  files: string[];
  existingNotes: string[];
};

export type ResolvedGitLabMrMetadata = {
  provider: "gitlab";
  number: number;
  title: string;
  body: string;
  url: string;
  author: string;
  baseRefName: string;
  headRefName: string;
  files: string[];
  existingNotes: string[];
};

export type ResolvedPrTarget = {
  kind: "pr";
  targetHint: string;
  selector: string;
  files: string[];
  commandHints: ReviewTargetCommandHint[];
} & (ResolvedGitHubPrMetadata | ResolvedGitLabMrMetadata);

export type ResolvedReviewTarget =
  | ResolvedDiffAgainstTarget
  | ResolvedPromptTarget
  | ResolvedPrTarget;
