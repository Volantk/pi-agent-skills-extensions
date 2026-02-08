# Skill: Repository Initialization

Initialize understanding of an existing small-to-medium codebase and create structured documentation for future work.

## When to Use

Use this skill when:
- First encountering an unfamiliar repository
- Asked to "understand", "document", or "initialize" a codebase
- Starting work on an existing project without prior context
- Asked to create project documentation (README, ARCHITECTURE, etc.)

## Approach

### Phase 1: Discovery (Read Extensively)

1. **Project structure** - Run `ls -la` and `find . -type f -name "*.py" ...` to understand layout
2. **Existing docs** - Read all markdown files in root (README, ARCHITECTURE, CONTRIBUTING, etc.)
3. **Entry points** - Find and read `main.py`, `app.py`, `index.js`, or equivalent
4. **Core modules** - Read through the primary source files
5. **Configuration** - Check `config.py`, `.env`, `settings.json`, `pyproject.toml`, `package.json`
6. **Dependencies** - Review `requirements.txt`, `package.json`, `Cargo.toml`, etc.
7. **Tests** - Scan test directory structure and sample test files

### Phase 2: Analysis

Identify and note:
- **Purpose**: What problem does this solve? Who uses it?
- **Architecture**: How are components organized? What patterns are used?
- **Data flow**: How does data move through the system?
- **External dependencies**: APIs, services, databases
- **Platform considerations**: OS-specific code, deployment requirements
- **Current state**: Is it complete? What's missing? Known issues?

### Phase 3: Documentation Creation

Create these files in the project root:

#### APP-VISION.md
```markdown
# [Project Name] Vision

## Purpose
What the app does and why it exists.

## Target Users
Who this is for.

## Core Value Proposition
The key benefit delivered.

## Key Features
- Feature 1
- Feature 2

## Non-Goals
What this project explicitly does NOT try to do.

## Future Direction
Where this could go (if evident from code/docs).
```

#### TECH-STACK.md
```markdown
# [Project Name] Technology Stack

## Languages
- Primary: X
- Secondary: Y (for what purpose)

## Frameworks & Libraries
| Component | Technology | Purpose |
|-----------|------------|---------|
| GUI | Tkinter | Desktop interface |
| AI | Anthropic Claude | Text formatting |

## External Services
- Service 1: What it does

## Development Tools
- Build: ...
- Test: ...
- Deploy: ...

## Platform Requirements
- OS: ...
- Hardware: ...
```

#### README.md (if missing or needs update)
Standard README with installation, usage, configuration.

#### EVAL.md
```markdown
# [Project Name] Evaluation

## Code Quality
- Strengths: ...
- Areas for improvement: ...

## Architecture Assessment
- What works well: ...
- Potential issues: ...

## Test Coverage
Current state of tests.

## Documentation Status
What exists, what's missing.

## Maintenance Considerations
Dependencies to watch, potential breaking changes.

## Recommendations
Priority improvements to consider.
```

### Phase 4: Questions

If ambiguities exist, ask the user about:
- Deployment targets not clear from code
- Unclear business logic or domain concepts
- Missing configuration that seems required
- Apparent dead code or abandoned features

## Output Format

After running this skill, respond with:
1. Brief summary of what you found
2. List of documentation files created/updated
3. Any questions about ambiguities
4. Optional: Priority recommendations

## Example Workflow

```
User: Initialize this repo and document it
Agent: 
1. [Reads project structure]
2. [Reads existing docs]
3. [Reads source files]
4. [Creates APP-VISION.md, TECH-STACK.md, EVAL.md]
5. [Updates README.md if needed]
6. Summary: "This is a voice transcription tool..."
7. Questions: "I noticed X, could you clarify..."
```
