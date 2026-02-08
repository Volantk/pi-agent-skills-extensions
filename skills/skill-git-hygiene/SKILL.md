---
name: skill-git-hygiene
description: Ensures new pi skills and extensions are committed to the git repo at ~/.pi/agent after creation. Use whenever creating, adding, or scaffolding a new skill or extension.
---

# Skill Git Hygiene

## Remote

The repo has a remote at `origin`: https://github.com/Volantk/pi-agent-skills-extensions

The repo root is `~/.pi/agent/`. To install on a new machine:

```bash
git clone https://github.com/Volantk/pi-agent-skills-extensions.git ~/.pi/agent
```

## Rule: Pull Before Changing

Before making any changes to skills or extensions, **always pull first** to ensure you're working with the latest version:

```bash
cd ~/.pi/agent && git pull origin master
```

If there are local uncommitted changes, stash them first:

```bash
cd ~/.pi/agent && git stash && git pull origin master && git stash pop
```

## Rule: Commit and Push on Creation

After creating or adding a new skill or extension under `~/.pi/agent/`, **always stage, commit, and push it**.

## Steps

1. Pull latest:
   ```bash
   cd ~/.pi/agent && git pull origin master
   ```
2. Create the skill or extension as normal.
3. Stage the new files:
   ```bash
   cd ~/.pi/agent && git add skills/<skill-name>/
   # or
   cd ~/.pi/agent && git add extensions/<extension-name>
   ```
4. Commit with a clear message:
   ```bash
   git commit -m "Add <type>: <name>"
   ```
   Where `<type>` is `skill` or `extension`, and `<name>` is the skill/extension name.
5. Push:
   ```bash
   git push origin master
   ```

## Examples

```bash
cd ~/.pi/agent && git add skills/my-new-skill/ && git commit -m "Add skill: my-new-skill" && git push origin master
cd ~/.pi/agent && git add extensions/my-tool.ts && git commit -m "Add extension: my-tool" && git push origin master
```

## Nested Git Repos

Some extensions or skills may have their own `.git` repo (e.g. cloned from GitHub). **Do not remove these.** They are managed independently from the `~/.pi/agent` repo.

When you encounter or create a nested repo:

1. Add it to `~/.pi/agent/.gitignore` so the repo ignores it:
   ```bash
   echo "extensions/<name>/" >> ~/.pi/agent/.gitignore
   ```
2. Commit the `.gitignore` update:
   ```bash
   cd ~/.pi/agent && git add .gitignore && git commit -m "Ignore nested repo: <name>"
   ```
3. **Do not** `git add` the nested repo's contents to the parent repo.
4. **Do not** delete its `.git` directory.

## Notes

- Do **not** stage unrelated files — only the new skill or extension.
- If the creation involved modifying `settings.json`, include that change in the commit too.
- This applies to both global (`~/.pi/agent/`) and any new skills/extensions scaffolded there.
