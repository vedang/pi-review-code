import assert from "node:assert/strict";
import test from "node:test";

import { resolveReviewTarget } from "../src/targets.js";
import type { ExecCommand } from "../src/types.js";

function fakeExec(responses: Record<string, string>): ExecCommand {
  return async (command, args) => {
    const key = [command, ...args].join("\0");
    const stdout = responses[key];
    if (stdout === undefined) {
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    }
    return { stdout, stderr: "", exitCode: 0 };
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
      const key = [command, ...args].join("\0");
      calls.push(key);
      const stdout = responses[key];
      if (stdout === undefined) {
        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      }
      return { stdout, stderr: "", exitCode: 0 };
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
        [["git", "--no-pager", "diff", "origin/main", "--name-only"].join(
          "\0",
        )]: "src/a.ts\nsrc/b.ts\n",
        [["git", "--no-pager", "diff", "origin/main", "--stat"].join("\0")]:
          " 2 files changed",
        [["git", "--no-pager", "diff", "origin/main"].join("\0")]:
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
    commandHints: [
      {
        label: "List changed files",
        command: "git",
        args: ["--no-pager", "diff", "origin/main", "--name-only"],
      },
      {
        label: "Show full diff",
        command: "git",
        args: ["--no-pager", "diff", "origin/main"],
      },
      {
        label: "Show diff for a file",
        command: "git",
        args: ["--no-pager", "diff", "origin/main", "--", "<file>"],
      },
    ],
  });
});

test("resolveReviewTarget falls back to jj diff commands when git diff fails", async () => {
  const calls: string[] = [];
  const key = (command: string, args: string[]) =>
    [command, ...args].join("\0");
  const gitListCommand = key("git", [
    "--no-pager",
    "diff",
    "@-",
    "--name-only",
  ]);
  const gitStatCommand = key("git", ["--no-pager", "diff", "@-", "--stat"]);
  const jjListCommand = key("jj", [
    "--no-pager",
    "diff",
    "--from",
    "@-",
    "--name-only",
  ]);
  const jjStatCommand = key("jj", [
    "--no-pager",
    "diff",
    "--from",
    "@-",
    "--stat",
  ]);
  const jjDiffCommand = key("jj", [
    "--no-pager",
    "diff",
    "--from",
    "@-",
    "--git",
  ]);

  const target = await resolveReviewTarget(
    { kind: "diff-against", ref: "@-", targetHint: "@-" },
    {
      exec: async (command, args) => {
        const call = key(command, args);
        calls.push(call);
        if (command === "git") {
          return {
            stdout: "",
            stderr: "fatal: not a git repository",
            exitCode: 128,
          };
        }
        if (call === jjListCommand) {
          return { stdout: "src/a.ts\n", stderr: "", exitCode: 0 };
        }
        if (call === jjStatCommand) {
          return {
            stdout: "1 file changed, 1 insertion(+), 0 deletions(-)",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call === jjDiffCommand) {
          return {
            stdout: "diff --git a/src/a.ts b/src/a.ts\n+change\n",
            stderr: "",
            exitCode: 0,
          };
        }
        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
    },
  );

  assert.equal(target.kind, "diff-against");
  assert.equal(target.ref, "@-");
  assert.deepEqual(target.files, ["src/a.ts"]);
  assert.equal(
    target.diffStat,
    "1 file changed, 1 insertion(+), 0 deletions(-)",
  );
  assert.equal(target.diffText, "diff --git a/src/a.ts b/src/a.ts\n+change\n");
  assert.deepEqual(calls.slice(0, 2), [gitListCommand, gitStatCommand]);
  assert.deepEqual(calls.slice(2), [
    jjListCommand,
    jjStatCommand,
    jjDiffCommand,
  ]);
  assert.deepEqual(target.commandHints, [
    {
      label: "List changed files",
      command: "jj",
      args: ["--no-pager", "diff", "--from", "@-", "--name-only"],
    },
    {
      label: "Show full diff",
      command: "jj",
      args: ["--no-pager", "diff", "--from", "@-", "--git"],
    },
    {
      label: "Show diff for a file",
      command: "jj",
      args: ["--no-pager", "diff", "--from", "@-", "--git", "--", "<file>"],
    },
  ]);
});

test("resolveReviewTarget falls back to jj when git exec throws", async () => {
  const calls: string[] = [];
  const key = (command: string, args: string[]) =>
    [command, ...args].join("\0");
  const ref = "trunk()";
  const jjListCommand = key("jj", [
    "--no-pager",
    "diff",
    "--from",
    ref,
    "--name-only",
  ]);
  const jjStatCommand = key("jj", [
    "--no-pager",
    "diff",
    "--from",
    ref,
    "--stat",
  ]);
  const jjDiffCommand = key("jj", [
    "--no-pager",
    "diff",
    "--from",
    ref,
    "--git",
  ]);

  const target = await resolveReviewTarget(
    { kind: "diff-against", ref, targetHint: ref },
    {
      exec: async (command, args) => {
        const call = key(command, args);
        calls.push(call);
        if (command === "git") {
          throw new Error("spawn git ENOENT");
        }
        if (call === jjListCommand) {
          return { stdout: "src/trunk.ts\n", stderr: "", exitCode: 0 };
        }
        if (call === jjStatCommand) {
          return { stdout: "1 file changed", stderr: "", exitCode: 0 };
        }
        if (call === jjDiffCommand) {
          return {
            stdout: "diff --git a/src/trunk.ts b/src/trunk.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
    },
  );

  assert.equal(target.kind, "diff-against");
  assert.equal(target.ref, ref);
  assert.deepEqual(target.files, ["src/trunk.ts"]);
  assert.equal(target.commandHints[0]?.command, "jj");
  assert.deepEqual(calls.slice(0, 2), [
    key("git", ["--no-pager", "diff", ref, "--name-only"]),
    key("git", ["--no-pager", "diff", ref, "--stat"]),
  ]);
  assert.deepEqual(calls.slice(2), [
    jjListCommand,
    jjStatCommand,
    jjDiffCommand,
  ]);
});

test("resolveReviewTarget skips full diff when diff stat is large", async () => {
  const exec = recordingExec({
    [["git", "--no-pager", "diff", "origin/main", "--name-only"].join("\0")]:
      "src/huge.ts\n",
    [["git", "--no-pager", "diff", "origin/main", "--stat"].join("\0")]:
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
    ["git", "--no-pager", "diff", "origin/main", "--name-only"].join("\0"),
    ["git", "--no-pager", "diff", "origin/main", "--stat"].join("\0"),
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
