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
} from "./git.js";
import {
  buildGitHubPrDiffCommand,
  buildGitHubPrViewCommand,
  normalizeGitHubPrView,
  parseGitHubPrSelector,
} from "./github.js";
import {
  buildGitLabMrDiffCommand,
  buildGitLabMrViewCommand,
  normalizeGitLabMrView,
  parseGitLabMrSelector,
} from "./gitlab.js";
import type {
  CommandInvocation,
  ExecCommand,
  ResolvedDiffAgainstTarget,
  ResolvedPrTarget,
  ResolvedPromptTarget,
  ResolvedReviewTarget,
  ReviewTarget,
  ReviewTargetCommandHint,
} from "./types.js";

const MAX_DIFF_AGAINST_CHANGES_FOR_FULL_DIFF = 400;

function getDiffStatChangeCount(diffStat: string): number {
  const summaryMatch = diffStat.match(
    /\d+\s+files?\s+changed(?:,\s*(\d+)\s+insertions?\(\+\))?(?:,\s*(\d+)\s+deletions?\(-\))?/,
  );
  if (summaryMatch !== null) {
    const insertions = summaryMatch[1] ? Number(summaryMatch[1]) : 0;
    const deletions = summaryMatch[2] ? Number(summaryMatch[2]) : 0;
    if (insertions + deletions > 0) {
      return insertions + deletions;
    }
  }

  let total = 0;
  for (const match of diffStat.matchAll(/\|\s*(\d+)\s+[+-]+/g)) {
    total += Number(match[1]);
  }
  if (total > 0) {
    return total;
  }

  let fallbackTotal = 0;
  for (const match of diffStat.matchAll(
    /(\d+)\s+insertions?\(\+\)|\b(\d+)\s+deletions?\(-\)/g,
  )) {
    if (match[1] !== undefined) {
      fallbackTotal += Number(match[1]);
    } else {
      fallbackTotal += Number(match[2]);
    }
  }

  return fallbackTotal;
}

function commandHint(
  label: string,
  command: string,
  args: string[],
): ReviewTargetCommandHint {
  return { label, command, args };
}

function getStdout(result: Awaited<ReturnType<ExecCommand>>): string {
  if (result.exitCode !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr.length > 0 ? stderr : "Command failed");
  }

  return result.stdout;
}

type DiffAgainstBackend = "git" | "jj";

type DiffAgainstCommands = {
  list: CommandInvocation;
  stat: CommandInvocation;
  diff: CommandInvocation;
  fileDiff: CommandInvocation;
};

type DiffAgainstResolution = {
  files: string[];
  diffStat: string;
  diffText?: string;
};

function buildDiffAgainstCommands(
  backend: DiffAgainstBackend,
  ref: string,
): DiffAgainstCommands {
  if (backend === "git") {
    return {
      list: buildGitDiffNameOnlyCommand(ref),
      stat: buildGitDiffStatCommand(ref),
      diff: buildGitDiffCommand(ref),
      fileDiff: buildGitDiffForFileCommand(ref, "<file>"),
    };
  }

  return {
    list: buildJjDiffNameOnlyCommand(ref),
    stat: buildJjDiffStatCommand(ref),
    diff: buildJjDiffCommand(ref),
    fileDiff: buildJjDiffForFileCommand(ref, "<file>"),
  };
}

function commandHintsForDiffAgainstCommands(
  commands: DiffAgainstCommands,
): ReviewTargetCommandHint[] {
  return [
    commandHint(
      "List changed files",
      commands.list.command,
      commands.list.args,
    ),
    commandHint("Show full diff", commands.diff.command, commands.diff.args),
    commandHint(
      "Show diff for a file",
      commands.fileDiff.command,
      commands.fileDiff.args,
    ),
  ];
}

async function resolveDiffAgainstCommands(
  commands: DiffAgainstCommands,
  context: { exec: ExecCommand },
): Promise<DiffAgainstResolution> {
  const [listResult, statResult] = await Promise.all([
    context.exec(commands.list.command, commands.list.args),
    context.exec(commands.stat.command, commands.stat.args),
  ]);

  const files = normalizeGitFileList(getStdout(listResult));
  const diffStat = getStdout(statResult).trim();
  let diffText: string | undefined;
  if (
    getDiffStatChangeCount(diffStat) <= MAX_DIFF_AGAINST_CHANGES_FOR_FULL_DIFF
  ) {
    const diffResult = await context.exec(
      commands.diff.command,
      commands.diff.args,
    );
    diffText = getStdout(diffResult);
  }

  return {
    files,
    diffStat,
    ...(diffText !== undefined ? { diffText } : {}),
  };
}

async function resolveDiffAgainstWithFallback(
  ref: string,
  context: { exec: ExecCommand },
): Promise<{
  commands: DiffAgainstCommands;
  resolvedDiff: DiffAgainstResolution;
}> {
  const gitCommands = buildDiffAgainstCommands("git", ref);
  try {
    return {
      commands: gitCommands,
      resolvedDiff: await resolveDiffAgainstCommands(gitCommands, context),
    };
  } catch {
    const jjCommands = buildDiffAgainstCommands("jj", ref);
    return {
      commands: jjCommands,
      resolvedDiff: await resolveDiffAgainstCommands(jjCommands, context),
    };
  }
}

export async function resolveReviewTarget(
  target: ReviewTarget,
  context: { exec: ExecCommand },
): Promise<ResolvedReviewTarget> {
  if (target.kind === "diff-against") {
    const ref = target.ref.trim();
    const validation = validateDiffRef(ref);
    if (!validation.ok) {
      throw new Error(validation.error);
    }

    const { commands, resolvedDiff } = await resolveDiffAgainstWithFallback(
      ref,
      context,
    );

    const resolved: ResolvedDiffAgainstTarget = {
      kind: "diff-against",
      targetHint: target.targetHint,
      ref,
      ...(target.reviewContext !== undefined
        ? { reviewContext: target.reviewContext }
        : {}),
      ...resolvedDiff,
      commandHints: commandHintsForDiffAgainstCommands(commands),
    };

    return resolved;
  }

  if (target.kind === "prompt") {
    const resolved: ResolvedPromptTarget = {
      kind: "prompt",
      targetHint: target.targetHint,
      prompt: target.prompt,
      ...(target.reviewContext !== undefined
        ? { reviewContext: target.reviewContext }
        : {}),
      commandHints: [
        {
          label: "Inspect repository files",
          command: "find",
          args: [".", "-type", "f"],
        },
        { label: "Search codebase", command: "rg", args: ["<query>"] },
      ],
    };

    return resolved;
  }

  const githubSelector = parseGitHubPrSelector(target.selector);
  if (githubSelector !== undefined) {
    const command = buildGitHubPrViewCommand(githubSelector);
    const result = await context.exec(command.command, command.args);
    const metadata = normalizeGitHubPrView(getStdout(result));
    const diffCommand = buildGitHubPrDiffCommand(githubSelector);

    const resolved: ResolvedPrTarget = {
      kind: "pr",
      targetHint: githubSelector.selector,
      selector: githubSelector.selector,
      ...(target.reviewContext !== undefined
        ? { reviewContext: target.reviewContext }
        : {}),
      files: metadata.files,
      commandHints: [
        commandHint("Show PR diff", diffCommand.command, diffCommand.args),
      ],
      provider: "github",
      number: metadata.number,
      title: metadata.title,
      body: metadata.body,
      url: metadata.url,
      author: metadata.author,
      baseRefName: metadata.baseRefName,
      headRefName: metadata.headRefName,
      existingNotes: metadata.existingNotes,
    };

    return resolved;
  }

  const gitlabSelector = parseGitLabMrSelector(target.selector);
  if (gitlabSelector !== undefined) {
    const command = buildGitLabMrViewCommand(gitlabSelector);
    const result = await context.exec(command.command, command.args);
    const metadata = normalizeGitLabMrView(getStdout(result));
    const diffCommand = buildGitLabMrDiffCommand(gitlabSelector);

    const resolved: ResolvedPrTarget = {
      kind: "pr",
      targetHint: gitlabSelector.selector,
      selector: gitlabSelector.selector,
      ...(target.reviewContext !== undefined
        ? { reviewContext: target.reviewContext }
        : {}),
      files: metadata.files,
      commandHints: [
        commandHint("Show MR diff", diffCommand.command, diffCommand.args),
      ],
      provider: "gitlab",
      number: metadata.number,
      title: metadata.title,
      body: metadata.body,
      url: metadata.url,
      author: metadata.author,
      baseRefName: metadata.baseRefName,
      headRefName: metadata.headRefName,
      existingNotes: metadata.existingNotes,
    };

    return resolved;
  }

  throw new Error("Unsupported PR/MR selector.");
}
