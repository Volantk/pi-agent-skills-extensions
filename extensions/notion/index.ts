/**
 * Notion Integration — Search, read, create, and update Notion pages & databases.
 *
 * Requires: NOTION_API_KEY env var (Internal Integration Token)
 *
 * Setup:
 *   1. Go to https://www.notion.so/profile/integrations
 *   2. Click "+ New integration", name it, select your workspace
 *   3. Copy the "Internal Integration Secret" (starts with ntn_)
 *   4. Set env var: NOTION_API_KEY=ntn_...
 *   5. In Notion, share pages/databases with your integration via "..." → "Connections"
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	truncateHead,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const TIMEOUT_MS = 30_000;

// ── Helpers ─────────────────────────────────────────────────

function getApiKey(): string | null {
	return process.env.NOTION_API_KEY ?? null;
}

function headers(): Record<string, string> {
	return {
		Authorization: `Bearer ${getApiKey()}`,
		"Notion-Version": NOTION_VERSION,
		"Content-Type": "application/json",
	};
}

function truncateOutput(text: string): string {
	const truncation = truncateHead(text, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	if (truncation.truncated) {
		return (
			truncation.content +
			`\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
			`(${truncation.outputBytes} of ${truncation.totalBytes} bytes)]`
		);
	}
	return truncation.content;
}

function noKeyError() {
	return {
		content: [
			{
				type: "text" as const,
				text: "Error: NOTION_API_KEY environment variable not set.\n\nTo set up:\n1. Go to https://www.notion.so/profile/integrations\n2. Create a new integration\n3. Copy the token and set NOTION_API_KEY=ntn_...\n4. Share your pages/databases with the integration in Notion",
			},
		],
		details: { error: "no_api_key" },
		isError: true,
	};
}

async function notionFetch(
	path: string,
	options: {
		method?: string;
		body?: any;
		signal?: AbortSignal;
	} = {}
): Promise<{ ok: boolean; status: number; data: any }> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
	if (options.signal) {
		options.signal.addEventListener("abort", () => controller.abort(), {
			once: true,
		});
	}

	try {
		const res = await fetch(`${NOTION_API}${path}`, {
			method: options.method ?? "GET",
			headers: headers(),
			body: options.body ? JSON.stringify(options.body) : undefined,
			signal: controller.signal,
		});
		clearTimeout(timeout);

		const data = await res.json().catch(() => ({}));
		return { ok: res.ok, status: res.status, data };
	} catch (err: any) {
		clearTimeout(timeout);
		if (err.name === "AbortError") {
			throw new Error("Request timed out or was cancelled");
		}
		throw err;
	}
}

// ── Rich text extraction ────────────────────────────────────

function richTextToPlain(richText: any[]): string {
	if (!Array.isArray(richText)) return "";
	return richText.map((rt: any) => rt.plain_text ?? "").join("");
}

function getTitle(page: any): string {
	// Try properties for title
	if (page.properties) {
		for (const prop of Object.values(page.properties) as any[]) {
			if (prop.type === "title") {
				return richTextToPlain(prop.title);
			}
		}
	}
	return page.id ?? "Untitled";
}

// ── Block content to markdown ───────────────────────────────

function blockToMarkdown(block: any, indent: string = ""): string {
	const type = block.type;
	const content = block[type];
	if (!content) return "";

	const text = content.rich_text ? richTextToPlain(content.rich_text) : "";

	switch (type) {
		case "paragraph":
			return text ? `${indent}${text}` : "";
		case "heading_1":
			return `${indent}# ${text}`;
		case "heading_2":
			return `${indent}## ${text}`;
		case "heading_3":
			return `${indent}### ${text}`;
		case "bulleted_list_item":
			return `${indent}- ${text}`;
		case "numbered_list_item":
			return `${indent}1. ${text}`;
		case "to_do":
			return `${indent}- [${content.checked ? "x" : " "}] ${text}`;
		case "toggle":
			return `${indent}▸ ${text}`;
		case "quote":
			return `${indent}> ${text}`;
		case "callout":
			const icon = content.icon?.emoji ?? "💡";
			return `${indent}${icon} ${text}`;
		case "code":
			return `${indent}\`\`\`${content.language ?? ""}\n${indent}${text}\n${indent}\`\`\``;
		case "divider":
			return `${indent}---`;
		case "image":
			const url =
				content.type === "external"
					? content.external?.url
					: content.file?.url;
			return url ? `${indent}![image](${url})` : "";
		case "bookmark":
			return `${indent}🔗 ${content.url ?? ""}`;
		case "link_preview":
			return `${indent}🔗 ${content.url ?? ""}`;
		case "table_row":
			const cells = (content.cells ?? [])
				.map((cell: any) => richTextToPlain(cell))
				.join(" | ");
			return `${indent}| ${cells} |`;
		case "child_page":
			return `${indent}📄 [${content.title ?? "Untitled"}]`;
		case "child_database":
			return `${indent}📊 [${content.title ?? "Untitled"}]`;
		default:
			return text ? `${indent}${text}` : "";
	}
}

// ── Property value formatting ───────────────────────────────

function formatPropertyValue(prop: any): string {
	if (!prop) return "";
	switch (prop.type) {
		case "title":
			return richTextToPlain(prop.title);
		case "rich_text":
			return richTextToPlain(prop.rich_text);
		case "number":
			return prop.number != null ? String(prop.number) : "";
		case "select":
			return prop.select?.name ?? "";
		case "multi_select":
			return (prop.multi_select ?? [])
				.map((s: any) => s.name)
				.join(", ");
		case "date":
			if (!prop.date) return "";
			return prop.date.end
				? `${prop.date.start} → ${prop.date.end}`
				: prop.date.start;
		case "checkbox":
			return prop.checkbox ? "✓" : "✗";
		case "url":
			return prop.url ?? "";
		case "email":
			return prop.email ?? "";
		case "phone_number":
			return prop.phone_number ?? "";
		case "status":
			return prop.status?.name ?? "";
		case "people":
			return (prop.people ?? []).map((p: any) => p.name ?? p.id).join(", ");
		case "relation":
			return (prop.relation ?? []).map((r: any) => r.id).join(", ");
		case "formula":
			if (!prop.formula) return "";
			return String(
				prop.formula.string ??
					prop.formula.number ??
					prop.formula.boolean ??
					prop.formula.date?.start ??
					""
			);
		case "rollup":
			if (!prop.rollup) return "";
			if (prop.rollup.type === "array") {
				return (prop.rollup.array ?? [])
					.map((v: any) => formatPropertyValue(v))
					.join(", ");
			}
			return String(
				prop.rollup.number ?? prop.rollup.date?.start ?? ""
			);
		case "created_time":
			return prop.created_time ?? "";
		case "last_edited_time":
			return prop.last_edited_time ?? "";
		case "created_by":
			return prop.created_by?.name ?? prop.created_by?.id ?? "";
		case "last_edited_by":
			return prop.last_edited_by?.name ?? prop.last_edited_by?.id ?? "";
		case "unique_id":
			return prop.unique_id
				? `${prop.unique_id.prefix ?? ""}${prop.unique_id.number ?? ""}`
				: "";
		case "files":
			return (prop.files ?? [])
				.map((f: any) => f.name ?? f.external?.url ?? f.file?.url ?? "")
				.join(", ");
		default:
			return JSON.stringify(prop[prop.type] ?? "");
	}
}

// ── Markdown text to Notion blocks ──────────────────────────

function textToBlocks(
	text: string
): Array<{ object: string; type: string; [key: string]: any }> {
	const lines = text.split("\n");
	const blocks: any[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		if (trimmed.startsWith("### ")) {
			blocks.push({
				object: "block",
				type: "heading_3",
				heading_3: {
					rich_text: [{ type: "text", text: { content: trimmed.slice(4) } }],
				},
			});
		} else if (trimmed.startsWith("## ")) {
			blocks.push({
				object: "block",
				type: "heading_2",
				heading_2: {
					rich_text: [{ type: "text", text: { content: trimmed.slice(3) } }],
				},
			});
		} else if (trimmed.startsWith("# ")) {
			blocks.push({
				object: "block",
				type: "heading_1",
				heading_1: {
					rich_text: [{ type: "text", text: { content: trimmed.slice(2) } }],
				},
			});
		} else if (trimmed.startsWith("- [x] ") || trimmed.startsWith("- [ ] ")) {
			blocks.push({
				object: "block",
				type: "to_do",
				to_do: {
					rich_text: [{ type: "text", text: { content: trimmed.slice(6) } }],
					checked: trimmed.startsWith("- [x]"),
				},
			});
		} else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
			blocks.push({
				object: "block",
				type: "bulleted_list_item",
				bulleted_list_item: {
					rich_text: [{ type: "text", text: { content: trimmed.slice(2) } }],
				},
			});
		} else if (/^\d+\.\s/.test(trimmed)) {
			const content = trimmed.replace(/^\d+\.\s/, "");
			blocks.push({
				object: "block",
				type: "numbered_list_item",
				numbered_list_item: {
					rich_text: [{ type: "text", text: { content } }],
				},
			});
		} else if (trimmed.startsWith("> ")) {
			blocks.push({
				object: "block",
				type: "quote",
				quote: {
					rich_text: [{ type: "text", text: { content: trimmed.slice(2) } }],
				},
			});
		} else if (trimmed === "---") {
			blocks.push({
				object: "block",
				type: "divider",
				divider: {},
			});
		} else {
			// Chunk into 2000-char segments (Notion API limit per rich_text item)
			const chunks: string[] = [];
			for (let i = 0; i < trimmed.length; i += 2000) {
				chunks.push(trimmed.slice(i, i + 2000));
			}
			blocks.push({
				object: "block",
				type: "paragraph",
				paragraph: {
					rich_text: chunks.map((c) => ({
						type: "text",
						text: { content: c },
					})),
				},
			});
		}
	}
	return blocks;
}

// ═════════════════════════════════════════════════════════════
// Extension
// ═════════════════════════════════════════════════════════════

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!getApiKey()) {
			ctx.ui.notify(
				"Notion: NOTION_API_KEY not set. Set it to use Notion tools.",
				"warning"
			);
		}
	});

	// ── notion_search ───────────────────────────────────────
	pi.registerTool({
		name: "notion_search",
		label: "Notion Search",
		description:
			'Search across all pages and databases shared with the integration. Use this to find Notion content by title or text. Returns page/database IDs you can use with other notion_ tools. Requires NOTION_API_KEY env var.',
		parameters: Type.Object({
			query: Type.String({ description: "Search query text" }),
			filter: Type.Optional(
				StringEnum(["page", "database"] as const, {
					description: 'Filter to only pages or databases. Omit for both.',
				})
			),
			page_size: Type.Optional(
				Type.Number({
					description: "Number of results (default 10, max 100)",
				})
			),
		}),

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("notion_search "));
			text += theme.fg("muted", args.query ?? "");
			if (args.filter) text += theme.fg("dim", ` [${args.filter}]`);
			return new Text(text, 0, 0);
		},

		async execute(_id, params, signal) {
			if (!getApiKey()) return noKeyError();

			try {
				const body: any = {
					query: params.query,
					page_size: params.page_size ?? 10,
				};
				if (params.filter) {
					body.filter = { value: params.filter, property: "object" };
				}

				const res = await notionFetch("/search", {
					method: "POST",
					body,
					signal,
				});

				if (!res.ok) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Notion search failed (${res.status}): ${res.data?.message ?? JSON.stringify(res.data)}`,
							},
						],
						details: { error: res.status },
						isError: true,
					};
				}

				const results = res.data.results ?? [];
				if (results.length === 0) {
					return {
						content: [
							{
								type: "text" as const,
								text: `No results found for: ${params.query}`,
							},
						],
						details: { query: params.query, count: 0 },
					};
				}

				let output = `## Notion search: "${params.query}"\n\n`;
				output += `Found ${results.length} result(s):\n\n`;

				for (const item of results) {
					const type = item.object; // "page" or "database"
					const title = getTitle(item);
					const url = item.url ?? "";
					const lastEdited = item.last_edited_time ?? "";

					output += `### ${type === "database" ? "📊" : "📄"} ${title}\n`;
					output += `- **ID:** \`${item.id}\`\n`;
					output += `- **Type:** ${type}\n`;
					if (url) output += `- **URL:** ${url}\n`;
					if (lastEdited) output += `- **Last edited:** ${lastEdited}\n`;
					output += "\n";
				}

				return {
					content: [{ type: "text" as const, text: truncateOutput(output) }],
					details: { query: params.query, count: results.length },
				};
			} catch (err: any) {
				return {
					content: [
						{ type: "text" as const, text: `Notion search error: ${err.message}` },
					],
					details: { error: err.message },
					isError: true,
				};
			}
		},
	});

	// ── notion_read_page ────────────────────────────────────
	pi.registerTool({
		name: "notion_read_page",
		label: "Notion Read Page",
		description:
			"Read a Notion page's properties and content blocks. Provide the page ID (UUID). Returns the page title, properties, and body content as markdown. Requires NOTION_API_KEY env var.",
		parameters: Type.Object({
			page_id: Type.String({ description: "Notion page ID (UUID)" }),
			include_children: Type.Optional(
				Type.Boolean({
					description: "Whether to fetch page body content blocks (default true)",
				})
			),
		}),

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("notion_read_page "));
			text += theme.fg("muted", args.page_id ?? "");
			return new Text(text, 0, 0);
		},

		async execute(_id, params, signal) {
			if (!getApiKey()) return noKeyError();

			try {
				// Fetch page metadata
				const pageRes = await notionFetch(`/pages/${params.page_id}`, { signal });
				if (!pageRes.ok) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Failed to read page (${pageRes.status}): ${pageRes.data?.message ?? JSON.stringify(pageRes.data)}`,
							},
						],
						details: { error: pageRes.status },
						isError: true,
					};
				}

				const page = pageRes.data;
				const title = getTitle(page);
				let output = `# ${title}\n\n`;
				output += `**ID:** \`${page.id}\`\n`;
				if (page.url) output += `**URL:** ${page.url}\n`;
				output += `**Created:** ${page.created_time}\n`;
				output += `**Last edited:** ${page.last_edited_time}\n\n`;

				// Properties
				if (page.properties && Object.keys(page.properties).length > 0) {
					output += `## Properties\n\n`;
					for (const [name, prop] of Object.entries(page.properties) as [string, any][]) {
						const val = formatPropertyValue(prop);
						if (val) output += `- **${name}:** ${val}\n`;
					}
					output += "\n";
				}

				// Content blocks
				if (params.include_children !== false) {
					output += `## Content\n\n`;
					let cursor: string | undefined;
					let blockCount = 0;

					do {
						const blocksPath = `/blocks/${params.page_id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
						const blocksRes = await notionFetch(blocksPath, { signal });

						if (!blocksRes.ok) {
							output += `(Failed to load content blocks: ${blocksRes.status})\n`;
							break;
						}

						for (const block of blocksRes.data.results ?? []) {
							const md = blockToMarkdown(block);
							if (md) output += md + "\n";
							blockCount++;
						}

						cursor = blocksRes.data.has_more
							? blocksRes.data.next_cursor
							: undefined;
					} while (cursor && blockCount < 500);

					if (cursor) {
						output += `\n(Content truncated at ${blockCount} blocks)\n`;
					}
				}

				return {
					content: [{ type: "text" as const, text: truncateOutput(output) }],
					details: { page_id: page.id, title },
				};
			} catch (err: any) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Notion read page error: ${err.message}`,
						},
					],
					details: { error: err.message },
					isError: true,
				};
			}
		},
	});

	// ── notion_query_database ───────────────────────────────
	pi.registerTool({
		name: "notion_query_database",
		label: "Notion Query Database",
		description:
			'Query a Notion database. Returns rows with their properties. You can provide a filter object and sorts array following the Notion API filter format. Use notion_search first to find database IDs. Requires NOTION_API_KEY env var.',
		parameters: Type.Object({
			database_id: Type.String({ description: "Notion database ID (UUID)" }),
			filter: Type.Optional(
				Type.Any({
					description:
						'Notion API filter object, e.g. {"property":"Status","status":{"equals":"Done"}}',
				})
			),
			sorts: Type.Optional(
				Type.Array(Type.Any(), {
					description:
						'Sort array, e.g. [{"property":"Created","direction":"descending"}]',
				})
			),
			page_size: Type.Optional(
				Type.Number({ description: "Number of results (default 20, max 100)" })
			),
		}),

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("notion_query_database "));
			text += theme.fg("muted", args.database_id ?? "");
			return new Text(text, 0, 0);
		},

		async execute(_id, params, signal) {
			if (!getApiKey()) return noKeyError();

			try {
				const body: any = {
					page_size: params.page_size ?? 20,
				};
				if (params.filter) body.filter = params.filter;
				if (params.sorts) body.sorts = params.sorts;

				const res = await notionFetch(
					`/databases/${params.database_id}/query`,
					{ method: "POST", body, signal }
				);

				if (!res.ok) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Database query failed (${res.status}): ${res.data?.message ?? JSON.stringify(res.data)}`,
							},
						],
						details: { error: res.status },
						isError: true,
					};
				}

				const results = res.data.results ?? [];
				let output = `## Database query results\n\n`;
				output += `**Database ID:** \`${params.database_id}\`\n`;
				output += `**Results:** ${results.length}${res.data.has_more ? " (more available)" : ""}\n\n`;

				if (results.length === 0) {
					output += "No matching rows found.\n";
				}

				for (let i = 0; i < results.length; i++) {
					const row = results[i];
					const title = getTitle(row);
					output += `### ${i + 1}. ${title}\n`;
					output += `- **ID:** \`${row.id}\`\n`;
					if (row.url) output += `- **URL:** ${row.url}\n`;

					for (const [name, prop] of Object.entries(row.properties ?? {}) as [string, any][]) {
						if (prop.type === "title") continue; // Already shown
						const val = formatPropertyValue(prop);
						if (val) output += `- **${name}:** ${val}\n`;
					}
					output += "\n";
				}

				return {
					content: [{ type: "text" as const, text: truncateOutput(output) }],
					details: {
						database_id: params.database_id,
						count: results.length,
						has_more: res.data.has_more,
					},
				};
			} catch (err: any) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Notion query error: ${err.message}`,
						},
					],
					details: { error: err.message },
					isError: true,
				};
			}
		},
	});

	// ── notion_create_page ──────────────────────────────────
	pi.registerTool({
		name: "notion_create_page",
		label: "Notion Create Page",
		description:
			'Create a new page in Notion. Specify a parent (page_id or database_id) and provide content as markdown text. When creating in a database, provide properties matching the database schema. Requires NOTION_API_KEY env var.',
		parameters: Type.Object({
			parent_type: StringEnum(["page_id", "database_id"] as const, {
				description: "Whether the parent is a page or database",
			}),
			parent_id: Type.String({ description: "ID of the parent page or database" }),
			title: Type.String({ description: "Page title" }),
			content: Type.Optional(
				Type.String({
					description:
						"Page body content as markdown text. Supports headings (#, ##, ###), bullets (- ), numbered lists (1. ), todos (- [ ] / - [x] ), quotes (> ), and dividers (---).",
				})
			),
			properties: Type.Optional(
				Type.Any({
					description:
						'Additional properties for database pages, as a Notion API properties object. The title property is set automatically from the title parameter.',
				})
			),
		}),

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("notion_create_page "));
			text += theme.fg("muted", `"${args.title ?? ""}" → ${args.parent_id ?? ""}`);
			return new Text(text, 0, 0);
		},

		async execute(_id, params, signal) {
			if (!getApiKey()) return noKeyError();

			try {
				const body: any = {
					parent: { [params.parent_type]: params.parent_id },
					properties: params.properties ?? {},
				};

				// Set title — for databases, find the title property name
				if (params.parent_type === "database_id") {
					// Fetch database schema to find title property
					const dbRes = await notionFetch(
						`/databases/${params.parent_id}`,
						{ signal }
					);
					if (dbRes.ok) {
						for (const [name, prop] of Object.entries(dbRes.data.properties ?? {}) as [string, any][]) {
							if (prop.type === "title") {
								body.properties[name] = {
									title: [
										{ type: "text", text: { content: params.title } },
									],
								};
								break;
							}
						}
					} else {
						// Fallback: assume "Name" is the title property
						body.properties["Name"] = {
							title: [
								{ type: "text", text: { content: params.title } },
							],
						};
					}
				} else {
					body.properties.title = {
						title: [
							{ type: "text", text: { content: params.title } },
						],
					};
				}

				// Convert content to blocks
				if (params.content) {
					body.children = textToBlocks(params.content);
				}

				const res = await notionFetch("/pages", {
					method: "POST",
					body,
					signal,
				});

				if (!res.ok) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Failed to create page (${res.status}): ${res.data?.message ?? JSON.stringify(res.data)}`,
							},
						],
						details: { error: res.status },
						isError: true,
					};
				}

				const page = res.data;
				return {
					content: [
						{
							type: "text" as const,
							text: `✓ Page created: "${params.title}"\n\n- **ID:** \`${page.id}\`\n- **URL:** ${page.url}`,
						},
					],
					details: { page_id: page.id, url: page.url, title: params.title },
				};
			} catch (err: any) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Notion create page error: ${err.message}`,
						},
					],
					details: { error: err.message },
					isError: true,
				};
			}
		},
	});

	// ── notion_update_page ──────────────────────────────────
	pi.registerTool({
		name: "notion_update_page",
		label: "Notion Update Page",
		description:
			'Update a Notion page\'s properties. Provide the page ID and a properties object following the Notion API format. Can also archive/unarchive a page. Requires NOTION_API_KEY env var.',
		parameters: Type.Object({
			page_id: Type.String({ description: "Notion page ID (UUID)" }),
			properties: Type.Optional(
				Type.Any({
					description:
						'Properties to update, as Notion API properties object. E.g. {"Status":{"status":{"name":"Done"}}}',
				})
			),
			archived: Type.Optional(
				Type.Boolean({ description: "Set to true to archive, false to unarchive" })
			),
		}),

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("notion_update_page "));
			text += theme.fg("muted", args.page_id ?? "");
			if (args.archived != null)
				text += theme.fg("dim", args.archived ? " [archive]" : " [unarchive]");
			return new Text(text, 0, 0);
		},

		async execute(_id, params, signal) {
			if (!getApiKey()) return noKeyError();

			try {
				const body: any = {};
				if (params.properties) body.properties = params.properties;
				if (params.archived != null) body.archived = params.archived;

				const res = await notionFetch(`/pages/${params.page_id}`, {
					method: "PATCH",
					body,
					signal,
				});

				if (!res.ok) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Failed to update page (${res.status}): ${res.data?.message ?? JSON.stringify(res.data)}`,
							},
						],
						details: { error: res.status },
						isError: true,
					};
				}

				const page = res.data;
				const title = getTitle(page);
				return {
					content: [
						{
							type: "text" as const,
							text: `✓ Page updated: "${title}"\n\n- **ID:** \`${page.id}\`\n- **URL:** ${page.url}`,
						},
					],
					details: { page_id: page.id, title },
				};
			} catch (err: any) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Notion update page error: ${err.message}`,
						},
					],
					details: { error: err.message },
					isError: true,
				};
			}
		},
	});

	// ── notion_append_blocks ────────────────────────────────
	pi.registerTool({
		name: "notion_append_blocks",
		label: "Notion Append Blocks",
		description:
			"Append content blocks to an existing Notion page or block. Provide markdown text that will be converted to Notion blocks and appended. Requires NOTION_API_KEY env var.",
		parameters: Type.Object({
			block_id: Type.String({
				description: "ID of the page or block to append to",
			}),
			content: Type.String({
				description:
					"Content as markdown text to append. Supports headings, bullets, numbered lists, todos, quotes, and dividers.",
			}),
		}),

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("notion_append_blocks "));
			text += theme.fg("muted", args.block_id ?? "");
			return new Text(text, 0, 0);
		},

		async execute(_id, params, signal) {
			if (!getApiKey()) return noKeyError();

			try {
				const blocks = textToBlocks(params.content);
				const res = await notionFetch(
					`/blocks/${params.block_id}/children`,
					{
						method: "PATCH",
						body: { children: blocks },
						signal,
					}
				);

				if (!res.ok) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Failed to append blocks (${res.status}): ${res.data?.message ?? JSON.stringify(res.data)}`,
							},
						],
						details: { error: res.status },
						isError: true,
					};
				}

				return {
					content: [
						{
							type: "text" as const,
							text: `✓ Appended ${blocks.length} block(s) to \`${params.block_id}\``,
						},
					],
					details: {
						block_id: params.block_id,
						blocks_appended: blocks.length,
					},
				};
			} catch (err: any) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Notion append error: ${err.message}`,
						},
					],
					details: { error: err.message },
					isError: true,
				};
			}
		},
	});

	// ── notion_list_databases ───────────────────────────────
	pi.registerTool({
		name: "notion_list_databases",
		label: "Notion List Databases",
		description:
			"List all databases shared with the integration. Returns database IDs, titles, and their property schemas. Useful for discovering what databases are available and their structure before querying. Requires NOTION_API_KEY env var.",
		parameters: Type.Object({}),

		renderCall(_args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("notion_list_databases")),
				0,
				0
			);
		},

		async execute(_id, _params, signal) {
			if (!getApiKey()) return noKeyError();

			try {
				const res = await notionFetch("/search", {
					method: "POST",
					body: {
						filter: { value: "database", property: "object" },
						page_size: 100,
					},
					signal,
				});

				if (!res.ok) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Failed to list databases (${res.status}): ${res.data?.message ?? JSON.stringify(res.data)}`,
							},
						],
						details: { error: res.status },
						isError: true,
					};
				}

				const databases = res.data.results ?? [];
				if (databases.length === 0) {
					return {
						content: [
							{
								type: "text" as const,
								text: "No databases found. Make sure you've shared databases with your integration in Notion (... → Connections).",
							},
						],
						details: { count: 0 },
					};
				}

				let output = `## Notion Databases\n\nFound ${databases.length} database(s):\n\n`;

				for (const db of databases) {
					const title = getTitle(db);
					output += `### 📊 ${title}\n`;
					output += `- **ID:** \`${db.id}\`\n`;
					if (db.url) output += `- **URL:** ${db.url}\n`;

					// Show schema
					const props = db.properties ?? {};
					const propEntries = Object.entries(props) as [string, any][];
					if (propEntries.length > 0) {
						output += `- **Properties:**\n`;
						for (const [name, prop] of propEntries) {
							let info = prop.type;
							if (prop.type === "select" && prop.select?.options) {
								const opts = prop.select.options
									.map((o: any) => o.name)
									.join(", ");
								info += ` (${opts})`;
							}
							if (prop.type === "multi_select" && prop.multi_select?.options) {
								const opts = prop.multi_select.options
									.map((o: any) => o.name)
									.join(", ");
								info += ` (${opts})`;
							}
							if (prop.type === "status" && prop.status?.options) {
								const opts = prop.status.options
									.map((o: any) => o.name)
									.join(", ");
								info += ` (${opts})`;
							}
							output += `  - \`${name}\`: ${info}\n`;
						}
					}
					output += "\n";
				}

				return {
					content: [{ type: "text" as const, text: truncateOutput(output) }],
					details: { count: databases.length },
				};
			} catch (err: any) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Notion list databases error: ${err.message}`,
						},
					],
					details: { error: err.message },
					isError: true,
				};
			}
		},
	});
}
