import type {
  ExtensionCommandContext,
  Theme,
} from "@mariozechner/pi-coding-agent";
import {
  type Component,
  Editor,
  type Focusable,
  Key,
  type TUI,
  matchesKey,
} from "@mariozechner/pi-tui";

import type { AddReviewCommentReference, ReviewComment } from "./types.js";
import {
  type SubmitCancelAction,
  type WidgetLineAppender,
  createWidgetEditorTheme,
  createWidgetRenderHelpers,
  handleSubmitCancelActionInput,
  nextItem,
  renderSubmitCancelAction,
} from "./widget-utils.js";

export type ReviewFixWidgetFindingInput = {
  id: string;
  priority: ReviewComment["priority"];
  comment: string;
  references: AddReviewCommentReference[];
  fixed: boolean;
  reviewRunId?: string;
  targetHint?: string;
  completedAt?: number;
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

export type ReviewFixWidgetComponentOptions = {
  tui: TUI;
  theme: Theme;
  config: ReviewFixWidgetConfig;
  done: (result: ReviewFixWidgetResult) => void;
};

type ActiveField = "findings" | "context" | "actions";

const ACTIVE_FIELDS: ActiveField[] = ["findings", "context", "actions"];
const REVIEW_FIX_CONTEXT_LABEL =
  "additional context for the fix loop (optional)";
const REVIEW_FIX_KEY_HINT =
  "Up/Down move • Space toggle • a select all open • Tab/Shift+Tab switch area • Enter/Ctrl+S submit • Alt+Enter newline • Esc cancel";
const FINDING_SELECTION_KEY_SEPARATOR = "\u001f";

function buildFindingSelectionKey(
  reviewRunId: string,
  findingId: string,
): string {
  return `${reviewRunId}${FINDING_SELECTION_KEY_SEPARATOR}${findingId}`;
}

function parseFindingSelectionKey(
  rawKey: string,
): { reviewRunId: string; id: string } | null {
  const separatorIndex = rawKey.indexOf(FINDING_SELECTION_KEY_SEPARATOR);
  if (separatorIndex < 0) {
    return null;
  }

  const reviewRunId = rawKey.slice(0, separatorIndex).trim();
  const findingId = rawKey.slice(separatorIndex + 1).trim();

  if (reviewRunId.length === 0 || findingId.length === 0) {
    return null;
  }

  return { reviewRunId, id: findingId };
}

type NormalizedReviewFixFinding = ReviewFixWidgetFindingInput & {
  id: string;
  reviewRunId: string;
  selectionKey: string;
};

export function normalizeReviewFixWidgetSelection(
  input: ReviewFixWidgetSelectionInput,
): NormalizedReviewFixWidgetSelection {
  const normalizedFindings: NormalizedReviewFixFinding[] = [];
  const findingByKey = new Map<string, NormalizedReviewFixFinding>();
  const findingKeysById = new Map<string, string[]>();

  for (const rawFinding of input.findings) {
    const normalizedId = rawFinding.id.trim();
    if (normalizedId.length === 0) {
      return {
        ok: false,
        error: "Review-fix widget data has a blank finding id.",
      };
    }

    const normalizedReviewRunId = rawFinding.reviewRunId?.trim() ?? "";
    const selectionKey =
      normalizedReviewRunId.length > 0
        ? buildFindingSelectionKey(normalizedReviewRunId, normalizedId)
        : normalizedId;

    if (findingByKey.has(selectionKey)) {
      return {
        ok: false,
        error: `Review-fix widget data has duplicate finding id: ${normalizedId}.`,
      };
    }

    const normalizedFinding: NormalizedReviewFixFinding = {
      ...rawFinding,
      id: normalizedId,
      reviewRunId: normalizedReviewRunId,
      selectionKey,
    };

    normalizedFindings.push(normalizedFinding);
    findingByKey.set(selectionKey, normalizedFinding);
    const keys = findingKeysById.get(normalizedId);
    findingKeysById.set(
      normalizedId,
      keys === undefined ? [selectionKey] : [...keys, selectionKey],
    );
  }

  const selectableFindingCount = normalizedFindings.filter(
    (finding) => !finding.fixed,
  ).length;
  if (selectableFindingCount === 0) {
    return { ok: false, error: "No review findings are available to fix." };
  }

  const normalizedReviewRunId = input.reviewRunId?.trim();

  const selectedKeys = new Set<string>();
  for (const selectedId of input.selectedFindingIds) {
    const trimmedSelectedId = selectedId.trim();
    if (trimmedSelectedId.length === 0) {
      continue;
    }

    const parsedSelectionKey = parseFindingSelectionKey(trimmedSelectedId);
    if (parsedSelectionKey === null) {
      const matchingKeys = findingKeysById.get(trimmedSelectedId) ?? [];
      if (matchingKeys.length === 0) {
        return {
          ok: false,
          error: `Selected finding is no longer available: ${trimmedSelectedId}.`,
        };
      }

      if (matchingKeys.length > 1) {
        return {
          ok: false,
          error: "Selected findings must come from a single review run.",
        };
      }

      selectedKeys.add(matchingKeys[0] ?? "");
      continue;
    }

    const key = buildFindingSelectionKey(
      parsedSelectionKey.reviewRunId,
      parsedSelectionKey.id,
    );
    const selectedFinding = findingByKey.get(key);
    if (selectedFinding === undefined) {
      return {
        ok: false,
        error: `Selected finding is no longer available: ${trimmedSelectedId}.`,
      };
    }

    selectedKeys.add(key);
  }

  const normalizedSelectedFindingIds: string[] = [];
  const selectedFindingRunIds = new Set<string>();

  for (const selectedKey of selectedKeys) {
    const selectedFinding = findingByKey.get(selectedKey);
    if (selectedFinding === undefined) {
      return {
        ok: false,
        error: `Selected finding is no longer available: ${selectedKey}.`,
      };
    }

    if (selectedFinding.fixed) {
      return {
        ok: false,
        error: `Selected finding is already fixed: ${selectedFinding.id}.`,
      };
    }

    if (selectedFinding.reviewRunId.length > 0) {
      selectedFindingRunIds.add(selectedFinding.reviewRunId);
    }
  }

  if (selectedFindingRunIds.size > 1) {
    return {
      ok: false,
      error: "Selected findings must come from a single review run.",
    };
  }

  for (const finding of normalizedFindings) {
    if (finding.fixed) {
      continue;
    }

    if (
      selectedKeys.has(finding.selectionKey) ||
      selectedKeys.has(finding.id)
    ) {
      normalizedSelectedFindingIds.push(finding.id);
    }
  }

  if (normalizedSelectedFindingIds.length === 0) {
    return { ok: false, error: "Select at least one finding to fix." };
  }

  const selectedFindingReviewRunId =
    selectedFindingRunIds.size === 1
      ? selectedFindingRunIds.values().next().value
      : undefined;

  const normalizedSelectedReviewRunId =
    selectedFindingReviewRunId ?? normalizedReviewRunId;
  if (
    normalizedSelectedReviewRunId === undefined ||
    normalizedSelectedReviewRunId.length === 0
  ) {
    return { ok: false, error: "No review run is available to fix." };
  }

  const normalizedFixContext = input.fixContext?.trim() ?? "";

  if (normalizedFixContext.length === 0) {
    return {
      ok: true,
      reviewRunId: normalizedSelectedReviewRunId,
      findingIds: normalizedSelectedFindingIds,
    };
  }

  return {
    ok: true,
    reviewRunId: normalizedSelectedReviewRunId,
    findingIds: normalizedSelectedFindingIds,
    fixContext: normalizedFixContext,
  };
}

function formatReference(reference: AddReviewCommentReference): string {
  const endLine =
    reference.endLine === undefined || reference.endLine === reference.startLine
      ? ""
      : `-${reference.endLine}`;
  return `${reference.filePath}:${reference.startLine}${endLine}`;
}

function formatReferences(references: AddReviewCommentReference[]): string {
  if (references.length === 0) {
    return "no refs";
  }

  return references.map(formatReference).join(", ");
}

function firstCommentLine(comment: string): string {
  return comment.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
}

function formatCompletedAt(
  completedAt: number | undefined,
): string | undefined {
  if (completedAt === undefined) {
    return undefined;
  }

  const date = new Date(completedAt);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

class ReviewFixWidgetComponent implements Component, Focusable {
  private readonly contextEditor: Editor;
  private readonly findings: NormalizedReviewFixFinding[];
  private readonly selectedFindingIds: Set<string>;
  private activeField: ActiveField = "findings";
  private activeFindingIndex = 0;
  private findingScrollOffset = 0;
  private selectedAction: SubmitCancelAction = "submit";
  private validationMessage: string | undefined;
  private isDone = false;
  private isFocused = false;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly config: ReviewFixWidgetConfig,
    private readonly done: (result: ReviewFixWidgetResult) => void,
  ) {
    this.contextEditor = new Editor(tui, createWidgetEditorTheme(theme), {
      paddingX: 1,
    });
    this.contextEditor.setText(config.initialFixContext ?? "");
    this.contextEditor.onSubmit = (fixContext) => this.submit(fixContext);
    this.contextEditor.onChange = () => this.handleContextChange();

    const findingKeysById = new Map<string, string[]>();
    this.findings = config.findings
      .map((finding) => {
        const normalizedId = finding.id.trim();
        const normalizedReviewRunId = finding.reviewRunId?.trim() ?? "";
        const selectionKey =
          normalizedReviewRunId.length > 0
            ? buildFindingSelectionKey(normalizedReviewRunId, normalizedId)
            : normalizedId;
        const normalizedFinding: NormalizedReviewFixFinding = {
          ...finding,
          id: normalizedId,
          reviewRunId: normalizedReviewRunId,
          selectionKey,
        };

        const keys = findingKeysById.get(normalizedId);
        findingKeysById.set(
          normalizedId,
          keys === undefined ? [selectionKey] : [...keys, selectionKey],
        );

        return normalizedFinding;
      })
      .filter((finding) => finding.id.length > 0);

    const selectedFindingIds = new Set<string>();
    for (const selectedId of config.initialSelectedFindingIds ?? []) {
      const normalizedSelectedId = selectedId.trim();
      if (normalizedSelectedId.length === 0) {
        continue;
      }

      const parsedSelectionKey = parseFindingSelectionKey(normalizedSelectedId);
      if (parsedSelectionKey !== null) {
        selectedFindingIds.add(
          buildFindingSelectionKey(
            parsedSelectionKey.reviewRunId,
            parsedSelectionKey.id,
          ),
        );
        continue;
      }

      const matchingKeys = findingKeysById.get(normalizedSelectedId) ?? [];
      for (const matchingKey of matchingKeys) {
        selectedFindingIds.add(matchingKey);
      }
    }
    this.selectedFindingIds = selectedFindingIds;

    this.updateChildFocus();
  }

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    this.updateChildFocus();
  }

  invalidate(): void {
    this.contextEditor.invalidate();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.cancel();
      return;
    }

    if (matchesKey(data, Key.tab)) {
      this.setActiveField(nextItem(ACTIVE_FIELDS, this.activeField, 1));
      return;
    }

    if (matchesKey(data, Key.shift("tab"))) {
      this.setActiveField(nextItem(ACTIVE_FIELDS, this.activeField, -1));
      return;
    }

    if (
      matchesKey(data, Key.ctrl("s")) ||
      matchesKey(data, Key.ctrl("enter"))
    ) {
      this.submit();
      return;
    }

    if (this.activeField === "actions") {
      this.handleActionInput(data);
      return;
    }

    if (this.activeField === "findings") {
      this.handleFindingInput(data);
      return;
    }

    if (this.activeField === "context") {
      this.contextEditor.handleInput(data);
      this.requestRender();
    }
  }

  render(width: number): string[] {
    const render = createWidgetRenderHelpers(width);
    this.updateEditorBorder();

    render.addLine(this.theme.fg("borderAccent", "─".repeat(render.safeWidth)));
    render.addWrapped(
      this.theme.fg("accent", this.theme.bold(this.config.title)),
    );
    render.addWrapped(this.theme.fg("muted", this.config.helpText));
    render.addLine();

    this.renderMetadata(render.addLine);
    render.addLine();

    this.renderFindings(render.addLine);
    render.addLine();

    this.renderFieldHeader(render.addLine, "context", REVIEW_FIX_CONTEXT_LABEL);
    render.addEditor(this.contextEditor);

    if (this.validationMessage !== undefined) {
      render.addLine();
      render.addWrapped(this.theme.fg("error", `! ${this.validationMessage}`));
    }

    render.addLine();
    this.renderActions(render.addLine);
    render.addWrapped(this.theme.fg("dim", REVIEW_FIX_KEY_HINT));
    render.addLine(this.theme.fg("borderAccent", "─".repeat(render.safeWidth)));

    return render.lines;
  }

  private renderMetadata(addLine: WidgetLineAppender): void {
    const reviewRunId = this.config.reviewRunId?.trim();
    const targetHint = this.config.targetHint?.trim();
    const completedAt = formatCompletedAt(this.config.completedAt);
    const totalCount = this.findings.length;
    const fixedCount = this.findings.filter((finding) => finding.fixed).length;
    const openCount = totalCount - fixedCount;
    const reviewRunIds = this.getActiveReviewRunIds();

    if (reviewRunId !== undefined && reviewRunId.length > 0) {
      addLine(this.theme.fg("muted", `Review run: ${reviewRunId}`));
      if (targetHint !== undefined && targetHint.length > 0) {
        addLine(this.theme.fg("muted", `Target: ${targetHint}`));
      }
      if (completedAt !== undefined) {
        addLine(this.theme.fg("muted", `Completed: ${completedAt}`));
      }
    } else if (reviewRunIds.size > 1) {
      addLine(
        this.theme.fg(
          "muted",
          `Review runs: ${reviewRunIds.size} with open findings`,
        ),
      );
    } else if (reviewRunIds.size === 1) {
      const firstRun = reviewRunIds.values().next().value;
      if (firstRun !== undefined && firstRun.length > 0) {
        addLine(this.theme.fg("muted", `Review run: ${firstRun}`));
      }
    }

    addLine(
      this.theme.fg(
        "muted",
        `Findings: ${openCount} open • ${fixedCount} fixed • ${totalCount} total`,
      ),
    );
  }
  private renderFindings(addLine: WidgetLineAppender): void {
    this.renderFieldHeader(addLine, "findings", "findings");

    if (this.findings.length === 0) {
      addLine(
        this.theme.fg(
          "warning",
          "  No completed review findings are available yet.",
        ),
      );
      addLine(
        this.theme.fg(
          "muted",
          "  Run /review first, then return to /review-fix.",
        ),
      );
      return;
    }

    const visibleRange = this.getVisibleFindingRange();

    if (this.findings.length > this.getMaxVisibleFindings()) {
      addLine(
        this.theme.fg(
          "dim",
          `  showing ${visibleRange.start + 1}-${visibleRange.end} of ${this.findings.length}`,
        ),
      );
    }

    let previousReviewRunId: string | undefined;
    for (let index = visibleRange.start; index < visibleRange.end; index += 1) {
      const finding = this.findings[index];
      if (finding === undefined) {
        continue;
      }

      const currentReviewRunId = this.getReviewRunId(finding);
      if (currentReviewRunId !== previousReviewRunId) {
        const targetHint = this.getFindingTargetHint(finding);
        const completedAt = formatCompletedAt(
          this.getFindingCompletedAt(finding),
        );
        const metaParts = [
          `Review run: ${currentReviewRunId}`,
          ...(targetHint.length > 0 ? [`Target: ${targetHint}`] : []),
          ...(completedAt === undefined ? [] : [`Completed: ${completedAt}`]),
        ];

        addLine(this.theme.fg("dim", `  ${metaParts.join(" • ")}`));
      }

      const activeMarker =
        index === this.activeFindingIndex ? this.theme.fg("accent", "›") : " ";
      const checkbox = this.renderCheckbox(finding);
      const refs = formatReferences(finding.references);
      const preview = firstCommentLine(finding.comment);
      const row = `${activeMarker} ${checkbox} ${finding.priority} ${finding.id.trim()} ${refs} ${preview}`;
      addLine(`  ${row}`);
      previousReviewRunId = currentReviewRunId;
    }
  }
  private renderCheckbox(finding: NormalizedReviewFixFinding): string {
    if (finding.fixed) {
      return this.theme.fg("muted", "[−] fixed");
    }

    if (
      this.selectedFindingIds.has(finding.selectionKey) ||
      this.selectedFindingIds.has(finding.id)
    ) {
      return this.theme.fg("accent", "[x]");
    }

    return "[ ]";
  }

  private getReviewRunId(finding: NormalizedReviewFixFinding): string {
    return finding.reviewRunId.length > 0
      ? finding.reviewRunId
      : (this.config.reviewRunId?.trim() ?? "");
  }

  private getFindingTargetHint(finding: NormalizedReviewFixFinding): string {
    const findingTargetHint = finding.targetHint?.trim();
    if (findingTargetHint !== undefined && findingTargetHint.length > 0) {
      return findingTargetHint;
    }

    return this.config.targetHint?.trim() ?? "";
  }

  private getFindingCompletedAt(
    finding: NormalizedReviewFixFinding,
  ): number | undefined {
    if (finding.completedAt !== undefined) {
      return finding.completedAt;
    }

    return this.config.completedAt;
  }

  private getActiveReviewRunIds(): Set<string> {
    const runIds = new Set<string>();
    for (const finding of this.findings) {
      const runId = this.getReviewRunId(finding);
      if (runId.length > 0) {
        runIds.add(runId);
      }
    }

    if (runIds.size === 0 && this.config.reviewRunId !== undefined) {
      const trimmedRunId = this.config.reviewRunId.trim();
      if (trimmedRunId.length > 0) {
        runIds.add(trimmedRunId);
      }
    }

    return runIds;
  }

  private handleFindingInput(data: string): void {
    if (this.findings.length === 0) {
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.moveActiveFinding(-1);
      return;
    }

    if (matchesKey(data, Key.down)) {
      this.moveActiveFinding(1);
      return;
    }

    if (matchesKey(data, Key.enter) || data === " ") {
      this.toggleActiveFinding();
      return;
    }

    if (data === "a" || data === "A") {
      this.toggleAllOpenFindings();
    }
  }

  private moveActiveFinding(direction: -1 | 1): void {
    const maxIndex = this.findings.length - 1;
    this.activeFindingIndex = Math.max(
      0,
      Math.min(maxIndex, this.activeFindingIndex + direction),
    );
    this.ensureActiveFindingVisible();
    this.requestRender();
  }

  private toggleActiveFinding(): void {
    const finding = this.findings[this.activeFindingIndex];
    if (finding === undefined || finding.fixed) {
      return;
    }

    const findingId = finding.id.trim();
    if (findingId.length === 0) {
      return;
    }

    if (
      this.selectedFindingIds.has(finding.selectionKey) ||
      this.selectedFindingIds.has(findingId)
    ) {
      this.selectedFindingIds.delete(finding.selectionKey);
      this.selectedFindingIds.delete(findingId);
    } else {
      this.selectedFindingIds.add(finding.selectionKey);
    }

    this.validationMessage = undefined;
    this.requestRender();
  }

  private toggleAllOpenFindings(): void {
    const openFindingKeys = this.findings
      .filter((finding) => !finding.fixed)
      .map((finding) => finding.selectionKey)
      .filter((findingId) => findingId.length > 0);

    if (openFindingKeys.length === 0) {
      return;
    }

    const allOpenSelected = openFindingKeys.every((findingId) =>
      this.selectedFindingIds.has(findingId),
    );

    for (const findingId of openFindingKeys) {
      if (allOpenSelected) {
        this.selectedFindingIds.delete(findingId);
      } else {
        this.selectedFindingIds.add(findingId);
      }
    }

    this.validationMessage = undefined;
    this.requestRender();
  }

  private getVisibleFindingRange(): { start: number; end: number } {
    this.ensureActiveFindingVisible();

    const totalCount = this.findings.length;
    const visibleCount = Math.min(this.getMaxVisibleFindings(), totalCount);

    return {
      start: this.findingScrollOffset,
      end: Math.min(totalCount, this.findingScrollOffset + visibleCount),
    };
  }

  private ensureActiveFindingVisible(): void {
    const totalCount = this.findings.length;
    if (totalCount === 0) {
      this.activeFindingIndex = 0;
      this.findingScrollOffset = 0;
      return;
    }

    const visibleCount = Math.min(this.getMaxVisibleFindings(), totalCount);
    this.activeFindingIndex = Math.max(
      0,
      Math.min(totalCount - 1, this.activeFindingIndex),
    );

    if (this.activeFindingIndex < this.findingScrollOffset) {
      this.findingScrollOffset = this.activeFindingIndex;
    }

    if (this.activeFindingIndex >= this.findingScrollOffset + visibleCount) {
      this.findingScrollOffset = this.activeFindingIndex - visibleCount + 1;
    }

    const maxOffset = Math.max(0, totalCount - visibleCount);
    this.findingScrollOffset = Math.max(
      0,
      Math.min(maxOffset, this.findingScrollOffset),
    );
  }

  private getMaxVisibleFindings(): number {
    const terminalRows = Math.max(1, Math.floor(this.tui.terminal.rows));
    return Math.max(3, Math.min(8, terminalRows - 18));
  }

  private renderFieldHeader(
    addLine: WidgetLineAppender,
    field: Exclude<ActiveField, "actions">,
    label: string,
  ): void {
    const marker =
      this.activeField === field ? this.theme.fg("accent", "▶") : " ";
    addLine(`${marker} ${label}`);
  }

  private renderActions(addLine: WidgetLineAppender): void {
    const marker =
      this.activeField === "actions" ? this.theme.fg("accent", "▶") : " ";
    const active = this.activeField === "actions";
    const submit = renderSubmitCancelAction({
      theme: this.theme,
      action: "submit",
      selectedAction: this.selectedAction,
      active,
      submitLabel: "Start fix",
      cancelLabel: "Cancel",
    });
    const cancel = renderSubmitCancelAction({
      theme: this.theme,
      action: "cancel",
      selectedAction: this.selectedAction,
      active,
      submitLabel: "Start fix",
      cancelLabel: "Cancel",
    });
    addLine(`${marker} ${submit}  ${cancel}`);
  }

  private handleActionInput(data: string): void {
    handleSubmitCancelActionInput({
      data,
      selectedAction: this.selectedAction,
      setSelectedAction: (action) => {
        this.selectedAction = action;
      },
      submit: () => this.submit(),
      cancel: () => this.cancel(),
      requestRender: () => this.requestRender(),
    });
  }

  private handleContextChange(): void {
    this.validationMessage = undefined;
    this.requestRender();
  }

  private setActiveField(field: ActiveField): void {
    this.activeField = field;
    if (field === "actions") {
      this.selectedAction = "submit";
    }
    this.updateChildFocus();
    this.requestRender();
  }

  private submit(fixContext = this.contextEditor.getExpandedText()): void {
    const normalized = normalizeReviewFixWidgetSelection({
      reviewRunId: this.config.reviewRunId,
      findings: this.findings,
      selectedFindingIds: [...this.selectedFindingIds],
      fixContext,
    });

    if (!normalized.ok) {
      this.contextEditor.setText(fixContext);
      this.validationMessage = normalized.error;
      this.requestRender();
      return;
    }

    this.finish({
      submitted: true,
      reviewRunId: normalized.reviewRunId,
      findingIds: normalized.findingIds,
      ...(normalized.fixContext === undefined
        ? {}
        : { fixContext: normalized.fixContext }),
    });
  }

  private cancel(): void {
    this.finish({ submitted: false });
  }

  private finish(result: ReviewFixWidgetResult): void {
    if (this.isDone) {
      return;
    }
    this.isDone = true;
    this.done(result);
  }

  private updateChildFocus(): void {
    this.contextEditor.focused =
      this.isFocused && this.activeField === "context";
  }

  private updateEditorBorder(): void {
    this.contextEditor.borderColor = (text) =>
      this.theme.fg(
        this.activeField === "context" ? "accent" : "borderMuted",
        text,
      );
  }

  private requestRender(): void {
    this.tui.requestRender();
  }
}

export function createReviewFixWidgetComponent({
  tui,
  theme,
  config,
  done,
}: ReviewFixWidgetComponentOptions): Component & Focusable {
  return new ReviewFixWidgetComponent(tui, theme, config, done);
}

export function showReviewFixWidget(
  ctx: ExtensionCommandContext,
  config: ReviewFixWidgetConfig,
): Promise<ReviewFixWidgetResult> {
  return ctx.ui.custom<ReviewFixWidgetResult>(
    (tui, theme, _keybindings, done) =>
      createReviewFixWidgetComponent({ tui, theme, config, done }),
  );
}
