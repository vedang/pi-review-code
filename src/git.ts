export type RefValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    };

const DANGEROUS_REF_CHARACTERS = /[\s\0;&|`$<>]/;
const REF_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function normalizeAndValidateRefValue(ref: string): RefValidationResult {
  const trimmedRef = ref.trim();

  if (trimmedRef.length === 0) {
    return {
      ok: false,
      error: "Invalid git ref: ref must be non-empty.",
    };
  }

  if (trimmedRef.includes("..")) {
    return {
      ok: false,
      error: "Invalid git ref: ref must not contain '..'.",
    };
  }

  if (DANGEROUS_REF_CHARACTERS.test(trimmedRef)) {
    return {
      ok: false,
      error: "Invalid git ref: ref contains unsafe characters.",
    };
  }

  const segments = trimmedRef.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      return {
        ok: false,
        error: "Invalid git ref: ref has invalid path component.",
      };
    }

    if (segment === "." || segment === "..") {
      return {
        ok: false,
        error: "Invalid git ref: ref contains path traversal.",
      };
    }

    if (!REF_SEGMENT_PATTERN.test(segment)) {
      return {
        ok: false,
        error: "Invalid git ref: ref has invalid character.",
      };
    }
  }

  return { ok: true };
}

export function validateGitRef(ref: string): RefValidationResult {
  return normalizeAndValidateRefValue(ref);
}

export function buildGitDiffNameOnlyCommand(ref: string): {
  command: "git";
  args: string[];
} {
  return {
    command: "git",
    args: ["--no-pager", "diff", ref, "--name-only"],
  };
}

export function buildGitDiffStatCommand(ref: string): {
  command: "git";
  args: string[];
} {
  return {
    command: "git",
    args: ["--no-pager", "diff", ref, "--stat"],
  };
}

export function buildGitDiffCommand(ref: string): {
  command: "git";
  args: string[];
} {
  return {
    command: "git",
    args: ["--no-pager", "diff", ref],
  };
}

export function buildGitDiffForFileCommand(
  ref: string,
  filePath: string,
): {
  command: "git";
  args: string[];
} {
  return {
    command: "git",
    args: ["--no-pager", "diff", ref, "--", filePath],
  };
}

export function normalizeGitFileList(raw: string): string[] {
  return raw
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
