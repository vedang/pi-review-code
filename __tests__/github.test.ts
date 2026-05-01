import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGitHubPrDiffCommand,
  buildGitHubPrViewCommand,
  normalizeGitHubPrView,
  parseGitHubPrSelector,
} from "../src/github.js";

test("parseGitHubPrSelector parses GitHub pull request URLs", () => {
  assert.deepEqual(
    parseGitHubPrSelector("https://github.com/owner/repo/pull/123"),
    {
      kind: "github",
      selector: "https://github.com/owner/repo/pull/123",
      owner: "owner",
      repo: "repo",
      number: 123,
    },
  );
});

test("parseGitHubPrSelector parses number selectors", () => {
  assert.deepEqual(parseGitHubPrSelector("42"), {
    kind: "github",
    selector: "42",
    number: 42,
  });
});

test("parseGitHubPrSelector canonicalizes URLs and rejects search or hash", () => {
  assert.deepEqual(
    parseGitHubPrSelector(" HTTPS://github.com/owner/repo/pull/123/ "),
    {
      kind: "github",
      selector: "https://github.com/owner/repo/pull/123",
      owner: "owner",
      repo: "repo",
      number: 123,
    },
  );
  assert.equal(
    parseGitHubPrSelector(
      "https://github.com/owner/repo/pull/123?x=$(touch%20/tmp/pwn)",
    ),
    undefined,
  );
  assert.equal(
    parseGitHubPrSelector("https://github.com/owner/repo/pull/123#notes"),
    undefined,
  );
});

test("parseGitHubPrSelector rejects non-GitHub selectors", () => {
  assert.equal(
    parseGitHubPrSelector(
      "https://gitlab.com/group/project/-/merge_requests/1",
    ),
    undefined,
  );
  assert.equal(parseGitHubPrSelector("not a pr"), undefined);
});

test("parseGitHubPrSelector rejects unsupported schemes and unsafe numbers", () => {
  assert.equal(
    parseGitHubPrSelector("ssh://github.com/owner/repo/pull/123"),
    undefined,
  );
  assert.equal(parseGitHubPrSelector("0"), undefined);
  assert.equal(parseGitHubPrSelector("9007199254740992"), undefined);
  assert.equal(
    parseGitHubPrSelector("https://github.com/owner/repo/pull/0"),
    undefined,
  );
});

test("GitHub command builders use argument arrays", () => {
  const selector = parseGitHubPrSelector(
    "https://github.com/owner/repo/pull/123",
  );
  assert.ok(selector);

  assert.deepEqual(buildGitHubPrViewCommand(selector), {
    command: "gh",
    args: [
      "pr",
      "view",
      "https://github.com/owner/repo/pull/123",
      "--json",
      "number,title,body,url,author,baseRefName,headRefName,comments,reviews,files",
    ],
  });
  assert.deepEqual(buildGitHubPrDiffCommand(selector), {
    command: "gh",
    args: ["pr", "diff", "https://github.com/owner/repo/pull/123"],
  });
});

test("normalizeGitHubPrView normalizes gh JSON metadata", () => {
  const metadata = normalizeGitHubPrView(
    JSON.stringify({
      number: 123,
      title: "Fix auth refresh",
      body: "Rotate token before expiry",
      url: "https://github.com/owner/repo/pull/123",
      author: { login: "alice" },
      baseRefName: "main",
      headRefName: "auth-refresh",
      comments: [
        {
          body: "Existing concern",
          author: { login: "bob" },
          url: "https://c",
        },
      ],
      reviews: [
        { body: "Looks risky", state: "COMMENTED", author: { login: "carol" } },
      ],
      files: [{ path: "src/auth.ts" }, { path: "README.md" }],
    }),
  );

  assert.deepEqual(metadata, {
    provider: "github",
    number: 123,
    title: "Fix auth refresh",
    body: "Rotate token before expiry",
    url: "https://github.com/owner/repo/pull/123",
    author: "alice",
    baseRefName: "main",
    headRefName: "auth-refresh",
    files: ["src/auth.ts", "README.md"],
    existingNotes: [
      "comment by bob: Existing concern",
      "review COMMENTED by carol: Looks risky",
    ],
  });
});
