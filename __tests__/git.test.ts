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

test("git and jj diff command builders use argument arrays", () => {
  const cases = [
    [
      buildGitDiffNameOnlyCommand("origin/main"),
      "git",
      ["--no-pager", "diff", "origin/main...HEAD", "--name-only"],
    ],
    [
      buildGitDiffStatCommand("origin/main"),
      "git",
      ["--no-pager", "diff", "origin/main...HEAD", "--stat"],
    ],
    [
      buildGitDiffCommand("origin/main"),
      "git",
      ["--no-pager", "diff", "origin/main...HEAD"],
    ],
    [
      buildGitDiffForFileCommand("origin/main", "src/index.ts"),
      "git",
      ["--no-pager", "diff", "origin/main...HEAD", "--", "src/index.ts"],
    ],
    [
      buildJjDiffNameOnlyCommand("@-"),
      "jj",
      ["--no-pager", "diff", "--from", "@-", "--name-only"],
    ],
    [
      buildJjDiffStatCommand("@-"),
      "jj",
      ["--no-pager", "diff", "--from", "@-", "--stat"],
    ],
    [
      buildJjDiffCommand("@-"),
      "jj",
      ["--no-pager", "diff", "--from", "@-", "--git"],
    ],
    [
      buildJjDiffForFileCommand("@-", "src/index.ts"),
      "jj",
      ["--no-pager", "diff", "--from", "@-", "--git", "--", "src/index.ts"],
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
