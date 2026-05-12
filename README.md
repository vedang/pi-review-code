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

## Standalone launcher

`pi-review-code` also ships a small `pi-review` launcher. Run it from the repo you want to review:

```bash
pi-review look at auth implementation in this code
pi-review diff-against origin/main
pi-review pr https://github.com/owner/repo/pull/123
```

The launcher starts interactive Pi, loads this extension, and sends an initial `/review ...` command so the review widget opens immediately with the target field prefilled. By default it uses `--no-extensions -e <pi-review-code package>` to avoid duplicate `/review` commands. If you already install the extension in your normal Pi setup and want to use that setup instead:

```bash
PI_REVIEW_USE_INSTALLED=1 pi-review diff-against origin/main
```

For a local checkout, add it to your PATH or symlink it:

```bash
ln -sf "$PWD/bin/pi-review" ~/.local/bin/pi-review
```

### Minimal alias alternative

If the extension is already installed in Pi, this simple shell function is enough:

```bash
pi-review() { pi "/review $*"; }
```

## Commands

### `/review [target or request]`

Start any review from one widget. Choose review type, then fill target plus optional context:

- Free-form request: describe code, behavior, or risk to review.
- Diff against ref: enter a git ref, jj change id/revset (for example `@-` or `trunk()`), or compatible base name. The extension tries `git diff` first, then falls back to `jj diff` when git is unavailable in a jj workspace. Prompt drafts include changed files, diff stats, and safe command hints for the backend used.
- PR/MR: enter a GitHub URL, GitLab URL, MR URL, or PR number. PR/MR reviews use `gh`/`glab` metadata and diff commands without checking out or switching VCS branches.

```text
/review
/review review the database schema and ensure column names are sensible
/review https://github.com/owner/repo/pull/123
/review https://gitlab.com/group/project/-/merge_requests/123
/review 123
```

Typed arguments prefill the target field. PR/MR URLs and number-only selectors also preselect PR/MR mode; ambiguous refs such as `origin/main` stay in free-form mode until you choose diff mode. Use explicit prefixes when you want the widget to open directly in a selector mode:

```text
/review diff-against origin/main
/review pr https://github.com/owner/repo/pull/123
/review mr 123
```

### `/review-fix`

Select unfixed findings from completed reviews, optionally add fix context, then start a same-session fix branch.

The active finding shows its full wrapped text in the widget; use Up/Down to focus each finding and `[`/`]` or PageUp/PageDown to scroll long details. The fix prompt lists selected comments with priorities, references, and optional fix context. The fix branch collapses back with a summary.

## Review lifecycle

1. Run `/review` in interactive Pi.
2. Choose target type and fill the input widget: required target plus optional review context.
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

Collapsed views show target, run id, and first findings. Prompt messages expand to prompt text; review summaries expand to full finding text; fix summaries expand to agent summaries.

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
