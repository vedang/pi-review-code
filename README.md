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

Review any aspect of the codebase:

```text
/review
/review review the database schema and ensure column names are sensible
```

The form asks what to review and accepts optional context. Typed arguments prefill the required field.

### `/review-fix`

Select findings from the latest completed review, optionally add fix context, then start a same-session fix branch.

The fix prompt lists selected comments with priorities, references, and optional fix context. The fix branch collapses back with a summary.

### `/review-diff-against [ref]`

Review current local changes against a git ref:

```text
/review-diff-against
/review-diff-against origin/main
```

The form asks for `ref:` and optional context. Typed refs prefill the field. Prompt drafts include changed files, diff stats, and safe command hints such as `git --no-pager diff <ref>`.

### `/review-pr [github-url|gitlab-url|github-number]`

Review a GitHub PR or GitLab MR through `gh`/`glab` metadata and diff commands:

```text
/review-pr
/review-pr https://github.com/owner/repo/pull/123
/review-pr https://gitlab.com/group/project/-/merge_requests/123
/review-pr 123
```

The form asks for `pr:` and optional context. Typed selectors prefill the field. Number-only selectors resolve GitHub PRs for the current repository. This does not checkout or switch VCS branches.

## Review lifecycle

1. Run `/review`, `/review-diff-against`, or `/review-pr` in interactive Pi.
2. Fill the input widget: required target plus optional review context.
3. Extension resolves target metadata.
4. Current provider/model/thinking level generates a draft prompt.
5. You edit or cancel the prompt.
6. On submit, Pi starts a review branch with `add_review_comment` enabled.
7. Review agent records actionable findings with `add_review_comment`.
8. On agent completion, branch collapses back with a custom summary.
9. `/review-fix` opens a checkbox widget using persisted review findings and starts a fix branch for selected findings.

## UI

The extension registers compact custom renderers for:

- review/fix prompts
- review summaries
- review-fix summaries

Collapsed views show target, run id, and first findings; expanded views show full prompts or agent summaries.

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
