import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGitDiffCommand,
  buildGitDiffForFileCommand,
  buildGitDiffNameOnlyCommand,
  buildGitDiffStatCommand,
  normalizeGitFileList,
  validateGitRef,
} from "../src/git";

test("validateGitRef accepts ordinary branch refs and change ids", () => {
  assert.equal(validateGitRef("origin/main").ok, true);
  assert.equal(validateGitRef("feature/review-123").ok, true);
  assert.equal(validateGitRef("abc123def456").ok, true);
  assert.equal(validateGitRef("refs/heads/main").ok, true);
});

test("validateGitRef rejects dangerous or ambiguous refs", () => {
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
  ];

  for (const ref of rejectedRefs) {
    const result = validateGitRef(ref);
    assert.equal(result.ok, false, `${JSON.stringify(ref)} should be rejected`);
    assert.match(result.error, /Invalid git ref/);
  }
});

test("git diff command builders use argument arrays", () => {
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
});

test("normalizeGitFileList trims empty diff output lines", () => {
  assert.deepEqual(normalizeGitFileList("src/a.ts\n\n src/b.ts \n"), [
    "src/a.ts",
    "src/b.ts",
  ]);
});
