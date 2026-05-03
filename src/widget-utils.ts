import type { Theme } from "@mariozechner/pi-coding-agent";
import {
  type Editor,
  type EditorTheme,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";

export const SUBMIT_CANCEL_ACTIONS = ["submit", "cancel"] as const;

export type SubmitCancelAction = (typeof SUBMIT_CANCEL_ACTIONS)[number];

export type WidgetLineAppender = (line?: string) => void;

export type WidgetRenderHelpers = {
  lines: string[];
  safeWidth: number;
  addLine: WidgetLineAppender;
  addWrapped: (text: string, prefix?: string) => void;
  addEditor: (editor: Editor) => void;
};

export function createWidgetEditorTheme(theme: Theme): EditorTheme {
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

export function nextItem<T>(
  items: readonly T[],
  current: T,
  direction: -1 | 1,
): T {
  const currentIndex = items.indexOf(current);
  const nextIndex = (currentIndex + direction + items.length) % items.length;
  return items[nextIndex] ?? current;
}

export function createWidgetRenderHelpers(width: number): WidgetRenderHelpers {
  const safeWidth = Math.max(1, Math.floor(width));
  const editorWidth = Math.max(1, safeWidth - 2);
  const lines: string[] = [];

  const addLine: WidgetLineAppender = (line = "") => {
    lines.push(truncateToWidth(line, safeWidth, ""));
  };

  return {
    lines,
    safeWidth,
    addLine,
    addWrapped: (text, prefix = "") => {
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
    },
    addEditor: (editor) => {
      for (const editorLine of editor.render(editorWidth)) {
        addLine(` ${editorLine}`);
      }
    },
  };
}

export function renderFieldHeader(input: {
  theme: Theme;
  active: boolean;
  label: string;
  suffix?: string;
}): string {
  const marker = input.active ? input.theme.fg("accent", "▶") : " ";
  return `${marker} ${input.label}${input.suffix ?? ""}`;
}

export function renderSubmitCancelAction(input: {
  theme: Theme;
  action: SubmitCancelAction;
  selectedAction: SubmitCancelAction;
  active: boolean;
  submitLabel: string;
  cancelLabel: string;
}): string {
  const label =
    input.action === "submit" ? input.submitLabel : input.cancelLabel;
  const text = ` ${label} `;

  if (input.active && input.selectedAction === input.action) {
    return input.theme.bg("selectedBg", input.theme.fg("text", text));
  }

  const color = input.action === "submit" ? "success" : "muted";
  return input.theme.fg(color, text);
}

export function renderSubmitCancelActions(input: {
  theme: Theme;
  active: boolean;
  selectedAction: SubmitCancelAction;
  submitLabel: string;
  cancelLabel: string;
}): string {
  const marker = input.active ? input.theme.fg("accent", "▶") : " ";
  const submit = renderSubmitCancelAction({
    ...input,
    action: "submit",
  });
  const cancel = renderSubmitCancelAction({
    ...input,
    action: "cancel",
  });

  return `${marker} ${submit}  ${cancel}`;
}

export function handleWidgetFrameInput<TField>(input: {
  data: string;
  fields: readonly TField[];
  activeField: TField;
  setActiveField: (field: TField) => void;
  submit: () => void;
  cancel: () => void;
}): boolean {
  if (
    matchesKey(input.data, Key.escape) ||
    matchesKey(input.data, Key.ctrl("c"))
  ) {
    input.cancel();
    return true;
  }

  if (matchesKey(input.data, Key.tab)) {
    input.setActiveField(nextItem(input.fields, input.activeField, 1));
    return true;
  }

  if (matchesKey(input.data, Key.shift("tab"))) {
    input.setActiveField(nextItem(input.fields, input.activeField, -1));
    return true;
  }

  if (
    matchesKey(input.data, Key.ctrl("s")) ||
    matchesKey(input.data, Key.ctrl("enter"))
  ) {
    input.submit();
    return true;
  }

  return false;
}

export function handleSubmitCancelActionInput(input: {
  data: string;
  selectedAction: SubmitCancelAction;
  setSelectedAction: (action: SubmitCancelAction) => void;
  submit: () => void;
  cancel: () => void;
  requestRender: () => void;
}): void {
  if (matchesKey(input.data, Key.left)) {
    input.setSelectedAction(
      nextItem(SUBMIT_CANCEL_ACTIONS, input.selectedAction, -1),
    );
    input.requestRender();
    return;
  }

  if (matchesKey(input.data, Key.right)) {
    input.setSelectedAction(
      nextItem(SUBMIT_CANCEL_ACTIONS, input.selectedAction, 1),
    );
    input.requestRender();
    return;
  }

  if (matchesKey(input.data, Key.enter)) {
    if (input.selectedAction === "submit") {
      input.submit();
    } else {
      input.cancel();
    }
  }
}
