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
  assert.deepEqual(buildGitDiffNameOnlyCommand("origin/main"), {
    command: "git",
    args: ["--no-pager", "diff", "origin/main", "--name-only"],
  });
  assert.deepEqual(buildGitDiffStatCommand("origin/main"), {
    command: "git",
    args: ["--no-pager", "diff", "origin/main", "--stat"],
  });
  assert.deepEqual(buildGitDiffCommand("origin/main"), {
    command: "git",
    args: ["--no-pager", "diff", "origin/main"],
  });
  assert.deepEqual(buildGitDiffForFileCommand("origin/main", "src/index.ts"), {
    command: "git",
    args: ["--no-pager", "diff", "origin/main", "--", "src/index.ts"],
  });
  assert.deepEqual(buildJjDiffNameOnlyCommand("@-"), {
    command: "jj",
    args: ["--no-pager", "diff", "--from", "@-", "--name-only"],
  });
  assert.deepEqual(buildJjDiffStatCommand("@-"), {
    command: "jj",
    args: ["--no-pager", "diff", "--from", "@-", "--stat"],
  });
  assert.deepEqual(buildJjDiffCommand("@-"), {
    command: "jj",
    args: ["--no-pager", "diff", "--from", "@-", "--git"],
  });
  assert.deepEqual(buildJjDiffForFileCommand("@-", "src/index.ts"), {
    command: "jj",
    args: ["--no-pager", "diff", "--from", "@-", "--git", "--", "src/index.ts"],
  });
});

test("normalizeGitFileList trims empty diff output lines", () => {
  assert.deepEqual(normalizeGitFileList("src/a.ts\n\n src/b.ts \n"), [
    "src/a.ts",
    "src/b.ts",
  ]);
});
