/**
 * Web Search & Read — Search the web and read pages.
 *
 * Search: DuckDuckGo Lite via Jina Reader (no API key needed)
 * Read:   Jina Reader r.jina.ai (no API key needed)
 *
 * Optional: Set JINA_API_KEY env var for higher rate limits on Jina Reader.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";

const READER_URL = "https://r.jina.ai/";
const DDG_LITE_URL = "https://lite.duckduckgo.com/lite/?q=";
const TIMEOUT_MS = 30_000;

function jinaHeaders(): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: "application/json",
	};
	const key = process.env.JINA_API_KEY;
	if (key) {
		headers["Authorization"] = `Bearer ${key}`;
	}
	return headers;
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

/** Extract the real URL from a DuckDuckGo redirect link */
function extractDdgUrl(ddgUrl: string): string {
	try {
		const u = new URL(ddgUrl);
		const real = u.searchParams.get("uddg");
		if (real) return real;
	} catch {}
	return ddgUrl;
}

interface SearchResult {
	index: number;
	title: string;
	url: string;
	snippet: string;
}

/** Parse DuckDuckGo Lite markdown content into structured results */
function parseDdgResults(content: string): SearchResult[] {
	const results: SearchResult[] = [];
	// DDG Lite format via Jina:
	// 1.[Title](https://duckduckgo.com/l/?uddg=ENCODED_URL&...)
	// Snippet text with **bold** keywords...
	// domain.com/path
	//
	// 2.[Title](url)
	// ...

	const entryPattern = /(\d+)\.\[([^\]]+)\]\(([^)]+)\)\s*\n([\s\S]*?)(?=\n\d+\.\[|\n*$)/g;
	let match;
	while ((match = entryPattern.exec(content)) !== null) {
		const index = parseInt(match[1], 10);
		const title = match[2];
		const rawUrl = match[3];
		const body = match[4].trim();

		const url = extractDdgUrl(rawUrl);

		// The body contains the snippet followed by a domain line
		// Remove the last line (bare domain) and bold markers
		const bodyLines = body.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
		// Last line is usually the bare domain
		if (bodyLines.length > 1) {
			bodyLines.pop();
		}
		const snippet = bodyLines.join(" ").replace(/\*\*/g, "");

		results.push({ index, title, url, snippet });
	}

	return results;
}

export default function (pi: ExtensionAPI) {
	// ── web_search ──────────────────────────────────────────────
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web for a query via DuckDuckGo. Returns results with titles, URLs, and snippets. Use this to find documentation, facts, APIs, or any web information.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
		}),

		renderCall(args: { query?: string }, theme) {
			let text = theme.fg("toolTitle", theme.bold("web_search "));
			text += theme.fg("muted", args.query ?? "");
			return new Text(text, 0, 0);
		},

		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			const { query } = params as { query: string };

			try {
				// Show query immediately while waiting for results
				onUpdate?.({
					content: [{ type: "text", text: `Searching for: ${query}` }],
				});

				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
				if (signal) {
					signal.addEventListener("abort", () => controller.abort(), { once: true });
				}

				// Use Jina Reader to fetch DDG Lite results as clean markdown
				const searchUrl = DDG_LITE_URL + encodeURIComponent(query);
				const res = await fetch(READER_URL + searchUrl, {
					headers: jinaHeaders(),
					signal: controller.signal,
				});
				clearTimeout(timeout);

				if (!res.ok) {
					const body = await res.text().catch(() => "");
					return {
						content: [{ type: "text" as const, text: `Search failed (${res.status}): ${body}` }],
						details: { error: `HTTP ${res.status}`, query },
						isError: true,
					};
				}

				const json = (await res.json()) as {
					data?: { content?: string };
				};

				const rawContent = json.data?.content;
				if (!rawContent) {
					return {
						content: [{ type: "text" as const, text: `No results returned for: ${query}` }],
						details: { query, resultCount: 0 },
					};
				}

				const results = parseDdgResults(rawContent);

				if (results.length === 0) {
					// Fallback: return raw content if parsing failed
					return {
						content: [{ type: "text" as const, text: truncateOutput(`## Search results for: ${query}\n\n${rawContent}`) }],
						details: { query, resultCount: 0, raw: true },
					};
				}

				let output = `## Search results for: ${query}\n\n`;
				for (const r of results) {
					output += `### ${r.index}. ${r.title}\n`;
					output += `URL: ${r.url}\n`;
					if (r.snippet) {
						output += `${r.snippet}\n`;
					}
					output += "\n";
				}

				return {
					content: [{ type: "text" as const, text: truncateOutput(output) }],
					details: { query, resultCount: results.length },
				};
			} catch (err: any) {
				if (err.name === "AbortError") {
					return {
						content: [{ type: "text" as const, text: `Search timed out or was cancelled for: ${query}` }],
						details: { error: "timeout", query },
						isError: true,
					};
				}
				return {
					content: [{ type: "text" as const, text: `Search error: ${err.message}` }],
					details: { error: err.message, query },
					isError: true,
				};
			}
		},
	});

	// ── web_read ────────────────────────────────────────────────
	pi.registerTool({
		name: "web_read",
		label: "Web Read",
		description:
			"Fetch a URL and return its content as clean Markdown. Use this to read documentation pages, articles, or any web page. Use web_search first to find URLs, then web_read to get full content.",
		parameters: Type.Object({
			url: Type.String({ description: "URL to read" }),
		}),

		renderCall(args: { url?: string }, theme) {
			let text = theme.fg("toolTitle", theme.bold("web_read "));
			text += theme.fg("muted", args.url ?? "");
			return new Text(text, 0, 0);
		},

		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			const { url } = params as { url: string };

			try {
				// Show URL immediately while waiting for content
				onUpdate?.({
					content: [{ type: "text", text: `Reading: ${url}` }],
				});

				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
				if (signal) {
					signal.addEventListener("abort", () => controller.abort(), { once: true });
				}

				const res = await fetch(READER_URL + url, {
					headers: {
						...jinaHeaders(),
						"X-Return-Format": "markdown",
					},
					signal: controller.signal,
				});
				clearTimeout(timeout);

				if (!res.ok) {
					const body = await res.text().catch(() => "");
					return {
						content: [{ type: "text" as const, text: `Failed to read URL (${res.status}): ${body}` }],
						details: { error: `HTTP ${res.status}`, url },
						isError: true,
					};
				}

				const json = (await res.json()) as {
					data?: {
						title?: string;
						url?: string;
						content?: string;
					};
				};

				if (!json.data?.content) {
					return {
						content: [{ type: "text" as const, text: `No content extracted from: ${url}` }],
						details: { url },
					};
				}

				let output = "";
				if (json.data.title) {
					output += `# ${json.data.title}\n\n`;
				}
				output += `Source: ${json.data.url ?? url}\n\n`;
				output += json.data.content;

				return {
					content: [{ type: "text" as const, text: truncateOutput(output) }],
					details: { url: json.data.url ?? url, title: json.data.title },
				};
			} catch (err: any) {
				if (err.name === "AbortError") {
					return {
						content: [{ type: "text" as const, text: `Read timed out or was cancelled for: ${url}` }],
						details: { error: "timeout", url },
						isError: true,
					};
				}
				return {
					content: [{ type: "text" as const, text: `Read error: ${err.message}` }],
					details: { error: err.message, url },
					isError: true,
				};
			}
		},
	});
}
