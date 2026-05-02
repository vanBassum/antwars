---
name: parallel-issue-fix
description: Dispatch one or more GitHub issues to parallel Claude Code workers using git worktrees. Use when the user asks to fix issue N, fix issues X and Y, spin up workers for issues, run agents in parallel on issues, or delegate issue fixes to background sessions while keeping the main session free for review and merging.
---

# Parallel Issue Fix

Dispatches GitHub issue fixes to isolated Claude Code workers, each running in its own PowerShell window in its own git worktree. The main session stays free for the user to review and merge.

## When to use

User wants one or more GitHub issues fixed in the background. Typical phrasings: "fix issue 5", "fix issues 5, 6 and 7", "spin up workers for these issues", "run a worker on issue 12".

## Pre-flight checks

Run these and stop if any fail:

1. `git rev-parse --is-inside-work-tree` must succeed.
2. `gh auth status` must show authenticated, and `gh repo view --json name,owner` must return a repo.
3. For each issue number N: `gh issue view <N> --json number,title,state` must return state OPEN. Show the title to the user.

## Confirm before dispatching

After showing titles, ask the user to confirm. If they want more than 4 issues at once, warn that review overhead becomes a bottleneck above that.

## Dispatch command (run once per confirmed issue)

Use this PowerShell snippet, substituting the issue number for `<issue-number>`:

```powershell
$N = <issue-number>
$repo = (Get-Location).Path
$branch = "fix-issue-$N"
$prompt = "Fix GitHub issue #$N in this repository. First run 'gh issue view $N' to read the full description and comments. Implement the fix on this branch, run any relevant tests if the project has them, then commit with a clear conventional-commit message that references the issue (for example: 'fix: <short summary> (#$N)') and push the branch to origin. Do not open a pull request; the user will review and merge manually."

Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$repo'; claude -w $branch `"$prompt`""
```

If `wt` (Windows Terminal) is available and the user prefers tabs over separate windows, use this instead:

```powershell
wt new-tab --title $branch -d $repo powershell -NoExit -Command "claude -w $branch `"$prompt`""
```

## After dispatch

Tell the user:

- Branch names that were created
- Worktrees live at `.claude\worktrees\fix-issue-<N>\`
- See active worktrees with `git worktree list`
- After merging, clean up with `git worktree remove .claude\worktrees\fix-issue-<N>` and `git branch -d fix-issue-<N>`

## Notes

- Workers do NOT open PRs. The user merges manually.
- Workers run with normal permission prompts by default. If the user wants more autonomous execution, they can add `--permission-mode acceptEdits` to the `claude -w` call inside the prompt template.
- The prompt to the worker is in English on purpose; technical instructions land cleaner that way and Claude handles either language input from the user.
