import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGitLabMrDiffCommand,
  buildGitLabMrViewCommand,
  normalizeGitLabMrView,
  parseGitLabMrSelector,
} from "../src/gitlab.js";

test("parseGitLabMrSelector parses hosted GitLab merge request URLs", () => {
  assert.deepEqual(
    parseGitLabMrSelector(
      "https://gitlab.com/group/project/-/merge_requests/45",
    ),
    {
      kind: "gitlab",
      selector: "https://gitlab.com/group/project/-/merge_requests/45",
      host: "gitlab.com",
      projectPath: "group/project",
      number: 45,
    },
  );
});

test("parseGitLabMrSelector parses self-hosted nested project URLs", () => {
  assert.deepEqual(
    parseGitLabMrSelector(
      "https://gitlab.example.com/group/sub/project/-/merge_requests/7",
    ),
    {
      kind: "gitlab",
      selector:
        "https://gitlab.example.com/group/sub/project/-/merge_requests/7",
      host: "gitlab.example.com",
      projectPath: "group/sub/project",
      number: 7,
    },
  );
});

test("parseGitLabMrSelector rejects non-GitLab selectors", () => {
  assert.equal(
    parseGitLabMrSelector("https://github.com/owner/repo/pull/1"),
    undefined,
  );
  assert.equal(parseGitLabMrSelector("42"), undefined);
});

test("parseGitLabMrSelector rejects unsupported schemes and unsafe numbers", () => {
  assert.equal(
    parseGitLabMrSelector("ssh://gitlab.com/group/project/-/merge_requests/45"),
    undefined,
  );
  assert.equal(
    parseGitLabMrSelector(
      "https://gitlab.com/group/project/-/merge_requests/0",
    ),
    undefined,
  );
  assert.equal(
    parseGitLabMrSelector(
      "https://gitlab.com/group/project/-/merge_requests/9007199254740992",
    ),
    undefined,
  );
});

test("GitLab command builders use argument arrays", () => {
  const selector = parseGitLabMrSelector(
    "https://gitlab.com/group/project/-/merge_requests/45",
  );
  assert.ok(selector);

  assert.deepEqual(buildGitLabMrViewCommand(selector), {
    command: "glab",
    args: [
      "mr",
      "view",
      "https://gitlab.com/group/project/-/merge_requests/45",
      "--output",
      "json",
    ],
  });
  assert.deepEqual(buildGitLabMrDiffCommand(selector), {
    command: "glab",
    args: [
      "mr",
      "diff",
      "https://gitlab.com/group/project/-/merge_requests/45",
    ],
  });
});

test("normalizeGitLabMrView normalizes glab JSON metadata", () => {
  const metadata = normalizeGitLabMrView(
    JSON.stringify({
      iid: 45,
      title: "Fix auth refresh",
      description: "Rotate token before expiry",
      web_url: "https://gitlab.com/group/project/-/merge_requests/45",
      author: { username: "alice" },
      target_branch: "main",
      source_branch: "auth-refresh",
      changes: [{ new_path: "src/auth.ts" }, { new_path: "README.md" }],
      notes: [{ body: "Existing concern", author: { username: "bob" } }],
    }),
  );

  assert.deepEqual(metadata, {
    provider: "gitlab",
    number: 45,
    title: "Fix auth refresh",
    body: "Rotate token before expiry",
    url: "https://gitlab.com/group/project/-/merge_requests/45",
    author: "alice",
    baseRefName: "main",
    headRefName: "auth-refresh",
    files: ["src/auth.ts", "README.md"],
    existingNotes: ["note by bob: Existing concern"],
  });
});
