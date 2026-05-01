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

test("resolveReviewTarget resolves diff-against with safe command hints", async () => {
  const target = await resolveReviewTarget(
    { kind: "diff-against", ref: "origin/main", targetHint: "origin/main" },
    {
      exec: fakeExec({
        [["git", "--no-pager", "diff", "origin/main", "--name-only"].join(
          "\0",
        )]: "src/a.ts\nsrc/b.ts\n",
        [["git", "--no-pager", "diff", "origin/main", "--stat"].join("\0")]:
          " 2 files changed",
      }),
    },
  );

  assert.deepEqual(target, {
    kind: "diff-against",
    targetHint: "origin/main",
    ref: "origin/main",
    files: ["src/a.ts", "src/b.ts"],
    diffStat: "2 files changed",
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
    /Invalid git ref/,
  );
  assert.equal(called, false);
});

test("resolveReviewTarget preserves prompt targets without executing commands", async () => {
  const target = await resolveReviewTarget(
    {
      kind: "prompt",
      prompt: "review schema names",
      targetHint: "review schema names",
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
