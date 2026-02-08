---
name: skill-git-hygiene
description: Ensures new pi skills and extensions are committed to the git repo at ~/.pi after creation. Use whenever creating, adding, or scaffolding a new skill or extension.
---

# Skill Git Hygiene

## Remote

The repo has a remote at `origin`: https://github.com/Volantk/pi-agent-skills-extensions

## Rule: Pull Before Changing

Before making any changes to skills or extensions, **always pull first** to ensure you're working with the latest version:

```bash
cd ~/.pi && git pull origin master
```

If there are local uncommitted changes, stash them first:

```bash
cd ~/.pi && git stash && git pull origin master && git stash pop
```

## Rule: Commit and Push on Creation

After creating or adding a new skill or extension under `~/.pi/agent/`, **always stage, commit, and push it**.

## Steps

1. Pull latest:
   ```bash
   cd ~/.pi && git pull origin master
   ```
2. Create the skill or extension as normal.
3. Stage the new files:
   ```bash
   cd ~/.pi && git add agent/skills/<skill-name>/ 
   # or
   cd ~/.pi && git add agent/extensions/<extension-name>
   ```
3. Commit with a clear message:
   ```bash
   git commit -m "Add <type>: <name>"
   ```
   Where `<type>` is `skill` or `extension`, and `<name>` is the skill/extension name.
4. Push:
   ```bash
   git push origin master
   ```

## Examples

```bash
cd ~/.pi && git add agent/skills/my-new-skill/ && git commit -m "Add skill: my-new-skill"
cd ~/.pi && git add agent/extensions/my-tool.ts && git commit -m "Add extension: my-tool"
cd ~/.pi && git add agent/extensions/my-tool-dir/ && git commit -m "Add extension: my-tool-dir"
```

## Nested Git Repos

Some extensions or skills may have their own `.git` repo (e.g. cloned from GitHub). **Do not remove these.** They are managed independently from the parent `~/.pi` repo.

When you encounter or create a nested repo:

1. Add it to `~/.pi/.gitignore` so the parent repo ignores it:
   ```bash
   echo "agent/extensions/<name>/" >> ~/.pi/.gitignore
   ```
2. Commit the `.gitignore` update:
   ```bash
   cd ~/.pi && git add .gitignore && git commit -m "Ignore nested repo: <name>"
   ```
3. **Do not** `git add` the nested repo's contents to the parent repo.
4. **Do not** delete its `.git` directory.

## Notes

- Do **not** stage unrelated files — only the new skill or extension.
- If the creation involved modifying `agent/settings.json`, include that change in the commit too.
- This applies to both global (`~/.pi/agent/`) and any new skills/extensions scaffolded there.
