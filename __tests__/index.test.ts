import assert from "node:assert/strict";
import test from "node:test";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  RegisteredCommand,
} from "@mariozechner/pi-coding-agent";

import reviewCodeExtension, {
  REVIEW_FIX_HELP_TEXT,
  REVIEW_HELP_TEXT,
} from "../src/index";
import { REVIEW_STATE_ENTRY_TYPE } from "../src/state";

type Harness = ReturnType<typeof createHarness>;
type RuntimeHarness = ReturnType<typeof createRuntimeHarness>;
type RegisteredEventHandler = (
  event: unknown,
  ctx: ExtensionCommandContext,
) => unknown;

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

function createRuntimeHarness() {
  const commands = new Map<string, RegisteredCommand["handler"]>();
  const messageRenderers = new Map<string, unknown>();
  const events = new Map<string, RegisteredEventHandler>();
  const registeredTools: unknown[] = [];
  const setActiveToolsCalls: string[][] = [];
  let activeTools = ["read", "bash"];

  const ctx = {
    hasUI: true,
    sessionManager: {
      getEntries: () => [
        {
          type: "custom",
          customType: REVIEW_STATE_ENTRY_TYPE,
          data: {
            version: 1,
            activeKind: "review",
            originLeafId: "leaf-origin",
            runId: "review-1",
            targetHint: "origin/main",
            reviewPrompt: "Review diff",
            originModelProvider: "anthropic",
            originModelId: "claude-sonnet",
            originThinkingLevel: "high",
          },
        },
      ],
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
    on: (eventName: string, handler: RegisteredEventHandler) => {
      events.set(eventName, handler);
    },
    registerTool: (tool: unknown) => {
      registeredTools.push(tool);
    },
    appendEntry: () => {},
    getActiveTools: () => activeTools,
    setActiveTools: (toolNames: string[]) => {
      setActiveToolsCalls.push(toolNames);
      activeTools = toolNames;
    },
    sendMessage: () => {},
    sendUserMessage: () => {},
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

test("extension registers review commands and message renderers", () => {
  const harness = createHarness();

  assert.ok(harness.commands.has("review"));
  assert.ok(harness.commands.has("review-fix"));
  assert.ok(harness.messageRenderers.has("pi-review-code:prompt"));
  assert.ok(harness.messageRenderers.has("pi-review-code:review-summary"));
  assert.ok(harness.messageRenderers.has("pi-review-code:review-fix-summary"));
});

test("/review shows scaffold help", async () => {
  const harness = createHarness();

  await runCommand(harness, "review");

  assert.deepEqual(harness.notifications, [
    { message: REVIEW_HELP_TEXT, level: "info" },
  ]);
});

test("/review-fix shows scaffold help", async () => {
  const harness = createHarness();

  await runCommand(harness, "review-fix");

  assert.deepEqual(harness.notifications, [
    { message: REVIEW_FIX_HELP_TEXT, level: "info" },
  ]);
});

test("extension refreshes persisted active review state on session_start", async () => {
  const harness = createRuntimeHarness();
  const handler = harness.events.get("session_start");

  assert.ok(handler, "expected session_start handler to be registered");
  assert.equal(harness.registeredTools.length, 1);

  await handler({ type: "session_start", reason: "reload" }, harness.ctx);

  assert.deepEqual(harness.setActiveToolsCalls, [
    ["read", "bash", "add_review_comment"],
  ]);
});
