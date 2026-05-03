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
  type WidgetRenderHelpers,
  createWidgetEditorTheme,
  createWidgetRenderHelpers,
  handleSubmitCancelActionInput,
  handleWidgetFrameInput,
  nextItem,
  renderFieldHeader,
  renderSubmitCancelActions,
} from "./widget-utils.js";

export type ReviewInputKind = "review" | "diff-against" | "pr";

export type ReviewInputWidgetResult =
  | {
      submitted: true;
      kind: ReviewInputKind;
      primaryValue: string;
      reviewContext?: string;
    }
  | { submitted: false };

export type ReviewInputWidgetConfig = {
  title: string;
  helpText: string;
  initialKind?: ReviewInputKind;
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

type ActiveField = "kind" | "primary" | "context" | "actions";

type ReviewInputKindOption = {
  kind: ReviewInputKind;
  shortcut: "1" | "2" | "3";
  label: string;
  primaryLabel: string;
  primaryPlaceholder: string;
};

const ACTIVE_FIELDS: ActiveField[] = ["kind", "primary", "context", "actions"];

const DEFAULT_PRIMARY_LABEL = "what do I review?";
const REVIEW_WIDGET_CONTEXT_LABEL = "any context I should be aware of?";
const REVIEW_INPUT_KEY_HINT =
  "Tab/Shift+Tab switch field • arrows or 1/2/3 choose type • Enter submit/move from type • Alt+Enter newline • Esc cancel";

const REVIEW_INPUT_KIND_OPTIONS: readonly ReviewInputKindOption[] = [
  {
    kind: "review",
    shortcut: "1",
    label: "Free-form request",
    primaryLabel: DEFAULT_PRIMARY_LABEL,
    primaryPlaceholder: "Describe the code, behavior, or risk to review.",
  },
  {
    kind: "diff-against",
    shortcut: "2",
    label: "Diff against ref",
    primaryLabel: "ref:",
    primaryPlaceholder: "Enter ref or change id.",
  },
  {
    kind: "pr",
    shortcut: "3",
    label: "PR/MR URL or number",
    primaryLabel: "pr:",
    primaryPlaceholder: "Enter GitHub URL, GitLab URL, MR URL, or PR number.",
  },
];

const REVIEW_INPUT_KIND_VALUES = REVIEW_INPUT_KIND_OPTIONS.map(
  (option) => option.kind,
);

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

function isReviewInputKind(value: unknown): value is ReviewInputKind {
  return (
    typeof value === "string" &&
    (REVIEW_INPUT_KIND_VALUES as readonly string[]).includes(value)
  );
}

function getInitialKind(config: ReviewInputWidgetConfig): ReviewInputKind {
  if (config.initialKind !== undefined) {
    return config.initialKind;
  }

  const legacyKind = (config as { kind?: unknown }).kind;
  if (isReviewInputKind(legacyKind)) {
    return legacyKind;
  }

  return "review";
}

function getKindOption(kind: ReviewInputKind): ReviewInputKindOption {
  return (
    REVIEW_INPUT_KIND_OPTIONS.find((option) => option.kind === kind) ??
    REVIEW_INPUT_KIND_OPTIONS[0]
  );
}

function getKindByShortcut(data: string): ReviewInputKind | undefined {
  return REVIEW_INPUT_KIND_OPTIONS.find((option) => option.shortcut === data)
    ?.kind;
}

class ReviewInputWidgetComponent implements Component, Focusable {
  private readonly primaryEditor: Editor;
  private readonly contextEditor: Editor;
  private activeField: ActiveField = "kind";
  private selectedKind: ReviewInputKind;
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
    this.selectedKind = getInitialKind(config);
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
    if (
      handleWidgetFrameInput({
        data,
        fields: ACTIVE_FIELDS,
        activeField: this.activeField,
        setActiveField: (field) => this.setActiveField(field),
        submit: () => this.submit(),
        cancel: () => this.cancel(),
      })
    ) {
      return;
    }

    if (this.activeField === "kind") {
      this.handleKindInput(data);
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
    const kindOption = getKindOption(this.selectedKind);
    this.updateEditorBorders();

    render.addLine(this.theme.fg("borderAccent", "─".repeat(render.safeWidth)));
    render.addWrapped(
      this.theme.fg("accent", this.theme.bold(this.config.title)),
    );
    render.addWrapped(this.theme.fg("muted", this.config.helpText));
    render.addLine();

    this.renderKindSelector(render);
    render.addLine();

    this.renderFieldHeader(render.addLine, "primary", kindOption.primaryLabel);
    if (this.primaryEditor.getText().trim().length === 0) {
      render.addWrapped(
        this.theme.fg("dim", kindOption.primaryPlaceholder),
        "  ",
      );
    }
    render.addEditor(this.primaryEditor);

    this.renderFieldHeader(
      render.addLine,
      "context",
      REVIEW_WIDGET_CONTEXT_LABEL,
    );
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

  private handleKindInput(data: string): void {
    if (matchesKey(data, Key.enter)) {
      this.setActiveField("primary");
      return;
    }

    let nextKind: ReviewInputKind | undefined;
    if (matchesKey(data, Key.left) || matchesKey(data, Key.up)) {
      nextKind = nextItem(REVIEW_INPUT_KIND_VALUES, this.selectedKind, -1);
    } else if (matchesKey(data, Key.right) || matchesKey(data, Key.down)) {
      nextKind = nextItem(REVIEW_INPUT_KIND_VALUES, this.selectedKind, 1);
    } else {
      nextKind = getKindByShortcut(data);
    }

    if (nextKind !== undefined) {
      this.setSelectedKind(nextKind);
    }
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

  private renderKindSelector(render: WidgetRenderHelpers): void {
    this.renderFieldHeader(render.addLine, "kind", "review type");

    const modeChoices = REVIEW_INPUT_KIND_OPTIONS.map((option) => {
      const marker = option.kind === this.selectedKind ? "[x]" : "[ ]";
      const choice = `${marker} ${option.label}`;
      return option.kind === this.selectedKind
        ? this.theme.fg("accent", choice)
        : choice;
    }).join("   ");

    render.addWrapped(modeChoices, "  ");
  }

  private renderFieldHeader(
    addLine: WidgetLineAppender,
    field: Exclude<ActiveField, "actions">,
    label: string,
  ): void {
    addLine(
      renderFieldHeader({
        theme: this.theme,
        active: this.activeField === field,
        label,
        suffix:
          field === "primary" ? this.theme.fg("warning", " required") : "",
      }),
    );
  }

  private renderActions(addLine: WidgetLineAppender): void {
    addLine(
      renderSubmitCancelActions({
        theme: this.theme,
        active: this.activeField === "actions",
        selectedAction: this.selectedAction,
        submitLabel: "Submit",
        cancelLabel: "Cancel",
      }),
    );
  }

  private setActiveField(field: ActiveField): void {
    this.activeField = field;
    if (field === "actions") {
      this.selectedAction = "submit";
    }
    this.updateChildFocus();
    this.requestRender();
  }

  private setSelectedKind(kind: ReviewInputKind): void {
    this.selectedKind = kind;
    this.validationMessage = undefined;
    this.requestRender();
  }

  private submit(): void {
    const kindOption = getKindOption(this.selectedKind);
    const normalized = normalizeReviewInput(
      this.primaryEditor.getExpandedText(),
      this.contextEditor.getExpandedText(),
      kindOption.primaryLabel,
    );

    if (!normalized.ok) {
      this.validationMessage = normalized.error;
      this.setActiveField("primary");
      return;
    }

    this.finish({
      submitted: true,
      kind: this.selectedKind,
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
