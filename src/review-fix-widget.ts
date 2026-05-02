import type { AddReviewCommentReference, ReviewComment } from "./types.js";

export type ReviewFixWidgetFindingInput = {
  id: string;
  priority: ReviewComment["priority"];
  comment: string;
  references: AddReviewCommentReference[];
  fixed: boolean;
};

export type ReviewFixWidgetConfig = {
  title: string;
  helpText: string;
  reviewRunId?: string;
  targetHint?: string;
  completedAt?: number;
  findings: ReviewFixWidgetFindingInput[];
  initialSelectedFindingIds?: string[];
  initialFixContext?: string;
};

export type ReviewFixWidgetResult =
  | {
      submitted: true;
      reviewRunId: string;
      findingIds: string[];
      fixContext?: string;
    }
  | { submitted: false };

export type ReviewFixWidgetSelectionInput = {
  reviewRunId?: string;
  findings: ReviewFixWidgetFindingInput[];
  selectedFindingIds: string[];
  fixContext?: string;
};

export type NormalizedReviewFixWidgetSelection =
  | {
      ok: true;
      reviewRunId: string;
      findingIds: string[];
      fixContext?: string;
    }
  | {
      ok: false;
      error: string;
    };

export function normalizeReviewFixWidgetSelection(
  input: ReviewFixWidgetSelectionInput,
): NormalizedReviewFixWidgetSelection {
  const normalizedFindings: ReviewFixWidgetFindingInput[] = [];
  const findingById = new Map<string, ReviewFixWidgetFindingInput>();

  for (const finding of input.findings) {
    const normalizedFindingId = finding.id.trim();
    if (normalizedFindingId.length === 0) {
      return {
        ok: false,
        error: "Review-fix widget data has a blank finding id.",
      };
    }

    if (findingById.has(normalizedFindingId)) {
      return {
        ok: false,
        error: `Review-fix widget data has duplicate finding id: ${normalizedFindingId}.`,
      };
    }

    const normalizedFinding: ReviewFixWidgetFindingInput = {
      ...finding,
      id: normalizedFindingId,
    };

    normalizedFindings.push(normalizedFinding);
    findingById.set(normalizedFindingId, normalizedFinding);
  }

  const selectableFindingCount = normalizedFindings.filter(
    (finding) => !finding.fixed,
  ).length;
  if (selectableFindingCount === 0) {
    return { ok: false, error: "No review findings are available to fix." };
  }

  const normalizedReviewRunId = input.reviewRunId?.trim();
  if (
    normalizedReviewRunId === undefined ||
    normalizedReviewRunId.length === 0
  ) {
    return { ok: false, error: "No review run is available to fix." };
  }

  for (const selectedId of input.selectedFindingIds) {
    const normalizedSelectedId = selectedId.trim();
    const selectedFinding = findingById.get(normalizedSelectedId);

    if (selectedFinding === undefined) {
      return {
        ok: false,
        error: `Selected finding is no longer available: ${normalizedSelectedId}.`,
      };
    }

    if (selectedFinding.fixed) {
      return {
        ok: false,
        error: `Selected finding is already fixed: ${normalizedSelectedId}.`,
      };
    }
  }

  const selectedIds = new Set(
    input.selectedFindingIds
      .map((selectedId) => selectedId.trim())
      .filter((selectedId) => selectedId.length > 0),
  );
  const normalizedSelectedFindingIds: string[] = [];
  for (const finding of normalizedFindings) {
    if (finding.fixed) {
      continue;
    }

    if (selectedIds.has(finding.id)) {
      normalizedSelectedFindingIds.push(finding.id);
    }
  }

  if (normalizedSelectedFindingIds.length === 0) {
    return { ok: false, error: "Select at least one finding to fix." };
  }

  const normalizedFixContext = input.fixContext?.trim() ?? "";

  if (normalizedFixContext.length === 0) {
    return {
      ok: true,
      reviewRunId: normalizedReviewRunId,
      findingIds: normalizedSelectedFindingIds,
    };
  }

  return {
    ok: true,
    reviewRunId: normalizedReviewRunId,
    findingIds: normalizedSelectedFindingIds,
    fixContext: normalizedFixContext,
  };
}
