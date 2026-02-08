# Pi Agent Skills & Extensions

Personal [pi](https://github.com/badlogic/pi-mono) extensions and skills. Clone into `~/.pi/agent/` for auto-discovery.

## Extensions

| Extension | Description |
|-----------|-------------|
| [web-search.ts](extensions/web-search.ts) | `web_search` (DuckDuckGo via Jina) and `web_read` (Jina Reader) — no API key needed |
| [copy-tool.ts](extensions/copy-tool.ts) | `copy` tool for copying files and directories |
| [current-time.ts](extensions/current-time.ts) | `current_time` tool for getting the current date/time |

## Skills

| Skill | Description |
|-------|-------------|
| [orchestrate](skills/orchestrate/SKILL.md) | Spawn and coordinate multiple sub-agents for complex tasks |
| [repo-init](skills/repo-init/SKILL.md) | Initialize understanding of a codebase and generate documentation |
| [weather](skills/weather/SKILL.md) | Weather forecasts via MET Norway API |
| [web-reference](skills/web-reference/SKILL.md) | Scrape websites into local Markdown reference docs |

## Setup

```bash
cd ~/.pi/agent
git clone git@github.com:Volantk/pi-agent-skills-extensions.git .
```

Or if `~/.pi/agent/` already has local files (`settings.json`, `auth.json`, etc.):

```bash
cd ~/.pi/agent
git init
git remote add origin git@github.com:Volantk/pi-agent-skills-extensions.git
git fetch origin
git checkout origin/master -- extensions skills .gitignore
```

### Per-machine files (not tracked)

- `settings.json` — pi settings
- `auth.json` — API credentials
- `sessions/` — conversation history
- `skills/weather/locations.json` — saved weather locations
- `skills/web-reference/sources/` — scraped reference content

## Compatibility

Targets pi ≥ 0.51.0 (extension tool signature: `execute(toolCallId, params, signal, onUpdate, ctx)`).
