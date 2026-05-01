import type {
  CommandInvocation,
  GitLabMrSelector,
  ResolvedGitLabMrMetadata,
} from "./types";

function trimOptional(value: string | undefined): string {
  return value?.trim() ?? "";
}

function parsePositiveSafeInteger(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) {
    return undefined;
  }

  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

function isWebUrl(url: URL): boolean {
  return url.protocol === "https:" || url.protocol === "http:";
}

function buildAuthorUsername(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return "";
  }

  const rawUsername = (value as { username?: unknown }).username;
  if (typeof rawUsername !== "string") {
    return "";
  }

  return trimOptional(rawUsername);
}

export function parseGitLabMrSelector(
  selector: string,
): GitLabMrSelector | undefined {
  const trimmed = selector.trim();

  try {
    const url = new URL(trimmed);

    if (!isWebUrl(url)) {
      return undefined;
    }

    const match = url.pathname.match(/^\/(.+)\/-\/merge_requests\/(\d+)\/?$/);
    if (match === null) {
      return undefined;
    }

    const host = url.hostname;
    const projectPath = trimOptional(decodeURIComponent(match[1] ?? ""));
    const number = parsePositiveSafeInteger(match[2] ?? "");

    if (!projectPath || number === undefined) {
      return undefined;
    }

    return {
      kind: "gitlab",
      selector: trimmed,
      host,
      projectPath,
      number,
    };
  } catch {
    return undefined;
  }
}

export function buildGitLabMrViewCommand(
  selector: GitLabMrSelector,
): CommandInvocation {
  return {
    command: "glab",
    args: ["mr", "view", selector.selector, "--output", "json"],
  };
}

export function buildGitLabMrDiffCommand(
  selector: GitLabMrSelector,
): CommandInvocation {
  return {
    command: "glab",
    args: ["mr", "diff", selector.selector],
  };
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeGitLabNoteEntry(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }

  const body = asString((raw as { body?: unknown }).body).trim();
  const author = buildAuthorUsername((raw as { author?: unknown }).author);

  if (body.length === 0) {
    return undefined;
  }

  return `note by ${author || "unknown"}: ${body}`;
}

export function normalizeGitLabMrView(raw: string): ResolvedGitLabMrMetadata {
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const files = asArray((parsed as { changes?: unknown }).changes)
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return "";
      }

      const path = asString((entry as { new_path?: unknown }).new_path);
      return trimOptional(path);
    })
    .filter((path) => path.length > 0);

  const existingNotes = asArray((parsed as { notes?: unknown }).notes)
    .map(normalizeGitLabNoteEntry)
    .filter((note) => note !== undefined);

  const rawNumber = parsed.iid;
  const number =
    typeof rawNumber === "number"
      ? rawNumber
      : typeof rawNumber === "string"
        ? Number(rawNumber)
        : 0;

  return {
    provider: "gitlab",
    number: Number.isInteger(number) ? number : 0,
    title: asString((parsed as { title?: unknown }).title),
    body: asString((parsed as { description?: unknown }).description),
    url: asString((parsed as { web_url?: unknown }).web_url),
    author: buildAuthorUsername((parsed as { author?: unknown }).author),
    baseRefName: asString(
      (parsed as { target_branch?: unknown }).target_branch,
    ),
    headRefName: asString(
      (parsed as { source_branch?: unknown }).source_branch,
    ),
    files,
    existingNotes,
  };
}
