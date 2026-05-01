import type {
  CommandInvocation,
  GitHubPrSelector,
  ResolvedGitHubPrMetadata,
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

function buildAuthorLogin(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return "";
  }

  const rawLogin = (value as { login?: unknown }).login;
  if (typeof rawLogin !== "string") {
    return "";
  }

  return trimOptional(rawLogin);
}

export function parseGitHubPrSelector(
  selector: string,
): GitHubPrSelector | undefined {
  const trimmed = selector.trim();

  const numberSelector = parsePositiveSafeInteger(trimmed);
  if (numberSelector !== undefined) {
    return {
      kind: "github",
      selector: trimmed,
      number: numberSelector,
    };
  }

  try {
    const url = new URL(trimmed);
    if (!isWebUrl(url) || url.hostname !== "github.com") {
      return undefined;
    }

    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/);
    if (match === null) {
      return undefined;
    }

    const owner = decodeURIComponent(match[1] ?? "");
    const repo = decodeURIComponent(match[2] ?? "");
    const number = parsePositiveSafeInteger(match[3] ?? "");

    if (number === undefined) {
      return undefined;
    }

    return {
      kind: "github",
      selector: trimmed,
      owner,
      repo,
      number,
    };
  } catch {
    return undefined;
  }
}

export function buildGitHubPrViewCommand(
  selector: GitHubPrSelector,
): CommandInvocation {
  return {
    command: "gh",
    args: [
      "pr",
      "view",
      selector.selector,
      "--json",
      "number,title,body,url,author,baseRefName,headRefName,comments,reviews,files",
    ],
  };
}

export function buildGitHubPrDiffCommand(
  selector: GitHubPrSelector,
): CommandInvocation {
  return {
    command: "gh",
    args: ["pr", "diff", selector.selector],
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

function normalizeGitHubCommentEntry(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }

  const body = asString((raw as { body?: unknown }).body).trim();
  const author = buildAuthorLogin((raw as { author?: unknown }).author);

  if (body.length === 0) {
    return undefined;
  }

  return `comment by ${author || "unknown"}: ${body}`;
}

function normalizeGitHubReviewEntry(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }

  const body = asString((raw as { body?: unknown }).body).trim();
  if (body.length === 0) {
    return undefined;
  }

  const state = asString((raw as { state?: unknown }).state);
  const author = buildAuthorLogin((raw as { author?: unknown }).author);

  return `review ${state || "unknown"} by ${author || "unknown"}: ${body}`;
}

export function normalizeGitHubPrView(raw: string): ResolvedGitHubPrMetadata {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const number = Number(parsed.number);

  const files = asArray((parsed as { files?: unknown }).files)
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return "";
      }

      const path = asString((entry as { path?: unknown }).path);
      return trimOptional(path);
    })
    .filter((path) => path.length > 0);

  const existingNotes = [
    ...asArray((parsed as { comments?: unknown }).comments)
      .map(normalizeGitHubCommentEntry)
      .filter((note) => note !== undefined),
    ...asArray((parsed as { reviews?: unknown }).reviews)
      .map(normalizeGitHubReviewEntry)
      .filter((note) => note !== undefined),
  ];

  return {
    provider: "github",
    number: Number.isInteger(number) ? number : 0,
    title: asString((parsed as { title?: unknown }).title),
    body: asString((parsed as { body?: unknown }).body),
    url: asString((parsed as { url?: unknown }).url),
    author: buildAuthorLogin((parsed as { author?: unknown }).author),
    baseRefName: asString((parsed as { baseRefName?: unknown }).baseRefName),
    headRefName: asString((parsed as { headRefName?: unknown }).headRefName),
    files,
    existingNotes,
  };
}
