export type RefValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    };

const DANGEROUS_REF_CHARACTERS = /[\s\0;&|`$<>]/;
const REF_SEGMENT_PATTERN = /^[A-Za-z0-9@][A-Za-z0-9._@+-]*$/;
const JJ_SYMBOLIC_REVSET_PATTERN = /^@[-+]*$/;
const JJ_EMPTY_FUNCTION_REVSET_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*\(\)$/;

function invalidDiffRef(reason: string): RefValidationResult {
  return {
    ok: false,
    error: `Invalid diff ref: ${reason}.`,
  };
}

function validateDiffRefValue(ref: string): RefValidationResult {
  const trimmedRef = ref.trim();

  if (trimmedRef.length === 0) {
    return invalidDiffRef("ref must be non-empty");
  }

  if (trimmedRef.includes("..")) {
    return invalidDiffRef("ref must not contain '..'");
  }

  if (DANGEROUS_REF_CHARACTERS.test(trimmedRef)) {
    return invalidDiffRef("ref contains unsafe characters");
  }

  if (
    JJ_SYMBOLIC_REVSET_PATTERN.test(trimmedRef) ||
    JJ_EMPTY_FUNCTION_REVSET_PATTERN.test(trimmedRef)
  ) {
    return { ok: true };
  }

  const segments = trimmedRef.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      return invalidDiffRef("ref has invalid path component");
    }

    if (segment === "." || segment === "..") {
      return invalidDiffRef("ref contains path traversal");
    }

    if (!REF_SEGMENT_PATTERN.test(segment)) {
      return invalidDiffRef("ref has invalid character");
    }
  }

  return { ok: true };
}

export function validateDiffRef(ref: string): RefValidationResult {
  return validateDiffRefValue(ref);
}

function gitDiff(
  ref: string,
  ...args: string[]
): {
  command: "git";
  args: string[];
} {
  return {
    command: "git",
    args: ["--no-pager", "diff", ref, ...args],
  };
}

function jjDiff(
  ref: string,
  ...args: string[]
): {
  command: "jj";
  args: string[];
} {
  return {
    command: "jj",
    args: ["--no-pager", "diff", "--from", ref, ...args],
  };
}

export function buildGitDiffNameOnlyCommand(ref: string): {
  command: "git";
  args: string[];
} {
  return gitDiff(ref, "--name-only");
}

export function buildJjDiffNameOnlyCommand(ref: string): {
  command: "jj";
  args: string[];
} {
  return jjDiff(ref, "--name-only");
}

export function buildGitDiffStatCommand(ref: string): {
  command: "git";
  args: string[];
} {
  return gitDiff(ref, "--stat");
}

export function buildJjDiffStatCommand(ref: string): {
  command: "jj";
  args: string[];
} {
  return jjDiff(ref, "--stat");
}

export function buildGitDiffCommand(ref: string): {
  command: "git";
  args: string[];
} {
  return gitDiff(ref);
}

export function buildJjDiffCommand(ref: string): {
  command: "jj";
  args: string[];
} {
  return jjDiff(ref, "--git");
}

export function buildGitDiffForFileCommand(
  ref: string,
  filePath: string,
): {
  command: "git";
  args: string[];
} {
  return gitDiff(ref, "--", filePath);
}

export function buildJjDiffForFileCommand(
  ref: string,
  filePath: string,
): {
  command: "jj";
  args: string[];
} {
  return jjDiff(ref, "--git", "--", filePath);
}

export function normalizeGitFileList(raw: string): string[] {
  return raw
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
