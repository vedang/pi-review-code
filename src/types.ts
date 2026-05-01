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
