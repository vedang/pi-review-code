import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MAX_REVIEW_GUIDELINES_BYTES,
  REVIEW_GUIDELINES_FILENAME,
  readReviewGuidelinesFromCwd,
} from "../src/guidelines.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "pi-review-guidelines-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("readReviewGuidelinesFromCwd returns trimmed REVIEW_GUIDELINES.md content", async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      join(dir, REVIEW_GUIDELINES_FILENAME),
      "\nRequire tests for changed behavior.\n\n",
    );

    assert.equal(
      await readReviewGuidelinesFromCwd(dir),
      "Require tests for changed behavior.",
    );
  });
});

test("readReviewGuidelinesFromCwd returns undefined when file is missing", async () => {
  await withTempDir(async (dir) => {
    assert.equal(await readReviewGuidelinesFromCwd(dir), undefined);
  });
});

test("readReviewGuidelinesFromCwd returns undefined for blank guidelines", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, REVIEW_GUIDELINES_FILENAME), "  \n\t  ");

    assert.equal(await readReviewGuidelinesFromCwd(dir), undefined);
  });
});

test("readReviewGuidelinesFromCwd rejects symlinked guidelines", async () => {
  await withTempDir(async (dir) => {
    const secretPath = join(dir, "secret.md");
    await writeFile(secretPath, "local-only secret");
    await symlink(secretPath, join(dir, REVIEW_GUIDELINES_FILENAME));

    await assert.rejects(
      readReviewGuidelinesFromCwd(dir),
      /REVIEW_GUIDELINES\.md must be a regular file/,
    );
  });
});

test("readReviewGuidelinesFromCwd rejects oversized guidelines", async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      join(dir, REVIEW_GUIDELINES_FILENAME),
      "x".repeat(MAX_REVIEW_GUIDELINES_BYTES + 1),
    );

    await assert.rejects(
      readReviewGuidelinesFromCwd(dir),
      /REVIEW_GUIDELINES\.md is too large/,
    );
  });
});
