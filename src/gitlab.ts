import type {
  CommandInvocation,
  GitLabMrSelector,
  ResolvedGitLabMrMetadata,
} from "./types.js";

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

function normalizeSelectorUrl(rawSelector: string): URL {
  const url = new URL(rawSelector);
  if (!isWebUrl(url)) {
    throw new Error("Unsupported URL scheme");
  }

  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error("Unsupported URL query or fragment");
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function buildGitLabSelectorValue(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`;
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
    const selectorUrl = normalizeSelectorUrl(trimmed);

    const match = selectorUrl.pathname.match(
      /^\/(.+)\/-\/merge_requests\/(\d+)$/,
    );
    if (match === null) {
      return undefined;
    }

    const host = selectorUrl.hostname;
    const projectPath = trimOptional(decodeURIComponent(match[1] ?? ""));
    const number = parsePositiveSafeInteger(match[2] ?? "");

    if (!projectPath || number === undefined) {
      return undefined;
    }

    return {
      kind: "gitlab",
      selector: buildGitLabSelectorValue(selectorUrl),
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

function normalizeMergeRequestNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : 0;
  }

  if (typeof value === "string") {
    const number = Number(value);
    return Number.isInteger(number) ? number : 0;
  }

  return 0;
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

  return {
    provider: "gitlab",
    number: normalizeMergeRequestNumber(parsed.iid),
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
