import type {
  ExtensionCommandContext,
  Theme,
} from "@mariozechner/pi-coding-agent";
import {
  type Component,
  Editor,
  type EditorTheme,
  type Focusable,
  Key,
  type TUI,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";

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
type FormAction = "submit" | "cancel";

const ACTIVE_FIELDS: ActiveField[] = ["primary", "context", "actions"];
const ACTIONS: FormAction[] = ["submit", "cancel"];

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

function createEditorTheme(theme: Theme): EditorTheme {
  return {
    borderColor: (text) => theme.fg("borderMuted", text),
    selectList: {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    },
  };
}

function nextItem<T>(items: readonly T[], current: T, direction: -1 | 1): T {
  const currentIndex = items.indexOf(current);
  const nextIndex = (currentIndex + direction + items.length) % items.length;
  return items[nextIndex] ?? current;
}

class ReviewInputWidgetComponent implements Component, Focusable {
  private readonly primaryEditor: Editor;
  private readonly contextEditor: Editor;
  private activeField: ActiveField = "primary";
  private selectedAction: FormAction = "submit";
  private validationMessage: string | undefined;
  private isDone = false;
  private isFocused = false;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly config: ReviewInputWidgetConfig,
    private readonly done: (result: ReviewInputWidgetResult) => void,
  ) {
    const editorTheme = createEditorTheme(theme);
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
    const safeWidth = Math.max(1, Math.floor(width));
    const editorWidth = Math.max(1, safeWidth - 2);
    this.updateEditorBorders();

    const lines: string[] = [];
    const addLine = (line = "") => {
      lines.push(truncateToWidth(line, safeWidth, ""));
    };
    const addWrapped = (text: string, prefix = "") => {
      const bodyWidth = Math.max(1, safeWidth - visibleWidth(prefix));
      for (const rawLine of text.split("\n")) {
        const wrappedLines = wrapTextWithAnsi(rawLine, bodyWidth);
        if (wrappedLines.length === 0) {
          addLine(prefix);
          continue;
        }
        for (const wrappedLine of wrappedLines) {
          addLine(`${prefix}${wrappedLine}`);
        }
      }
    };
    const addEditor = (editor: Editor) => {
      for (const editorLine of editor.render(editorWidth)) {
        addLine(` ${editorLine}`);
      }
    };

    addLine(this.theme.fg("borderAccent", "─".repeat(safeWidth)));
    addWrapped(this.theme.fg("accent", this.theme.bold(this.config.title)));
    addWrapped(this.theme.fg("muted", this.config.helpText));
    addLine();

    this.renderFieldHeader(
      lines,
      safeWidth,
      "primary",
      this.config.primaryLabel,
    );
    if (this.primaryEditor.getText().trim().length === 0) {
      addWrapped(this.theme.fg("dim", this.config.primaryPlaceholder), "  ");
    }
    addEditor(this.primaryEditor);

    this.renderFieldHeader(
      lines,
      safeWidth,
      "context",
      this.config.contextLabel,
    );
    addEditor(this.contextEditor);

    if (this.validationMessage !== undefined) {
      addLine();
      addWrapped(this.theme.fg("error", `! ${this.validationMessage}`));
    }

    addLine();
    this.renderActions(lines, safeWidth);
    addWrapped(this.theme.fg("dim", REVIEW_INPUT_KEY_HINT));
    addLine(this.theme.fg("borderAccent", "─".repeat(safeWidth)));

    return lines;
  }

  private handleActionInput(data: string): void {
    if (matchesKey(data, Key.left)) {
      this.selectedAction = nextItem(ACTIONS, this.selectedAction, -1);
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.right)) {
      this.selectedAction = nextItem(ACTIONS, this.selectedAction, 1);
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      if (this.selectedAction === "submit") {
        this.submit();
      } else {
        this.cancel();
      }
    }
  }

  private handleEditorChange(): void {
    this.validationMessage = undefined;
    this.requestRender();
  }

  private renderFieldHeader(
    lines: string[],
    width: number,
    field: Exclude<ActiveField, "actions">,
    label: string,
  ): void {
    const isActive = this.activeField === field;
    const marker = isActive ? this.theme.fg("accent", "▶") : " ";
    const requiredText =
      field === "primary" ? this.theme.fg("warning", " required") : "";
    lines.push(truncateToWidth(`${marker} ${label}${requiredText}`, width, ""));
  }

  private renderActions(lines: string[], width: number): void {
    const marker =
      this.activeField === "actions" ? this.theme.fg("accent", "▶") : " ";
    const submit = this.renderAction("submit", "Submit");
    const cancel = this.renderAction("cancel", "Cancel");
    lines.push(truncateToWidth(`${marker} ${submit}  ${cancel}`, width, ""));
  }

  private renderAction(action: FormAction, label: string): string {
    const text = ` ${label} `;
    if (this.activeField === "actions" && this.selectedAction === action) {
      return this.theme.bg("selectedBg", this.theme.fg("text", text));
    }

    const color = action === "submit" ? "success" : "muted";
    return this.theme.fg(color, text);
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
