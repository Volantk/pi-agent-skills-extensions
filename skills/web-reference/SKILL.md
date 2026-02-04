---
name: web-reference
description: Scrape websites into LLM-friendly Markdown reference docs. Use when the user wants to save web content for offline reference, build documentation from websites, or create a local knowledge base from online sources.
---

# Web Reference

Scrape and organize web content as local Markdown reference documentation.

## Overview

This skill helps you:
- Scrape websites into clean Markdown files
- Build searchable indexes of content
- Organize references by source/topic
- Update existing references with new content

## Directory Structure

```
~/.pi/agent/skills/web-reference/
├── SKILL.md           # This file
├── sources/           # Scraped content organized by source
│   └── {source-name}/
│       ├── index.md   # Table of contents
│       └── articles/  # Individual pages
└── scrape.md          # Scraping workflow reference
```

## Usage

### Adding a New Source

1. **Identify the site structure** - Find archive/sitemap pages
2. **Create source folder** - `sources/{source-name}/`
3. **Scrape index first** - Get list of all pages
4. **Scrape articles** - Fetch individual pages
5. **Generate index.md** - Create searchable TOC

### Scraping Workflow

Use `web_read` tool to fetch pages. For each source:

1. Read the archive/sitemap page to get all URLs
2. For each URL, use `web_read` and save to `sources/{name}/articles/{slug}.md`
3. Create `sources/{name}/index.md` with:
   - Source metadata (name, URL, description, date scraped)
   - Categorized list of articles with descriptions
   - Quick reference section if applicable

### File Naming Convention

- Source folders: lowercase, hyphens (e.g., `gmshaders`, `shadertoy-tutorials`)
- Article files: use URL slug or descriptive name (e.g., `sdf.md`, `raymarching.md`)
- Always include frontmatter with source URL and scrape date

### Article File Format

```markdown
---
source: https://example.com/article
scraped: 2026-01-30
title: Article Title
---

# Article Title

[Content here...]
```

### Index File Format

```markdown
---
source: https://example.com
scraped: 2026-01-30
description: Brief description of the source
article_count: 25
---

# Source Name Reference

Brief description of what this reference contains.

## Categories

### Category 1
- [Article Title](articles/slug.md) - Brief description

### Category 2
- [Another Article](articles/another.md) - Brief description
```

## Lookup

To find relevant content:
1. Check `sources/` for available references
2. Read the source's `index.md` for overview
3. Read specific articles as needed

## Updating References

To update an existing source:
1. Re-scrape the archive page
2. Compare with existing articles
3. Add new articles only
4. Update index.md with new entries

## Notes

- Be respectful: don't hammer servers, scrape once and cache
- Focus on educational/documentation content
- Some sites may have paywalled content - note this in the index
- Images are referenced but not downloaded (use original URLs)
