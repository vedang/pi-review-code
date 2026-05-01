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

type Harness = ReturnType<typeof createHarness>;

function createHarness(): {
  commands: Map<string, RegisteredCommand["handler"]>;
  notifications: Array<{ message: string; level: string }>;
  ctx: ExtensionCommandContext;
} {
  const commands = new Map<string, RegisteredCommand["handler"]>();
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
  } as unknown as ExtensionAPI;

  reviewCodeExtension(pi);

  return { commands, notifications, ctx };
}

async function runCommand(
  harness: Harness,
  name: string,
  args = "",
): Promise<void> {
  const handler = harness.commands.get(name);
  assert.ok(handler, `expected /${name} command to be registered`);

  await handler(args, harness.ctx);
}

test("extension registers review commands", () => {
  const harness = createHarness();

  assert.ok(harness.commands.has("review"));
  assert.ok(harness.commands.has("review-fix"));
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
