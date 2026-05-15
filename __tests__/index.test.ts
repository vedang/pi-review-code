import assert from "node:assert/strict";
import test from "node:test";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  RegisteredCommand,
} from "@mariozechner/pi-coding-agent";

import { REVIEW_ANCHOR_MESSAGE_TYPE } from "../src/flow.js";
import reviewCodeExtension, {
  REVIEW_FIX_HELP_TEXT,
  REVIEW_HELP_TEXT,
} from "../src/index.js";
import { REVIEW_STATE_ENTRY_TYPE } from "../src/state.js";

type Harness = ReturnType<typeof createHarness>;
type RuntimeHarness = ReturnType<typeof createRuntimeHarness>;
type RegisteredEventHandler = (
  event: unknown,
  ctx: ExtensionCommandContext,
) => unknown;

type RuntimeHarnessOptions = {
  stateData?: unknown;
  customResult?: unknown;
  initialLeafId?: string | null;
  anchorLeafId?: string;
};

function persistedReviewState(): Record<string, unknown> {
  return {
    version: 1,
    activeKind: "review",
    originLeafId: "leaf-origin",
    runId: "review-1",
    targetHint: "origin/main",
    reviewPrompt: "Review diff",
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "high",
  };
}

function persistedMetaState(): Record<string, unknown> {
  return {
    version: 1,
    activeKind: "meta",
    originLeafId: "leaf-origin",
    runId: "meta-1",
    targetHint: "origin/main",
    metaPrompt: "Create review prompt",
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "high",
  };
}

function persistedFixState(): Record<string, unknown> {
  return {
    version: 1,
    activeKind: "fix",
    originLeafId: "leaf-origin",
    runId: "fix-1",
    targetHint: "origin/main",
    reviewPrompt: "Fix comments",
    originModelProvider: "anthropic",
    originModelId: "claude-sonnet",
    originThinkingLevel: "high",
    sourceReviewRunId: "review-1",
    commentIds: ["comment-1"],
  };
}

function createHarness() {
  const commands = new Map<string, RegisteredCommand["handler"]>();
  const messageRenderers = new Map<string, unknown>();
  const notifications: Array<{ message: string; level: string }> = [];

  const ctx = {
    hasUI: true,
    ui: {
      notify: (message: string, level: string) => {
        notifications.push({ message, level });
      },
    },
  } as unknown as ExtensionCommandContext;

  const pi = {
    registerCommand: (
      name: string,
      options: Omit<RegisteredCommand, "name" | "sourceInfo">,
    ) => {
      commands.set(name, options.handler);
    },
    registerMessageRenderer: (customType: string, renderer: unknown) => {
      messageRenderers.set(customType, renderer);
    },
  } as unknown as ExtensionAPI;

  reviewCodeExtension(pi);

  return { commands, messageRenderers, notifications, ctx };
}

function createRuntimeHarness(options: RuntimeHarnessOptions = {}) {
  const commands = new Map<string, RegisteredCommand["handler"]>();
  const messageRenderers = new Map<string, unknown>();
  const events = new Map<string, RegisteredEventHandler>();
  const registeredTools: unknown[] = [];
  const setActiveToolsCalls: string[][] = [];
  const appended: Array<{ customType: string; data: unknown }> = [];
  const notifications: Array<{ message: string; level: string }> = [];
  const customWidgetCalls: Array<{ options: unknown }> = [];
  const sentMessages: Array<{ message: unknown; options: unknown }> = [];
  const sentUserMessages: string[] = [];
  let activeTools = ["read", "bash", "add_review_comment"];
  let leafId =
    options.initialLeafId === undefined ? "leaf-origin" : options.initialLeafId;
  const anchorLeafId = options.anchorLeafId ?? "leaf-anchor";

  const ctx = {
    hasUI: true,
    model: { provider: "anthropic", id: "claude-sonnet" },
    modelRegistry: { registry: true },
    ui: {
      notify: (message: string, level: string) => {
        notifications.push({ message, level });
      },
      custom: async (_createWidget: unknown, widgetOptions: unknown) => {
        customWidgetCalls.push({ options: widgetOptions });
        return options.customResult ?? { submitted: false };
      },
    },
    sessionManager: {
      getLeafId: () => leafId,
      getEntries: () => [
        {
          type: "custom",
          customType: REVIEW_STATE_ENTRY_TYPE,
          data: options.stateData ?? persistedReviewState(),
        },
      ],
    },
    waitForIdle: async () => {},
    isIdle: () => true,
    hasPendingMessages: () => false,
  } as unknown as ExtensionCommandContext;

  const pi = {
    registerCommand: (
      name: string,
      options: Omit<RegisteredCommand, "name" | "sourceInfo">,
    ) => {
      commands.set(name, options.handler);
    },
    registerMessageRenderer: (customType: string, renderer: unknown) => {
      messageRenderers.set(customType, renderer);
    },
    on: (eventName: string, handler: RegisteredEventHandler) => {
      events.set(eventName, handler);
    },
    registerTool: (tool: unknown) => {
      registeredTools.push(tool);
    },
    appendEntry: (customType: string, data: unknown) => {
      appended.push({ customType, data });
    },
    getActiveTools: () => activeTools,
    setActiveTools: (toolNames: string[]) => {
      setActiveToolsCalls.push(toolNames);
      activeTools = toolNames;
    },
    sendMessage: (message: unknown, sendOptions: unknown) => {
      sentMessages.push({ message, options: sendOptions });
      if (
        typeof message === "object" &&
        message !== null &&
        "customType" in message &&
        message.customType === REVIEW_ANCHOR_MESSAGE_TYPE &&
        sendOptions !== undefined
      ) {
        leafId = anchorLeafId;
      }
    },
    sendUserMessage: (message: string) => {
      sentUserMessages.push(message);
    },
    exec: async () => ({ stdout: "", stderr: "", code: 0 }),
    getThinkingLevel: () => "high",
  } as unknown as ExtensionAPI;

  reviewCodeExtension(pi);

  return {
    commands,
    events,
    messageRenderers,
    registeredTools,
    setActiveToolsCalls,
    appended,
    notifications,
    customWidgetCalls,
    sentMessages,
    sentUserMessages,
    ctx,
  };
}

async function runCommand(
  harness: Harness | RuntimeHarness,
  name: string,
  args = "",
): Promise<void> {
  const handler = harness.commands.get(name);
  assert.ok(handler, `expected /${name} command to be registered`);

  await handler(args, harness.ctx);
}

function assertSingleNotification(
  harness: Harness | RuntimeHarness,
  message: string,
  level = "info",
): void {
  assert.deepEqual(harness.notifications, [{ message, level }]);
}

test("extension registers review commands and message renderers", () => {
  const harness = createHarness();

  assert.ok(harness.commands.has("review"));
  assert.ok(harness.commands.has("review-fix"));
  assert.equal(harness.commands.has("review-diff-against"), false);
  assert.equal(harness.commands.has("review-pr"), false);
  assert.ok(harness.messageRenderers.has("pi-review-code:prompt"));
  assert.ok(harness.messageRenderers.has("pi-review-code:review-summary"));
  assert.ok(harness.messageRenderers.has("pi-review-code:review-fix-summary"));
});

const scaffoldHelpCases = [
  ["review", REVIEW_HELP_TEXT],
  ["review-fix", REVIEW_FIX_HELP_TEXT],
] as const;

for (const [commandName, expectedHelp] of scaffoldHelpCases) {
  test(`/${commandName} shows scaffold help without runtime support`, async () => {
    const harness = createHarness();

    await runCommand(harness, commandName);

    assertSingleNotification(harness, expectedHelp);
  });
}

test("/review-fix opens runtime fix widget with empty args", async () => {
  const harness = createRuntimeHarness();

  await runCommand(harness, "review-fix");

  assert.equal(harness.customWidgetCalls.length, 1);
  assert.equal(harness.customWidgetCalls[0]?.options, undefined);
  assertSingleNotification(harness, "Review-fix cancelled.");
});

test("/review-fix rejects runtime selector args", async () => {
  const harness = createRuntimeHarness();

  await runCommand(harness, "review-fix", "latest");

  assert.deepEqual(harness.customWidgetCalls, []);
  assertSingleNotification(
    harness,
    "Run /review-fix and select findings in the widget.",
  );
});

test("/review opens runtime input widget", async () => {
  const harness = createRuntimeHarness();

  await runCommand(harness, "review");

  assert.equal(harness.customWidgetCalls.length, 1);
  assert.equal(harness.customWidgetCalls[0]?.options, undefined);
  assertSingleNotification(harness, "Review cancelled.");
});

test("/review forwards anchor sendMessage options on empty sessions", async () => {
  const harness = createRuntimeHarness({
    initialLeafId: null,
    customResult: {
      submitted: true,
      kind: "review",
      primaryValue: "review auth boundaries",
    },
  });

  await runCommand(harness, "review");

  assert.equal(
    (harness.sentMessages[0]?.message as { customType?: string }).customType,
    REVIEW_ANCHOR_MESSAGE_TYPE,
  );
  assert.deepEqual(harness.sentMessages[0]?.options, { triggerTurn: false });
  assert.match(harness.sentUserMessages[0] ?? "", /Review prompt meta-pass/);
});

test("runtime does not register legacy selector commands", () => {
  const harness = createRuntimeHarness();

  assert.equal(harness.commands.has("review-diff-against"), false);
  assert.equal(harness.commands.has("review-pr"), false);
});

test("runtime registers review lifecycle hooks", () => {
  const harness = createRuntimeHarness();

  assert.ok(harness.events.has("before_agent_start"));
  assert.ok(harness.events.has("tool_call"));
  assert.ok(harness.events.has("agent_end"));
  assert.ok(harness.events.has("session_before_tree"));
});

const persistedActiveStateCases = [
  {
    name: "review",
    stateData: persistedReviewState(),
    message:
      "Abandoned persisted pi-review-code review review-1 after extension reload; start /review again.",
  },
  {
    name: "meta",
    stateData: persistedMetaState(),
    message:
      "Abandoned persisted pi-review-code review prompt meta-pass meta-1 after extension reload; start /review again.",
  },
  {
    name: "fix",
    stateData: persistedFixState(),
    message:
      "Abandoned persisted pi-review-code fix fix-1 after extension reload; start /review-fix again.",
  },
] as const;

for (const { name, stateData, message } of persistedActiveStateCases) {
  test(`extension abandons persisted active ${name} state on session_start`, async () => {
    const harness = createRuntimeHarness({ stateData });
    const handler = harness.events.get("session_start");

    assert.ok(handler, "expected session_start handler to be registered");
    assert.deepEqual(
      harness.registeredTools.map((tool) => (tool as { name?: string }).name),
      ["add_review_comment", "set_review_prompt"],
    );

    await handler({ type: "session_start", reason: "reload" }, harness.ctx);

    assert.deepEqual(harness.setActiveToolsCalls, [["read", "bash"]]);
    assert.deepEqual(harness.appended, [
      {
        customType: REVIEW_STATE_ENTRY_TYPE,
        data: { version: 1, activeKind: null },
      },
    ]);
    assert.deepEqual(harness.notifications, [{ message, level: "warning" }]);
  });
}
