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
  "Up/Down move • Space toggle • a select all open • Tab/Shift+Tab switch area • Ctrl+S submit • Esc cancel";

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
    this.contextEditor.onSubmit = () => this.submit();
    this.contextEditor.onChange = () => this.handleContextChange();

    this.selectedFindingIds = new Set(
      (config.initialSelectedFindingIds ?? [])
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    );

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
    const totalCount = this.config.findings.length;
    const fixedCount = this.config.findings.filter(
      (finding) => finding.fixed,
    ).length;
    const openCount = totalCount - fixedCount;

    if (reviewRunId !== undefined && reviewRunId.length > 0) {
      addLine(this.theme.fg("muted", `Review run: ${reviewRunId}`));
    }
    if (targetHint !== undefined && targetHint.length > 0) {
      addLine(this.theme.fg("muted", `Target: ${targetHint}`));
    }
    if (completedAt !== undefined) {
      addLine(this.theme.fg("muted", `Completed: ${completedAt}`));
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

    if (this.config.findings.length === 0) {
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

    if (this.config.findings.length > this.getMaxVisibleFindings()) {
      addLine(
        this.theme.fg(
          "dim",
          `  showing ${visibleRange.start + 1}-${visibleRange.end} of ${this.config.findings.length}`,
        ),
      );
    }

    for (let index = visibleRange.start; index < visibleRange.end; index += 1) {
      const finding = this.config.findings[index];
      if (finding === undefined) {
        continue;
      }
      const activeMarker =
        index === this.activeFindingIndex ? this.theme.fg("accent", "›") : " ";
      const checkbox = this.renderCheckbox(finding);
      const refs = formatReferences(finding.references);
      const preview = firstCommentLine(finding.comment);
      const row = `${activeMarker} ${checkbox} ${finding.priority} ${finding.id.trim()} ${refs} ${preview}`;
      addLine(`  ${row}`);
    }
  }

  private renderCheckbox(finding: ReviewFixWidgetFindingInput): string {
    if (finding.fixed) {
      return this.theme.fg("muted", "[−] fixed");
    }

    if (this.selectedFindingIds.has(finding.id.trim())) {
      return this.theme.fg("accent", "[x]");
    }

    return "[ ]";
  }

  private handleFindingInput(data: string): void {
    if (this.config.findings.length === 0) {
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
    const maxIndex = this.config.findings.length - 1;
    this.activeFindingIndex = Math.max(
      0,
      Math.min(maxIndex, this.activeFindingIndex + direction),
    );
    this.ensureActiveFindingVisible();
    this.requestRender();
  }

  private toggleActiveFinding(): void {
    const finding = this.config.findings[this.activeFindingIndex];
    if (finding === undefined || finding.fixed) {
      return;
    }

    const findingId = finding.id.trim();
    if (findingId.length === 0) {
      return;
    }

    if (this.selectedFindingIds.has(findingId)) {
      this.selectedFindingIds.delete(findingId);
    } else {
      this.selectedFindingIds.add(findingId);
    }

    this.validationMessage = undefined;
    this.requestRender();
  }

  private toggleAllOpenFindings(): void {
    const openFindingIds = this.config.findings
      .filter((finding) => !finding.fixed)
      .map((finding) => finding.id.trim())
      .filter((findingId) => findingId.length > 0);

    if (openFindingIds.length === 0) {
      return;
    }

    const allOpenSelected = openFindingIds.every((findingId) =>
      this.selectedFindingIds.has(findingId),
    );

    for (const findingId of openFindingIds) {
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

    const totalCount = this.config.findings.length;
    const visibleCount = Math.min(this.getMaxVisibleFindings(), totalCount);

    return {
      start: this.findingScrollOffset,
      end: Math.min(totalCount, this.findingScrollOffset + visibleCount),
    };
  }

  private ensureActiveFindingVisible(): void {
    const totalCount = this.config.findings.length;
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

  private submit(): void {
    const normalized = normalizeReviewFixWidgetSelection({
      reviewRunId: this.config.reviewRunId,
      findings: this.config.findings,
      selectedFindingIds: [...this.selectedFindingIds],
      fixContext: this.contextEditor.getExpandedText(),
    });

    if (!normalized.ok) {
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
    {
      overlay: true,
      overlayOptions: {
        width: "80%",
        minWidth: 48,
        maxHeight: "85%",
        anchor: "center",
        margin: 2,
      },
    },
  );
}
