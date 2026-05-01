import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";

import {
  type FixBranchSummaryDetails,
  REVIEW_FIX_SUMMARY_ENTRY_TYPE,
  REVIEW_PROMPT_ENTRY_TYPE,
  REVIEW_SUMMARY_ENTRY_TYPE,
  type ReviewBranchSummaryDetails,
  type ReviewPromptMessageDetails,
} from "./flow.js";
import type { AddReviewCommentReference, ReviewComment } from "./types.js";

type ReviewMessageRenderer = Parameters<
  ExtensionAPI["registerMessageRenderer"]
>[1];

type Theme = Parameters<ReviewMessageRenderer>[2];

const PROMPT_PREVIEW_LINES = 8;
const SUMMARY_PREVIEW_COMMENTS = 4;
const COLLAPSED_COMMENT_MAX_CHARS = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (!isRecord(block) || block.type !== "text") {
        return "";
      }

      return typeof block.text === "string" ? block.text : "";
    })
    .join("");
}

function renderMessageBox(text: string, theme: Theme): Box {
  const box = new Box(1, 0, (segment: string) =>
    theme.bg("customMessageBg", segment),
  );
  box.addChild(new Text(text, 0, 0));
  return box;
}

function formatReference(reference: AddReviewCommentReference): string {
  if (
    reference.endLine !== undefined &&
    reference.endLine !== reference.startLine
  ) {
    return `${reference.filePath}:${reference.startLine}-${reference.endLine}`;
  }

  return `${reference.filePath}:${reference.startLine}`;
}

function compactCommentText(comment: string): string {
  const firstLine = comment.split(/\r?\n/, 1)[0]?.replace(/\s+/g, " ").trim();
  const normalized = firstLine ?? "";

  if (normalized.length <= COLLAPSED_COMMENT_MAX_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, COLLAPSED_COMMENT_MAX_CHARS - 1)}…`;
}

function formatComment(
  comment: ReviewComment,
  expanded: boolean,
  theme: Theme,
): string {
  const references =
    comment.references.length === 0
      ? ""
      : ` (${comment.references.map(formatReference).join(", ")})`;
  const commentText = expanded
    ? comment.comment
    : compactCommentText(comment.comment);

  return `${theme.fg("warning", comment.priority)} ${theme.fg("accent", comment.id)}${references}: ${commentText}`;
}

function previewText(text: string, lineCount: number, theme: Theme): string {
  const lines = text.split("\n");
  if (lines.length <= lineCount) {
    return text;
  }

  return [
    ...lines.slice(0, lineCount),
    theme.fg("dim", "… expand for full details"),
  ].join("\n");
}

function isPromptDetails(value: unknown): value is ReviewPromptMessageDetails {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.kind === "prompt" &&
    (value.mode === "review" || value.mode === "fix") &&
    typeof value.runId === "string" &&
    typeof value.targetHint === "string" &&
    typeof value.reviewPrompt === "string" &&
    typeof value.originModelProvider === "string" &&
    typeof value.originModelId === "string" &&
    typeof value.originThinkingLevel === "string"
  );
}

function isReviewSummaryDetails(
  value: unknown,
): value is ReviewBranchSummaryDetails {
  return (
    isRecord(value) &&
    value.kind === "review" &&
    typeof value.runId === "string" &&
    typeof value.targetHint === "string" &&
    typeof value.reviewPrompt === "string" &&
    typeof value.completedAt === "number" &&
    Array.isArray(value.comments)
  );
}

function isFixSummaryDetails(value: unknown): value is FixBranchSummaryDetails {
  return (
    isRecord(value) &&
    value.kind === "fix" &&
    typeof value.runId === "string" &&
    typeof value.sourceReviewRunId === "string" &&
    typeof value.targetHint === "string" &&
    typeof value.fixPrompt === "string" &&
    typeof value.completedAt === "number" &&
    Array.isArray(value.comments) &&
    typeof value.agentSummary === "string"
  );
}

function formatFindingCount(count: number): string {
  return count === 1 ? "1 finding" : `${count} findings`;
}

function formatComments(
  comments: ReviewComment[],
  expanded: boolean,
  theme: Theme,
): string[] {
  if (comments.length === 0) {
    return [theme.fg("success", "No findings recorded.")];
  }

  const visibleComments = expanded
    ? comments
    : comments.slice(0, SUMMARY_PREVIEW_COMMENTS);
  const lines = visibleComments.map(
    (comment) => `- ${formatComment(comment, expanded, theme)}`,
  );

  if (!expanded && comments.length > visibleComments.length) {
    lines.push(
      theme.fg(
        "dim",
        `… ${comments.length - visibleComments.length} more; expand for all findings`,
      ),
    );
  }

  return lines;
}

export function renderReviewPromptMessage(
  message: Parameters<ReviewMessageRenderer>[0],
  { expanded }: Parameters<ReviewMessageRenderer>[1],
  theme: Theme,
): ReturnType<ReviewMessageRenderer> {
  const details = message.details;
  if (!isPromptDetails(details)) {
    return renderMessageBox(readTextContent(message.content), theme);
  }

  const title =
    details.mode === "review" ? "Review prompt" : "Review-fix prompt";
  const prompt = expanded
    ? details.reviewPrompt
    : previewText(details.reviewPrompt, PROMPT_PREVIEW_LINES, theme);
  const lines = [
    `${theme.fg("accent", theme.bold(title))} ${theme.fg("muted", details.runId)}`,
    `Target: ${details.targetHint}`,
  ];

  if (expanded) {
    lines.push(
      `Model: ${details.originModelProvider}/${details.originModelId}`,
      `Thinking: ${details.originThinkingLevel}`,
    );

    if (details.mode === "fix" && details.sourceReviewRunId !== undefined) {
      lines.push(`Source review: ${details.sourceReviewRunId}`);
    }
  }

  lines.push("", prompt);
  return renderMessageBox(lines.join("\n"), theme);
}

export function renderReviewSummaryMessage(
  message: Parameters<ReviewMessageRenderer>[0],
  { expanded }: Parameters<ReviewMessageRenderer>[1],
  theme: Theme,
): ReturnType<ReviewMessageRenderer> {
  const details = message.details;
  if (!isReviewSummaryDetails(details)) {
    return renderMessageBox(readTextContent(message.content), theme);
  }

  const lines = [
    `${theme.fg("success", theme.bold("Review"))} ${theme.fg("muted", details.runId)} — ${formatFindingCount(details.comments.length)}`,
    `Target: ${details.targetHint}`,
    "",
    ...formatComments(details.comments, expanded, theme),
  ];

  if (expanded) {
    lines.push("", theme.fg("dim", "Prompt:"), details.reviewPrompt);
  }

  return renderMessageBox(lines.join("\n"), theme);
}

export function renderReviewFixSummaryMessage(
  message: Parameters<ReviewMessageRenderer>[0],
  { expanded }: Parameters<ReviewMessageRenderer>[1],
  theme: Theme,
): ReturnType<ReviewMessageRenderer> {
  const details = message.details;
  if (!isFixSummaryDetails(details)) {
    return renderMessageBox(readTextContent(message.content), theme);
  }

  const lines = [
    `${theme.fg("success", theme.bold("Review-fix"))} ${theme.fg("muted", details.runId)} — ${formatFindingCount(details.comments.length)}`,
    `Source review: ${details.sourceReviewRunId}`,
    `Target: ${details.targetHint}`,
    "",
    ...formatComments(details.comments, expanded, theme),
  ];

  if (expanded) {
    lines.push(
      "",
      theme.fg("dim", "Agent summary:"),
      details.agentSummary || "No agent summary captured.",
    );
  }

  return renderMessageBox(lines.join("\n"), theme);
}

export function registerReviewMessageRenderers(
  pi: Pick<ExtensionAPI, "registerMessageRenderer">,
): void {
  pi.registerMessageRenderer(
    REVIEW_PROMPT_ENTRY_TYPE,
    renderReviewPromptMessage,
  );
  pi.registerMessageRenderer(
    REVIEW_SUMMARY_ENTRY_TYPE,
    renderReviewSummaryMessage,
  );
  pi.registerMessageRenderer(
    REVIEW_FIX_SUMMARY_ENTRY_TYPE,
    renderReviewFixSummaryMessage,
  );
}
