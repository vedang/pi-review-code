# pi-review-code

![pi-review-code banner](images/banner.png)

Context-rich code review extension for Pi. The central thesis:

> A good review of a large quantity of code is not possible without human-provided context.

`pi-review-code` makes human context first-class: it resolves a review target, asks the current model to draft a detailed review prompt, lets you edit that prompt, then launches an isolated same-session review branch. When the branch finishes, Pi collapses back with review findings, thereby giving you back your context window.

## Install

```bash
# Install globally
pi install git:github.com/vedang/pi-review-code

# Or install for just the current project
pi install -l git:github.com/vedang/pi-review-code
```

## Commands

### `/review [review request]`

Open a review input form for a free-form aspect of the codebase:

```text
/review
/review review the database schema and ensure column names are sensible
```

The form asks what to review and accepts optional context. Typed arguments prefill the required field so you can submit quickly or add context before prompt drafting.

### `/review-fix [list|latest|<review-run-id>|<finding-id>]`

Start a same-session fix branch for review comments, or omit arguments for usage help:

```text
/review-fix                                      # show help
/review-fix latest                               # latest completed review
/review-fix list                                 # unfixed findings
/review-fix run <review-run-id>                  # specific review run
/review-fix finding <finding-id>                 # one finding
/review-fix finding <finding-id> <finding-id>    # multiple findings from one review
/review-fix <id>                                 # finding first, then review run
```

The fix prompt lists selected comments with priorities and references. The fix branch collapses back with a summary of attempted fixes.

### `/review-diff-against [ref]`

Open a review input form for the current local diff against a git ref:

```text
/review-diff-against
/review-diff-against origin/main
```

The form asks for `ref:` and accepts optional context. Typed refs prefill the required field. The prompt draft includes changed files, diff stats, and safe command hints such as `git --no-pager diff <ref>`.

### `/review-pr [github-url|gitlab-url|github-number]`

Open a review input form for a GitHub PR or GitLab MR through `gh`/`glab` metadata and diff commands:

```text
/review-pr
/review-pr https://github.com/owner/repo/pull/123
/review-pr https://gitlab.com/group/project/-/merge_requests/123
/review-pr 123
```

The form asks for `pr:` and accepts optional context. Typed selectors prefill the required field. Number-only selectors currently resolve GitHub PRs for the current repository. MVP behavior does not checkout or switch VCS branches.

## Review lifecycle

1. Run `/review`, `/review-diff-against`, or `/review-pr` in interactive Pi.
2. Fill the input widget: required target plus optional review context.
3. Extension resolves target metadata.
4. Current provider/model/thinking level generates a draft prompt.
5. You edit or cancel the prompt.
6. On submit, Pi starts a review branch with `add_review_comment` enabled.
7. Review agent records actionable findings with `add_review_comment`.
8. On agent completion, branch collapses back with a custom summary.
9. `/review-fix` can use the persisted summary to launch a fix branch.

## UI

The extension registers compact custom renderers for:

- review/fix prompts
- review summaries
- review-fix summaries

Collapsed views show target, run id, and first findings. Expanded views show full prompt or agent summary.

## Finding priorities

- `P0`: critical breakage, security risk, or data loss
- `P1`: major correctness or reliability regression
- `P2`: moderate maintainability or behavior risk
- `P3`: minor polish and low-risk issues

## Limitations

- Interactive UI is required for prompt editing.
- Prompt drafting fails closed if no current model/auth is available.
- PR support depends on installed/authenticated `gh` or `glab`.
- Active branch auto-collapse state does not resume after extension reload.
