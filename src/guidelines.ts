import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

export const REVIEW_GUIDELINES_FILENAME = "REVIEW_GUIDELINES.md";
export const MAX_REVIEW_GUIDELINES_BYTES = 64 * 1024;

function isNodeFileNotFoundError(
  error: unknown,
): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

export async function readReviewGuidelinesFromCwd(
  cwd: string = process.cwd(),
): Promise<string | undefined> {
  const path = join(cwd, REVIEW_GUIDELINES_FILENAME);

  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (isNodeFileNotFoundError(error)) {
      return undefined;
    }

    throw error;
  }

  if (!stats.isFile()) {
    throw new Error(`${REVIEW_GUIDELINES_FILENAME} must be a regular file.`);
  }

  if (stats.size > MAX_REVIEW_GUIDELINES_BYTES) {
    throw new Error(
      `${REVIEW_GUIDELINES_FILENAME} is too large (${stats.size} bytes); maximum is ${MAX_REVIEW_GUIDELINES_BYTES} bytes.`,
    );
  }

  const raw = await readFile(path, "utf8");
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
