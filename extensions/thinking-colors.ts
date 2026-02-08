/**
 * Thinking Level Colors Extension
 *
 * Colors the thinking level status text in the footer based on the current level.
 * Uses the theme's thinking colors (thinkingOff, thinkingMinimal, etc.)
 */

import type { AssistantMessage, ThinkingLevel } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

// Colorize text with a hex color directly (bypasses theme for vivid contrast)
function colorize(hex: string, text: string): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

// Vivid, highly distinct colors for each thinking level
function colorizeThinkingLevel(level: ThinkingLevel, text: string): string {
	switch (level) {
		case "off":     return colorize("#666666", text); // dark gray - clearly muted/off
		case "minimal": return colorize("#5fafd7", text); // steel blue
		case "low":     return colorize("#87d7af", text); // soft green
		case "medium":  return colorize("#ffdf5f", text); // warm yellow
		case "high":    return colorize("#ff8700", text); // vivid orange
		case "xhigh":   return colorize("#ff3333", text); // bold red
		default:        return colorize("#666666", text);
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					// Calculate cumulative usage from ALL session entries
					let totalInput = 0;
					let totalOutput = 0;
					let totalCacheRead = 0;
					let totalCacheWrite = 0;
					let totalCost = 0;

					for (const entry of ctx.sessionManager.getEntries()) {
						if (entry.type === "message" && entry.message.role === "assistant") {
							const m = entry.message as AssistantMessage;
							totalInput += m.usage.input;
							totalOutput += m.usage.output;
							totalCacheRead += m.usage.cacheRead;
							totalCacheWrite += m.usage.cacheWrite;
							totalCost += m.usage.cost.total;
						}
					}

					// Get last assistant message for context percentage calculation
					const messages = ctx.sessionManager.getBranch()
						.filter(e => e.type === "message")
						.map(e => (e as any).message);
					const lastAssistantMessage = messages
						.slice()
						.reverse()
						.find((m: any) => m.role === "assistant" && m.stopReason !== "aborted") as AssistantMessage | undefined;

					const contextTokens = lastAssistantMessage
						? lastAssistantMessage.usage.input +
						  lastAssistantMessage.usage.output +
						  lastAssistantMessage.usage.cacheRead +
						  lastAssistantMessage.usage.cacheWrite
						: 0;
					const contextWindow = ctx.model?.contextWindow || 0;
					const contextPercentValue = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;
					const contextPercent = contextPercentValue.toFixed(1);

					// Replace home directory with ~
					let pwd = process.cwd();
					const home = process.env.HOME || process.env.USERPROFILE;
					if (home && pwd.startsWith(home)) {
						pwd = `~${pwd.slice(home.length)}`;
					}

					// Add git branch if available
					const branch = footerData.getGitBranch();
					if (branch) {
						pwd = `${pwd} (${branch})`;
					}

					// Add session name if set
					const sessionName = ctx.sessionManager.getSessionName();
					if (sessionName) {
						pwd = `${pwd} • ${sessionName}`;
					}

					// Truncate path if too long
					pwd = truncateToWidth(pwd, width);

					// Build stats parts (plain text, will color later)
					const statsParts: string[] = [];
					if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
					if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
					if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
					if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);
					if (totalCost) statsParts.push(`$${totalCost.toFixed(3)}`);

					// Context percentage (may be colored)
					const contextPercentDisplay = `${contextPercent}%/${formatTokens(contextWindow)}`;
					let contextPercentColored: string;
					if (contextPercentValue > 90) {
						contextPercentColored = theme.fg("error", contextPercentDisplay);
					} else if (contextPercentValue > 70) {
						contextPercentColored = theme.fg("warning", contextPercentDisplay);
					} else {
						contextPercentColored = theme.fg("dim", contextPercentDisplay);
					}

					// Build left side: dim stats + colored context
					const statsPlain = statsParts.join(" ");
					const leftPart = statsParts.length > 0 
						? theme.fg("dim", statsPlain + " ") + contextPercentColored
						: contextPercentColored;
					const leftWidth = visibleWidth(leftPart);

					// Build right side with model name and thinking level
					const modelName = ctx.model?.id || "no-model";
					let rightPlain = modelName;
					let rightColored = theme.fg("dim", modelName);

					// Add thinking level with vivid color if model supports reasoning
					if (ctx.model?.reasoning) {
						const thinkingLevel = (pi.getThinkingLevel() || "off") as ThinkingLevel;
						const levelText = thinkingLevel === "off" ? "thinking off" : thinkingLevel;
						rightPlain = `${modelName} • ${levelText}`;
						rightColored = theme.fg("dim", `${modelName} • `) + colorizeThinkingLevel(thinkingLevel, levelText);
					}

					// Add provider prefix if multiple providers available
					if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
						const providerPrefix = `(${ctx.model.provider}) `;
						const providerPrefixWidth = visibleWidth(providerPrefix);
						const minPadding = 2;
						if (leftWidth + minPadding + providerPrefixWidth + visibleWidth(rightPlain) <= width) {
							rightColored = theme.fg("dim", providerPrefix) + rightColored;
							rightPlain = providerPrefix + rightPlain;
						}
					}

					const rightWidth = visibleWidth(rightPlain);
					const minPadding = 2;
					const totalNeeded = leftWidth + minPadding + rightWidth;

					let statsLine: string;
					if (totalNeeded <= width) {
						// Both fit - add padding
						const padding = " ".repeat(width - leftWidth - rightWidth);
						statsLine = leftPart + padding + rightColored;
					} else {
						// Need to truncate - just show left side
						statsLine = truncateToWidth(leftPart, width);
					}

					const lines = [
						theme.fg("dim", pwd),
						statsLine
					];

					// Add extension statuses
					const extensionStatuses = footerData.getExtensionStatuses();
					if (extensionStatuses.size > 0) {
						const sortedStatuses = Array.from(extensionStatuses.entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, text]) => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim());
						const statusLine = sortedStatuses.join(" ");
						lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
					}

					return lines;
				},
			};
		});
	});
}
