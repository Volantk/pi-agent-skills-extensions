---
name: git-work-analysis
description: Analyze git work done by an author over a date or date range. Use when the user asks "what did I do on [date]", "summarize my work last week", "what changed on Friday", or any query about reviewing commit history for a person/period.
---

# Git Work Analysis

Analyze and summarize git contributions by author and date range.

## Resolving the Author

If the user says "I" or "my work", use "Bjørnar" as the author.

For other people, use their name as the `--author` filter. If ambiguous, ask.

## Resolving the Date Range

Parse natural language dates relative to the current date (use `current_time` tool if needed).

| User says | --after | --before |
|-----------|---------|----------|
| "on Jan 28" | Jan 27 | Jan 29 |
| "last Monday" | that Monday - 1 day | that Monday + 1 day |
| "last week" | previous Monday - 1 day | previous Sunday + 1 day |
| "this week" | this Monday - 1 day | today + 1 day |
| "yesterday" | day before yesterday | today |
| "Jan 20-24" | Jan 19 | Jan 25 |

Note: `--after` and `--before` are exclusive boundaries, so pad by 1 day on each side.

## Step 1: Fetch Commits

```bash
git log --author="<name>" --after="<start>" --before="<end>" --stat --format="%H %s%n%ai"
```

If no results, try relaxing the author match or check branches:

```bash
# Search all branches
git log --all --author="<name>" --after="<start>" --before="<end>" --stat --format="%H %s%n%ai"
```

## Step 2: Summarize

Produce a structured summary with:

1. **Overview** — commit count, time span (earliest to latest commit), branches touched
2. **Thematic groups** — cluster commits by feature/system rather than listing chronologically. Name each group with an emoji + descriptive title. Within each group, list commits chronologically with time and one-line description.
3. **Key takeaway** — one sentence characterizing the day/period (e.g. "A visual-heavy day focused on shader work and UI polish")

### Grouping heuristics

- Commits touching the same directories or files belong together
- Sequential commits with related messages (e.g. "Add X", "Fix X", "Update X") belong together
- Merge commits can be mentioned but don't need their own group
- If there are very few commits (≤3), skip grouping and just list them

### Formatting guidelines

- Use **bold** for commit messages on first mention
- Show file counts and rough line changes for each group, not per commit
- Flag any commits that mention bugs or known issues
- Keep it scannable — prefer bullets over paragraphs
