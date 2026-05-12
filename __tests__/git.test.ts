import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGitDiffCommand,
  buildGitDiffForFileCommand,
  buildGitDiffNameOnlyCommand,
  buildGitDiffStatCommand,
  buildJjDiffCommand,
  buildJjDiffForFileCommand,
  buildJjDiffNameOnlyCommand,
  buildJjDiffStatCommand,
  normalizeGitFileList,
  validateDiffRef,
} from "../src/git.js";

test("validateDiffRef accepts git refs, change ids, and safe jj selectors", () => {
  assert.equal(validateDiffRef("origin/main").ok, true);
  assert.equal(validateDiffRef("feature/review-123").ok, true);
  assert.equal(validateDiffRef("abc123def456").ok, true);
  assert.equal(validateDiffRef("refs/heads/main").ok, true);
  assert.equal(validateDiffRef("@").ok, true);
  assert.equal(validateDiffRef("@-").ok, true);
  assert.equal(validateDiffRef("@--").ok, true);
  assert.equal(validateDiffRef("main@origin").ok, true);
  assert.equal(validateDiffRef("trunk()").ok, true);
});

test("validateDiffRef rejects dangerous or ambiguous refs", () => {
  const rejectedRefs = [
    "",
    "  ",
    "origin/main; rm -rf /",
    "origin/main && whoami",
    "$(whoami)",
    "bad`cmd`",
    "bad\nref",
    "bad\0ref",
    "two words",
    "../main",
    "main..feature",
    "present(main)",
  ];

  for (const ref of rejectedRefs) {
    const result = validateDiffRef(ref);
    assert.equal(result.ok, false, `${JSON.stringify(ref)} should be rejected`);
    assert.match(result.error, /Invalid diff ref/);
  }
});

const GIT_REF = "origin/main";

function gitDiffArgs(ref: string, ...args: string[]) {
  return ["--no-pager", "diff", `${ref}...HEAD`, ...args];
}

function jjDiffArgs(ref: string, ...args: string[]) {
  return ["--no-pager", "diff", "--from", ref, ...args];
}

test("git and jj diff command builders use argument arrays", () => {
  const cases = [
    [
      buildGitDiffNameOnlyCommand(GIT_REF),
      "git",
      gitDiffArgs(GIT_REF, "--name-only"),
    ],
    [buildGitDiffStatCommand(GIT_REF), "git", gitDiffArgs(GIT_REF, "--stat")],
    [buildGitDiffCommand(GIT_REF), "git", gitDiffArgs(GIT_REF)],
    [
      buildGitDiffForFileCommand(GIT_REF, "src/index.ts"),
      "git",
      gitDiffArgs(GIT_REF, "--", "src/index.ts"),
    ],
    [buildJjDiffNameOnlyCommand("@-"), "jj", jjDiffArgs("@-", "--name-only")],
    [buildJjDiffStatCommand("@-"), "jj", jjDiffArgs("@-", "--stat")],
    [buildJjDiffCommand("@-"), "jj", jjDiffArgs("@-", "--git")],
    [
      buildJjDiffForFileCommand("@-", "src/index.ts"),
      "jj",
      jjDiffArgs("@-", "--git", "--", "src/index.ts"),
    ],
  ] as const;

  for (const [actual, command, args] of cases) {
    assert.deepEqual(actual, { command, args: [...args] });
  }
});

test("normalizeGitFileList trims empty diff output lines", () => {
  assert.deepEqual(normalizeGitFileList("src/a.ts\n\n src/b.ts \n"), [
    "src/a.ts",
    "src/b.ts",
  ]);
});
