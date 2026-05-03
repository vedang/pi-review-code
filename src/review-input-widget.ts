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

import {
  type SubmitCancelAction,
  type WidgetLineAppender,
  createWidgetEditorTheme,
  createWidgetRenderHelpers,
  handleSubmitCancelActionInput,
  nextItem,
  renderSubmitCancelAction,
} from "./widget-utils.js";

export type ReviewInputKind = "review" | "diff-against" | "pr";

export type ReviewInputWidgetResult =
  | { submitted: true; primaryValue: string; reviewContext?: string }
  | { submitted: false };

export type ReviewInputWidgetConfig = {
  kind: ReviewInputKind;
  title: string;
  helpText: string;
  primaryLabel: string;
  primaryPlaceholder: string;
  contextLabel: string;
  initialPrimaryValue?: string;
  initialContext?: string;
};

export type NormalizedReviewInput =
  | { ok: true; primaryValue: string; reviewContext?: string }
  | { ok: false; error: string };

export type ReviewInputWidgetComponentOptions = {
  tui: TUI;
  theme: Theme;
  config: ReviewInputWidgetConfig;
  done: (result: ReviewInputWidgetResult) => void;
};

type ActiveField = "primary" | "context" | "actions";

const ACTIVE_FIELDS: ActiveField[] = ["primary", "context", "actions"];

const DEFAULT_PRIMARY_LABEL = "what do I review?";
const REVIEW_INPUT_KEY_HINT =
  "Tab/Shift+Tab switch field • Enter submit • Alt+Enter newline • Esc cancel";

export function normalizeReviewInput(
  primaryValue: string,
  reviewContext?: string,
  primaryLabel = DEFAULT_PRIMARY_LABEL,
): NormalizedReviewInput {
  const trimmedPrimaryValue = primaryValue.trim();
  if (trimmedPrimaryValue.length === 0) {
    return { ok: false, error: `${primaryLabel} is required.` };
  }

  const trimmedContext = reviewContext?.trim() ?? "";
  if (trimmedContext.length === 0) {
    return { ok: true, primaryValue: trimmedPrimaryValue };
  }

  return {
    ok: true,
    primaryValue: trimmedPrimaryValue,
    reviewContext: trimmedContext,
  };
}

class ReviewInputWidgetComponent implements Component, Focusable {
  private readonly primaryEditor: Editor;
  private readonly contextEditor: Editor;
  private activeField: ActiveField = "primary";
  private selectedAction: SubmitCancelAction = "submit";
  private validationMessage: string | undefined;
  private isDone = false;
  private isFocused = false;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly config: ReviewInputWidgetConfig,
    private readonly done: (result: ReviewInputWidgetResult) => void,
  ) {
    const editorTheme = createWidgetEditorTheme(theme);
    this.primaryEditor = new Editor(tui, editorTheme, { paddingX: 1 });
    this.contextEditor = new Editor(tui, editorTheme, { paddingX: 1 });
    this.primaryEditor.setText(config.initialPrimaryValue ?? "");
    this.contextEditor.setText(config.initialContext ?? "");

    this.primaryEditor.onSubmit = () => this.submit();
    this.contextEditor.onSubmit = () => this.submit();
    this.primaryEditor.onChange = () => this.handleEditorChange();
    this.contextEditor.onChange = () => this.handleEditorChange();
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
    this.primaryEditor.invalidate();
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

    if (this.activeField !== "actions" && matchesKey(data, Key.enter)) {
      this.submit();
      return;
    }

    if (this.activeField === "actions") {
      this.handleActionInput(data);
      return;
    }

    const editor =
      this.activeField === "primary" ? this.primaryEditor : this.contextEditor;
    editor.handleInput(data);
    this.requestRender();
  }

  render(width: number): string[] {
    const render = createWidgetRenderHelpers(width);
    this.updateEditorBorders();

    render.addLine(this.theme.fg("borderAccent", "─".repeat(render.safeWidth)));
    render.addWrapped(
      this.theme.fg("accent", this.theme.bold(this.config.title)),
    );
    render.addWrapped(this.theme.fg("muted", this.config.helpText));
    render.addLine();

    this.renderFieldHeader(render.addLine, "primary", this.config.primaryLabel);
    if (this.primaryEditor.getText().trim().length === 0) {
      render.addWrapped(
        this.theme.fg("dim", this.config.primaryPlaceholder),
        "  ",
      );
    }
    render.addEditor(this.primaryEditor);

    this.renderFieldHeader(render.addLine, "context", this.config.contextLabel);
    render.addEditor(this.contextEditor);

    if (this.validationMessage !== undefined) {
      render.addLine();
      render.addWrapped(this.theme.fg("error", `! ${this.validationMessage}`));
    }

    render.addLine();
    this.renderActions(render.addLine);
    render.addWrapped(this.theme.fg("dim", REVIEW_INPUT_KEY_HINT));
    render.addLine(this.theme.fg("borderAccent", "─".repeat(render.safeWidth)));

    return render.lines;
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

  private handleEditorChange(): void {
    this.validationMessage = undefined;
    this.requestRender();
  }

  private renderFieldHeader(
    addLine: WidgetLineAppender,
    field: Exclude<ActiveField, "actions">,
    label: string,
  ): void {
    const isActive = this.activeField === field;
    const marker = isActive ? this.theme.fg("accent", "▶") : " ";
    const requiredText =
      field === "primary" ? this.theme.fg("warning", " required") : "";
    addLine(`${marker} ${label}${requiredText}`);
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
      submitLabel: "Submit",
      cancelLabel: "Cancel",
    });
    const cancel = renderSubmitCancelAction({
      theme: this.theme,
      action: "cancel",
      selectedAction: this.selectedAction,
      active,
      submitLabel: "Submit",
      cancelLabel: "Cancel",
    });
    addLine(`${marker} ${submit}  ${cancel}`);
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
    const normalized = normalizeReviewInput(
      this.primaryEditor.getExpandedText(),
      this.contextEditor.getExpandedText(),
      this.config.primaryLabel,
    );

    if (!normalized.ok) {
      this.validationMessage = normalized.error;
      this.setActiveField("primary");
      return;
    }

    this.finish({
      submitted: true,
      primaryValue: normalized.primaryValue,
      ...(normalized.reviewContext === undefined
        ? {}
        : { reviewContext: normalized.reviewContext }),
    });
  }

  private cancel(): void {
    this.finish({ submitted: false });
  }

  private finish(result: ReviewInputWidgetResult): void {
    if (this.isDone) {
      return;
    }
    this.isDone = true;
    this.done(result);
  }

  private updateChildFocus(): void {
    this.primaryEditor.focused =
      this.isFocused && this.activeField === "primary";
    this.contextEditor.focused =
      this.isFocused && this.activeField === "context";
  }

  private updateEditorBorders(): void {
    this.primaryEditor.borderColor = (text) =>
      this.theme.fg(
        this.activeField === "primary" ? "accent" : "borderMuted",
        text,
      );
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

export function createReviewInputWidgetComponent({
  tui,
  theme,
  config,
  done,
}: ReviewInputWidgetComponentOptions): Component & Focusable {
  return new ReviewInputWidgetComponent(tui, theme, config, done);
}

export function showReviewInputWidget(
  ctx: ExtensionCommandContext,
  config: ReviewInputWidgetConfig,
): Promise<ReviewInputWidgetResult> {
  return ctx.ui.custom<ReviewInputWidgetResult>(
    (tui, theme, _keybindings, done) =>
      createReviewInputWidgetComponent({ tui, theme, config, done }),
  );
}
