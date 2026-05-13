import assert from "node:assert/strict";
import test from "node:test";

import { resolveReviewTarget } from "../src/targets.js";
import type { ExecCommand } from "../src/types.js";

function commandKey(command: string, args: string[]): string {
  return [command, ...args].join("\0");
}

function gitDiffArgs(ref: string, ...args: string[]): string[] {
  return ["--no-pager", "diff", `${ref}...HEAD`, ...args];
}

function jjDiffArgs(ref: string, ...args: string[]): string[] {
  return ["--no-pager", "diff", "--from", ref, ...args];
}

function gitDiffKey(ref: string, ...args: string[]): string {
  return commandKey("git", gitDiffArgs(ref, ...args));
}

function jjDiffKey(ref: string, ...args: string[]): string {
  return commandKey("jj", jjDiffArgs(ref, ...args));
}

function gitDiffCommandHints(ref: string) {
  return [
    {
      label: "List changed files",
      command: "git",
      args: gitDiffArgs(ref, "--name-only"),
    },
    {
      label: "Show full diff",
      command: "git",
      args: gitDiffArgs(ref),
    },
    {
      label: "Show diff for a file",
      command: "git",
      args: gitDiffArgs(ref, "--", "<file>"),
    },
  ] as const;
}

function jjDiffCommandHints(ref: string) {
  return [
    {
      label: "List changed files",
      command: "jj",
      args: jjDiffArgs(ref, "--name-only"),
    },
    {
      label: "Show full diff",
      command: "jj",
      args: jjDiffArgs(ref, "--git"),
    },
    {
      label: "Show diff for a file",
      command: "jj",
      args: jjDiffArgs(ref, "--git", "--", "<file>"),
    },
  ] as const;
}

type ExecResult = Awaited<ReturnType<ExecCommand>>;

function execOk(stdout: string): ExecResult {
  return { stdout, stderr: "", exitCode: 0 };
}

function execFailed(stderr: string, exitCode = 128): ExecResult {
  return { stdout: "", stderr, exitCode };
}

function fakeExec(responses: Record<string, string>): ExecCommand {
  return async (command, args) => {
    const key = commandKey(command, args);
    const stdout = responses[key];
    if (stdout === undefined) {
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    }
    return execOk(stdout);
  };
}

function recordingExec(responses: Record<string, string>): {
  exec: ExecCommand;
  calls: string[];
} {
  const calls: string[] = [];

  return {
    calls,
    exec: async (command, args) => {
      const key = commandKey(command, args);
      calls.push(key);
      const stdout = responses[key];
      if (stdout === undefined) {
        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      }
      return execOk(stdout);
    },
  };
}

test("resolveReviewTarget resolves diff-against with safe command hints", async () => {
  const target = await resolveReviewTarget(
    {
      kind: "diff-against",
      ref: "origin/main",
      targetHint: "origin/main",
      reviewContext: "Focus auth boundary changes.",
    },
    {
      exec: fakeExec({
        [gitDiffKey("origin/main", "--name-only")]: "src/a.ts\nsrc/b.ts\n",
        [gitDiffKey("origin/main", "--stat")]: " 2 files changed",
        [gitDiffKey("origin/main")]:
          "diff --git a/src/a.ts b/src/a.ts\n+change\n",
      }),
    },
  );

  assert.deepEqual(target, {
    kind: "diff-against",
    targetHint: "origin/main",
    ref: "origin/main",
    reviewContext: "Focus auth boundary changes.",
    files: ["src/a.ts", "src/b.ts"],
    diffStat: "2 files changed",
    diffText: "diff --git a/src/a.ts b/src/a.ts\n+change\n",
    commandHints: gitDiffCommandHints("origin/main"),
  });
});

for (const scenario of [
  { name: "when git exits nonzero", ref: "@-", filePath: "src/a.ts" },
  { name: "when git exec throws", ref: "trunk()", filePath: "src/trunk.ts" },
] as const) {
  test(`resolveReviewTarget falls back to jj ${scenario.name}`, async () => {
    const calls: string[] = [];
    const gitListCommand = gitDiffKey(scenario.ref, "--name-only");
    const gitStatCommand = gitDiffKey(scenario.ref, "--stat");
    const jjListCommand = jjDiffKey(scenario.ref, "--name-only");
    const jjStatCommand = jjDiffKey(scenario.ref, "--stat");
    const jjDiffCommand = jjDiffKey(scenario.ref, "--git");

    const target = await resolveReviewTarget(
      { kind: "diff-against", ref: scenario.ref, targetHint: scenario.ref },
      {
        exec: async (command, args) => {
          const call = commandKey(command, args);
          calls.push(call);
          if (command === "git") {
            if (scenario.name === "when git exec throws") {
              throw new Error("spawn git ENOENT");
            }
            return execFailed("fatal: not a git repository");
          }
          if (call === jjListCommand) {
            return execOk(`${scenario.filePath}\n`);
          }
          if (call === jjStatCommand) {
            return execOk("1 file changed");
          }
          if (call === jjDiffCommand) {
            return execOk(
              `diff --git a/${scenario.filePath} b/${scenario.filePath}\n`,
            );
          }
          throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        },
      },
    );

    assert.equal(target.kind, "diff-against");
    assert.equal(target.ref, scenario.ref);
    assert.deepEqual(target.files, [scenario.filePath]);
    assert.equal(target.diffStat, "1 file changed");
    assert.equal(
      target.diffText,
      `diff --git a/${scenario.filePath} b/${scenario.filePath}\n`,
    );
    assert.deepEqual(calls.slice(0, 2), [gitListCommand, gitStatCommand]);
    assert.deepEqual(calls.slice(2), [
      jjListCommand,
      jjStatCommand,
      jjDiffCommand,
    ]);
    assert.deepEqual(target.commandHints, jjDiffCommandHints(scenario.ref));
  });
}

test("resolveReviewTarget falls back to jj remote bookmark for origin/main", async () => {
  const calls: string[] = [];
  const ref = "origin/main";
  const jjRef = "main@origin";
  const gitListCommand = gitDiffKey(ref, "--name-only");
  const gitStatCommand = gitDiffKey(ref, "--stat");
  const originalJjListCommand = jjDiffKey(ref, "--name-only");
  const originalJjStatCommand = jjDiffKey(ref, "--stat");
  const translatedJjListCommand = jjDiffKey(jjRef, "--name-only");
  const translatedJjStatCommand = jjDiffKey(jjRef, "--stat");
  const translatedJjDiffCommand = jjDiffKey(jjRef, "--git");

  const target = await resolveReviewTarget(
    { kind: "diff-against", ref, targetHint: ref },
    {
      exec: async (command, args) => {
        const call = commandKey(command, args);
        calls.push(call);
        if (command === "git") {
          return execFailed(
            "fatal: ambiguous argument 'origin/main...HEAD': unknown revision or path not in the working tree.",
          );
        }
        if (call === originalJjListCommand || call === originalJjStatCommand) {
          return execFailed("Error: Revision `origin/main` doesn't exist", 1);
        }
        if (call === translatedJjListCommand) {
          return execOk("src/changed.ts\n");
        }
        if (call === translatedJjStatCommand) {
          return execOk("1 file changed");
        }
        if (call === translatedJjDiffCommand) {
          return execOk(
            "diff --git a/src/changed.ts b/src/changed.ts\n+new code\n",
          );
        }
        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
    },
  );

  assert.equal(target.kind, "diff-against");
  assert.equal(target.ref, ref);
  assert.deepEqual(target.files, ["src/changed.ts"]);
  assert.equal(target.diffStat, "1 file changed");
  assert.equal(
    target.diffText,
    "diff --git a/src/changed.ts b/src/changed.ts\n+new code\n",
  );
  assert.deepEqual(calls.slice(0, 2), [gitListCommand, gitStatCommand]);
  assert.deepEqual(calls.slice(2), [
    originalJjListCommand,
    originalJjStatCommand,
    translatedJjListCommand,
    translatedJjStatCommand,
    translatedJjDiffCommand,
  ]);
  assert.deepEqual(target.commandHints, jjDiffCommandHints(jjRef));
});

test("resolveReviewTarget keeps slash-named jj refs before translating", async () => {
  const calls: string[] = [];
  const ref = "feature/review-123";
  const gitListCommand = gitDiffKey(ref, "--name-only");
  const gitStatCommand = gitDiffKey(ref, "--stat");
  const jjListCommand = jjDiffKey(ref, "--name-only");
  const jjStatCommand = jjDiffKey(ref, "--stat");
  const jjDiffCommand = jjDiffKey(ref, "--git");

  const target = await resolveReviewTarget(
    { kind: "diff-against", ref, targetHint: ref },
    {
      exec: async (command, args) => {
        const call = commandKey(command, args);
        calls.push(call);
        if (command === "git") {
          return execFailed("fatal: not a git repository");
        }
        if (call === jjListCommand) {
          return execOk("src/native-jj.ts\n");
        }
        if (call === jjStatCommand) {
          return execOk("1 file changed");
        }
        if (call === jjDiffCommand) {
          return execOk(
            "diff --git a/src/native-jj.ts b/src/native-jj.ts\n+native jj\n",
          );
        }
        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
    },
  );

  assert.equal(target.kind, "diff-against");
  assert.deepEqual(target.files, ["src/native-jj.ts"]);
  assert.equal(target.diffStat, "1 file changed");
  assert.deepEqual(calls.slice(0, 2), [gitListCommand, gitStatCommand]);
  assert.deepEqual(calls.slice(2), [
    jjListCommand,
    jjStatCommand,
    jjDiffCommand,
  ]);
  assert.deepEqual(target.commandHints, jjDiffCommandHints(ref));
});

test("resolveReviewTarget skips full diff when diff stat is large", async () => {
  const exec = recordingExec({
    [gitDiffKey("origin/main", "--name-only")]: "src/huge.ts\n",
    [gitDiffKey("origin/main", "--stat")]:
      " src/huge.ts | 10000 +++++++++++++++++++++++++++++++++++++\n 1 file changed, 10000 insertions(+)",
  });

  const target = await resolveReviewTarget(
    { kind: "diff-against", ref: "origin/main", targetHint: "origin/main" },
    { exec: exec.exec },
  );

  assert.equal(target.kind, "diff-against");
  assert.deepEqual(target.files, ["src/huge.ts"]);
  assert.equal("diffText" in target, false);
  assert.deepEqual(exec.calls, [
    gitDiffKey("origin/main", "--name-only"),
    gitDiffKey("origin/main", "--stat"),
  ]);
});

test("resolveReviewTarget rejects unsafe diff refs before exec", async () => {
  let called = false;
  await assert.rejects(
    () =>
      resolveReviewTarget(
        {
          kind: "diff-against",
          ref: "origin/main; rm -rf /",
          targetHint: "origin/main; rm -rf /",
        },
        {
          exec: async () => {
            called = true;
            return { stdout: "", stderr: "", exitCode: 0 };
          },
        },
      ),
    /Invalid diff ref/,
  );
  assert.equal(called, false);
});

test("resolveReviewTarget preserves prompt targets without executing commands", async () => {
  const target = await resolveReviewTarget(
    {
      kind: "prompt",
      prompt: "review schema names",
      targetHint: "review schema names",
      reviewContext: "Check API compatibility.",
    },
    {
      exec: async () => {
        throw new Error("should not execute");
      },
    },
  );

  assert.deepEqual(target, {
    kind: "prompt",
    targetHint: "review schema names",
    prompt: "review schema names",
    reviewContext: "Check API compatibility.",
    commandHints: [
      {
        label: "Inspect repository files",
        command: "find",
        args: [".", "-type", "f"],
      },
      { label: "Search codebase", command: "rg", args: ["<query>"] },
    ],
  });
});

test("resolveReviewTarget resolves GitHub PR metadata with fake exec", async () => {
  const target = await resolveReviewTarget(
    {
      kind: "pr",
      selector: "https://github.com/owner/repo/pull/123",
      targetHint: "https://github.com/owner/repo/pull/123",
      reviewContext: "Audit refresh-token race conditions.",
    },
    {
      exec: fakeExec({
        [[
          "gh",
          "pr",
          "view",
          "https://github.com/owner/repo/pull/123",
          "--json",
          "number,title,body,url,author,baseRefName,headRefName,comments,reviews,files",
        ].join("\0")]: JSON.stringify({
          number: 123,
          title: "Fix auth",
          url: "https://github.com/owner/repo/pull/123",
          author: { login: "alice" },
          files: [{ path: "src/auth.ts" }],
        }),
      }),
    },
  );

  assert.equal(target.kind, "pr");
  assert.equal(target.provider, "github");
  assert.equal(target.reviewContext, "Audit refresh-token race conditions.");
  assert.deepEqual(target.files, ["src/auth.ts"]);
  assert.deepEqual(target.commandHints, [
    {
      label: "Show PR diff",
      command: "gh",
      args: ["pr", "diff", "https://github.com/owner/repo/pull/123"],
    },
  ]);
});

test("resolveReviewTarget resolves GitLab MR metadata with fake exec", async () => {
  const target = await resolveReviewTarget(
    {
      kind: "pr",
      selector: "https://gitlab.com/group/project/-/merge_requests/45",
      targetHint: "https://gitlab.com/group/project/-/merge_requests/45",
      reviewContext: "Check GitLab pipeline assumptions.",
    },
    {
      exec: fakeExec({
        [[
          "glab",
          "mr",
          "view",
          "https://gitlab.com/group/project/-/merge_requests/45",
          "--output",
          "json",
        ].join("\0")]: JSON.stringify({
          iid: 45,
          title: "Fix auth",
          web_url: "https://gitlab.com/group/project/-/merge_requests/45",
          author: { username: "alice" },
          changes: [{ new_path: "src/auth.ts" }],
        }),
      }),
    },
  );

  assert.equal(target.kind, "pr");
  assert.equal(target.provider, "gitlab");
  assert.equal(target.reviewContext, "Check GitLab pipeline assumptions.");
  assert.deepEqual(target.files, ["src/auth.ts"]);
  assert.deepEqual(target.commandHints, [
    {
      label: "Show MR diff",
      command: "glab",
      args: [
        "mr",
        "diff",
        "https://gitlab.com/group/project/-/merge_requests/45",
      ],
    },
  ]);
});

test("resolveReviewTarget rejects PR URLs with search before exec", async () => {
  let called = false;

  await assert.rejects(
    () =>
      resolveReviewTarget(
        {
          kind: "pr",
          selector:
            "https://github.com/owner/repo/pull/123?x=$(touch%20/tmp/pwn)",
          targetHint:
            "https://github.com/owner/repo/pull/123?x=$(touch%20/tmp/pwn)",
        },
        {
          exec: async () => {
            called = true;
            return { stdout: "", stderr: "", exitCode: 0 };
          },
        },
      ),
    /Unsupported PR\/MR selector/,
  );
  assert.equal(called, false);
});

test("resolveReviewTarget rejects unrecognized PR selectors", async () => {
  await assert.rejects(
    () =>
      resolveReviewTarget(
        { kind: "pr", selector: "not a pr", targetHint: "not a pr" },
        { exec: fakeExec({}) },
      ),
    /Unsupported PR\/MR selector/,
  );
});
