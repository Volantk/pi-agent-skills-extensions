/**
 * Discord Bot Notification Extension
 *
 * Two-way Discord integration:
 * - Sends notifications to Discord when pi needs your input
 * - Reads your Discord replies (text + voice messages) and pipes them back into pi
 * - Voice messages are transcribed locally using Moonshine (via transformers.js)
 *
 * Each pi session gets its own forum thread. Reply in the thread
 * and your message arrives in pi as if you typed it.
 *
 * Setup:
 *   1. Create a bot at https://discord.com/developers/applications
 *   2. Enable "Message Content Intent" in Bot settings
 *   3. Invite bot to server with Send Messages + Read Messages permissions
 *   4. In pi: /discord-setup <bot-token> <channel-id>
 *
 * Commands:
 *   /discord-setup <token> <channel-id>  - Configure bot and channel
 *   /discord-test                        - Send a test notification
 *   /discord-toggle                      - Enable/disable notifications
 *   /discord-config                      - Show current configuration
 *   /discord-rename [name]               - Rename thread (empty = auto-generate from context)
 *   /discord-unmute                      - Unmute the current session's thread
 *
 * Reactions (in Discord threads):
 *   🔇  - Mute thread (stop all notifications)
 *   🗑️  - Mute + delete thread
 *
 * Config stored in ~/.pi/agent/discord-notify.json
 */

import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { completeSimple } from "@mariozechner/pi-ai";
import {
	Client,
	GatewayIntentBits,
	Partials,
	ChannelType,
	EmbedBuilder,
	MessageFlags,
	AttachmentBuilder,
	type TextChannel,
	type ForumChannel,
	type ThreadChannel,
	type Message,
	type MessageReaction,
	type User,
	type PartialMessageReaction,
	type PartialUser,
} from "discord.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────────────────────

interface DiscordConfig {
	channelId: string;
	enabled: boolean;
	/** Minimum agent duration (ms) before sending notification. Default: 15000 (15s) */
	minDurationMs: number;
	/** Include a preview of the agent's last message */
	includePreview: boolean;
}

/** Maps session file path → Discord thread ID */
interface ThreadMap {
	[sessionFile: string]: string;
}

// ── Paths ──────────────────────────────────────────────────────────────

const PI_DIR = path.join(os.homedir(), ".pi", "agent");
const CONFIG_PATH = path.join(PI_DIR, "discord-notify.json");
const THREADS_PATH = path.join(PI_DIR, "discord-threads.json");
const MUTED_PATH = path.join(PI_DIR, "discord-muted.json");

// ── Persistence ────────────────────────────────────────────────────────

function loadConfig(): DiscordConfig | null {
	try {
		if (fs.existsSync(CONFIG_PATH)) {
			return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
		}
	} catch {
		// ignore
	}
	return null;
}

function saveConfig(config: DiscordConfig): void {
	fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function loadThreads(): ThreadMap {
	try {
		if (fs.existsSync(THREADS_PATH)) {
			return JSON.parse(fs.readFileSync(THREADS_PATH, "utf-8"));
		}
	} catch {
		// ignore
	}
	return {};
}

function saveThreads(threads: ThreadMap): void {
	fs.writeFileSync(THREADS_PATH, JSON.stringify(threads, null, 2));
}

/** Set of muted thread IDs — no notifications sent to these */
function loadMuted(): Set<string> {
	try {
		if (fs.existsSync(MUTED_PATH)) {
			const arr = JSON.parse(fs.readFileSync(MUTED_PATH, "utf-8"));
			return new Set(Array.isArray(arr) ? arr : []);
		}
	} catch {
		// ignore
	}
	return new Set();
}

function saveMuted(muted: Set<string>): void {
	fs.writeFileSync(MUTED_PATH, JSON.stringify([...muted], null, 2));
}

// ── Helpers ────────────────────────────────────────────────────────────

function truncateText(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen - 3) + "...";
}

function extractLastAssistantText(messages: Array<{ role: string; content: unknown }>): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			const content = msg.content;
			if (typeof content === "string") return content;
			if (Array.isArray(content)) {
				const textParts = content
					.filter((c: any) => c.type === "text")
					.map((c: any) => c.text)
					.join("\n");
				if (textParts) return textParts;
			}
		}
	}
	return null;
}

// ── Voice message transcription (Moonshine via transformers.js) ────────

let transcriber: any = null;
let transcriberLoading: Promise<any> | null = null;

async function getTranscriber() {
	if (transcriber) return transcriber;
	if (transcriberLoading) return transcriberLoading;

	transcriberLoading = (async () => {
		const { pipeline } = await import("@huggingface/transformers");
		console.log("[discord-notify] Loading Whisper base model (first time may download ~200MB)...");
		transcriber = await pipeline(
			"automatic-speech-recognition",
			"onnx-community/whisper-base",
		);
		console.log("[discord-notify] Whisper base model loaded.");
		return transcriber;
	})();

	return transcriberLoading;
}

/**
 * Read a WAV file and return Float32Array of audio samples.
 * Assumes 16-bit PCM mono WAV (which is what we produce via ffmpeg).
 */
function readWavAsFloat32(wavPath: string): Float32Array {
	const buffer = fs.readFileSync(wavPath);

	// Find the "data" chunk — skip the WAV header
	let dataOffset = 12; // skip RIFF header
	while (dataOffset < buffer.length - 8) {
		const chunkId = buffer.toString("ascii", dataOffset, dataOffset + 4);
		const chunkSize = buffer.readUInt32LE(dataOffset + 4);
		if (chunkId === "data") {
			dataOffset += 8;
			const samples = new Float32Array(chunkSize / 2);
			for (let i = 0; i < samples.length; i++) {
				samples[i] = buffer.readInt16LE(dataOffset + i * 2) / 32768;
			}
			return samples;
		}
		dataOffset += 8 + chunkSize;
	}

	throw new Error("Could not find data chunk in WAV file");
}

/**
 * Download a Discord voice message and transcribe it using Moonshine.
 * Discord voice messages are ogg/opus — we use ffmpeg to convert to 16kHz wav.
 */
async function transcribeVoiceMessage(url: string): Promise<string | null> {
	const tmpDir = os.tmpdir();
	const ts = Date.now();
	const oggPath = path.join(tmpDir, `discord-voice-${ts}.ogg`);
	const wavPath = path.join(tmpDir, `discord-voice-${ts}.wav`);

	try {
		// Download the ogg file
		const response = await fetch(url);
		if (!response.ok) return null;
		const buffer = Buffer.from(await response.arrayBuffer());
		fs.writeFileSync(oggPath, buffer);

		// Convert to 16kHz mono 16-bit PCM WAV using ffmpeg
		await execFileAsync("ffmpeg", [
			"-i", oggPath,
			"-ar", "16000",
			"-ac", "1",
			"-sample_fmt", "s16",
			"-f", "wav",
			"-y",
			wavPath,
		]);

		// Read WAV as raw float32 samples
		const audioData = readWavAsFloat32(wavPath);

		// Transcribe with Moonshine
		const asr = await getTranscriber();
		const result = await asr(audioData, { sampling_rate: 16000 });

		return result?.text?.trim() || null;
	} catch (err: any) {
		console.error(`[discord-notify] Transcription failed: ${err?.message}`);
		return null;
	} finally {
		// Cleanup temp files
		try { fs.unlinkSync(oggPath); } catch {}
		try { fs.unlinkSync(wavPath); } catch {}
	}
}

// ── Image handling ─────────────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const IMAGE_MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
};

function isImagePath(filePath: string): boolean {
	return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function getImageMediaType(filePath: string): string {
	return IMAGE_MIME[path.extname(filePath).toLowerCase()] || "image/png";
}

/**
 * Download a Discord image attachment and return as base64 with media type.
 */
async function downloadImageAsBase64(url: string): Promise<{ base64: string; mediaType: string } | null> {
	try {
		const response = await fetch(url);
		if (!response.ok) return null;

		const contentType = response.headers.get("content-type") || "image/png";
		const buffer = Buffer.from(await response.arrayBuffer());
		const base64 = buffer.toString("base64");

		// Map content type to supported media types
		let mediaType = contentType.split(";")[0].trim();
		if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mediaType)) {
			mediaType = "image/png";
		}

		return { base64, mediaType };
	} catch (err: any) {
		console.error(`[discord-notify] Failed to download image: ${err?.message}`);
		return null;
	}
}

// ── Extension ──────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let config = loadConfig();
	let threads = loadThreads();
	let mutedThreads = loadMuted();
	let agentStartTime = 0;

	let client: Client | null = null;
	let botUserId: string | null = null;
	let isForum = false;
	let isAgentBusy = false;
	let lastKnownSessionName: string | null = null;
	let threadAutoNamed = false; // whether we've already auto-generated a name for current session

	// Set of thread IDs we're watching (values are session keys)
	const watchedThreads = new Map<string, string>();

	// ── Bot lifecycle ────────────────────────────────────────────────

	function getBotToken(): string | null {
		return process.env.DISCORD_BOT_TOKEN || null;
	}

	async function startBot(): Promise<{ ok: boolean; error?: string }> {
		const botToken = getBotToken();
		if (!botToken) return { ok: false, error: "DISCORD_BOT_TOKEN environment variable not set" };
		if (client) return { ok: true }; // already running

		try {
			client = new Client({
				intents: [
					GatewayIntentBits.Guilds,
					GatewayIntentBits.GuildMessages,
					GatewayIntentBits.MessageContent,
					GatewayIntentBits.GuildMessageReactions,
				],
				partials: [Partials.Reaction, Partials.Message],
			});

			// Listen for replies in watched threads
			client.on("messageCreate", async (message: Message) => {
				if (message.author.bot) return;
				if (!message.channel.isThread()) return;

				const threadId = message.channel.id;
				const sessionKey = watchedThreads.get(threadId);
				if (!sessionKey) return;

				// Only pipe through if this thread belongs to the current session
				const currentSession = currentSessionFile;
				if (sessionKey !== currentSession) return;

				// Check for voice message
				const isVoiceMessage = message.flags.has(MessageFlags.IsVoiceMessage);
				const voiceAttachment = isVoiceMessage
					? message.attachments.find((a) => a.contentType?.includes("audio"))
					: undefined;

				// Check for image attachments
				const imageAttachments = message.attachments.filter(
					(a) => a.contentType?.startsWith("image/"),
				);

				let text = message.content || "";

				// Handle voice messages
				if (voiceAttachment) {
					await message.react("🎙️").catch(() => {});

					const transcription = await transcribeVoiceMessage(voiceAttachment.url);

					if (transcription) {
						text = transcription;
						await message
							.reply({ content: `🎙️ *"${transcription}"*`, allowedMentions: { repliedUser: false } })
							.catch(() => {});
					} else {
						await message
							.reply({ content: "❌ Failed to transcribe voice message", allowedMentions: { repliedUser: false } })
							.catch(() => {});
						return;
					}
				}

				// Handle image attachments
				if (imageAttachments.size > 0) {
					await message.react("🖼️").catch(() => {});

					const contentParts: any[] = [];
					if (text) {
						contentParts.push({ type: "text", text });
					}

					for (const [, attachment] of imageAttachments) {
						const imgData = await downloadImageAsBase64(attachment.url);
						if (imgData) {
							contentParts.push({
								type: "image",
								mimeType: imgData.mediaType,
								data: imgData.base64,
							});
						}
					}

					if (contentParts.length === 0) return;

					// If no text was provided, add a default prompt
					if (!text) {
						contentParts.unshift({ type: "text", text: "Here's an image from Discord:" });
					}

					try {
						if (isAgentBusy) {
							pi.sendUserMessage(contentParts, { deliverAs: "followUp" });
						} else {
							pi.sendUserMessage(contentParts);
						}
					} catch (err: any) {
						console.error(`Failed to pipe Discord image to pi: ${err?.message}`);
					}
					return;
				}

				// Handle plain text
				if (!text) return;

				try {
					if (isAgentBusy) {
						pi.sendUserMessage(text, { deliverAs: "followUp" });
					} else {
						pi.sendUserMessage(text);
					}
				} catch (err: any) {
					console.error(`Failed to pipe Discord message to pi: ${err?.message}`);
				}
			});

			// Listen for reactions in watched threads
			client.on("messageReactionAdd", async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
				// Fetch partial if needed (reactions on uncached messages)
				if (reaction.partial) {
					try { await reaction.fetch(); } catch { return; }
				}

				if (user.bot) return;
				const channel = reaction.message.channel;
				if (!channel.isThread()) return;

				const threadId = channel.id;
				const sessionKey = watchedThreads.get(threadId);
				if (!sessionKey) return;

				const emoji = reaction.emoji.name;

				// 🔇 = mute this thread (stop sending notifications)
				if (emoji === "🔇") {
					mutedThreads.add(threadId);
					saveMuted(mutedThreads);
					try {
						await (channel as ThreadChannel).send({ content: "🔇 Thread muted — no more notifications will be sent here." });
						await reaction.message.react("✅").catch(() => {});
					} catch {}
					return;
				}

				// 🗑️ = mute + delete thread
				if (emoji === "🗑️") {
					mutedThreads.add(threadId);
					saveMuted(mutedThreads);

					// Clean up thread mapping
					watchedThreads.delete(threadId);
					if (sessionKey) {
						delete threads[sessionKey];
						saveThreads(threads);
					}

					try {
						await (channel as ThreadChannel).send({ content: "🗑️ Thread will be deleted in 3 seconds..." });
						await new Promise(r => setTimeout(r, 3000));
						await (channel as ThreadChannel).delete("Deleted via 🗑️ reaction");
					} catch (err: any) {
						console.error(`[discord-notify] Failed to delete thread: ${err?.message}`);
					}
					return;
				}
			});

			await client.login(botToken);
			botUserId = client.user?.id ?? null;

			// Detect if channel is a forum
			const channel = await client.channels.fetch(config.channelId);
			isForum = channel?.type === ChannelType.GuildForum;

			// Rebuild watched threads from current thread map
			for (const [sessionKey, threadId] of Object.entries(threads)) {
				watchedThreads.set(threadId, sessionKey);
			}

			return { ok: true };
		} catch (err: any) {
			client = null;
			return { ok: false, error: err?.message ?? String(err) };
		}
	}

	async function stopBot(): Promise<void> {
		if (client) {
			await client.destroy().catch(() => {});
			client = null;
			botUserId = null;
		}
	}

	// ── Thread management ────────────────────────────────────────────

	let currentSessionFile: string | null = null;

	function getSessionKey(ctx: { sessionManager: { getSessionFile(): string | null } }): string | null {
		return ctx.sessionManager.getSessionFile();
	}

	function makeThreadName(ctx: { cwd: string }): string {
		const project = path.basename(ctx.cwd);
		const sessionName = pi.getSessionName();

		if (sessionName) {
			return truncateText(`${project} — ${sessionName}`, 100);
		}
		return truncateText(`${project} — new session`, 100);
	}

	async function renameCurrentThread(name: string): Promise<boolean> {
		if (!client || !currentSessionFile) return false;

		const threadId = threads[currentSessionFile];
		if (!threadId) return false;

		try {
			const thread = await client.channels.fetch(threadId);
			if (thread?.isThread()) {
				await (thread as ThreadChannel).setName(truncateText(name, 100));
				return true;
			}
		} catch (err: any) {
			console.error(`[discord-notify] Failed to rename thread: ${err?.message}`);
		}
		return false;
	}

	/**
	 * Use the current LLM to generate a short thread name from conversation context.
	 * Returns null if it fails (no model, no API key, etc.)
	 */
	async function generateThreadName(ctx: ExtensionContext): Promise<string | null> {
		const model = ctx.model;
		if (!model) return null;

		const apiKey = await ctx.modelRegistry.getApiKey(model);
		if (!apiKey) return null;

		// Gather conversation context — take first few user/assistant messages
		const entries = ctx.sessionManager.getBranch();
		const snippets: string[] = [];
		let charBudget = 2000;

		for (const entry of entries) {
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (msg.role !== "user" && msg.role !== "assistant") continue;

			let text = "";
			if (typeof msg.content === "string") {
				text = msg.content;
			} else if (Array.isArray(msg.content)) {
				text = msg.content
					.filter((c: any) => c.type === "text")
					.map((c: any) => c.text)
					.join("\n");
			}
			if (!text) continue;

			const snippet = truncateText(text, Math.min(400, charBudget));
			snippets.push(`${msg.role}: ${snippet}`);
			charBudget -= snippet.length;
			if (charBudget <= 0) break;
		}

		if (snippets.length === 0) return null;

		try {
			const result = await completeSimple(model, {
				systemPrompt: "Generate a short, descriptive thread title (max 6 words) for this conversation. Respond with ONLY the title, no quotes, no punctuation at the end, no explanation.",
				messages: [
					{
						role: "user" as const,
						content: snippets.join("\n\n"),
						timestamp: Date.now(),
					},
				],
			}, { apiKey, maxTokens: 50 });

			const text = result.content
				.filter((c: any) => c.type === "text")
				.map((c: any) => c.text)
				.join("")
				.trim();

			if (text && text.length > 0 && text.length <= 80) {
				return text;
			}
		} catch (err: any) {
			console.error(`[discord-notify] Failed to generate thread name: ${err?.message}`);
		}
		return null;
	}

	async function getOrCreateThread(
		ctx: { cwd: string; sessionManager: { getSessionFile(): string | null } },
		firstEmbed?: EmbedBuilder,
	): Promise<ThreadChannel | null> {
		if (!client || !config) return null;

		const sessionKey = getSessionKey(ctx);
		const existingThreadId = sessionKey ? threads[sessionKey] : undefined;

		// Don't send to muted threads
		if (existingThreadId && mutedThreads.has(existingThreadId)) return null;

		// Try existing thread
		if (existingThreadId) {
			try {
				const thread = await client.channels.fetch(existingThreadId);
				if (thread?.isThread()) {
					if (thread.archived) {
						await thread.setArchived(false);
					}
					return thread as ThreadChannel;
				}
			} catch {
				if (sessionKey) {
					delete threads[sessionKey];
					watchedThreads.delete(existingThreadId);
					saveThreads(threads);
				}
			}
		}

		// Create new thread
		const threadName = makeThreadName(ctx);

		try {
			const channel = await client.channels.fetch(config.channelId);
			if (!channel) return null;

			let thread: ThreadChannel;

			if (channel.type === ChannelType.GuildForum) {
				const forumChannel = channel as ForumChannel;
				const forumThread = await forumChannel.threads.create({
					name: threadName,
					message: firstEmbed
						? { embeds: [firstEmbed] }
						: { content: `🤖 pi session started — ${threadName}` },
				});
				thread = forumThread as ThreadChannel;
			} else if (channel.type === ChannelType.GuildText) {
				const textChannel = channel as TextChannel;
				thread = await textChannel.threads.create({
					name: threadName,
					autoArchiveDuration: 1440,
				});
				if (firstEmbed) {
					await thread.send({ embeds: [firstEmbed] });
				}
			} else {
				return null;
			}

			if (sessionKey) {
				threads[sessionKey] = thread.id;
				watchedThreads.set(thread.id, sessionKey);
				saveThreads(threads);
			}

			return thread;
		} catch (err: any) {
			console.error(`Failed to create Discord thread: ${err?.message}`);
			return null;
		}
	}

	async function notify(
		embed: EmbedBuilder,
		ctx: { cwd: string; sessionManager: { getSessionFile(): string | null } },
	): Promise<boolean> {
		if (!client || !config) return false;

		const sessionKey = getSessionKey(ctx);
		const existingThreadId = sessionKey ? threads[sessionKey] : undefined;

		const thread = await getOrCreateThread(ctx, existingThreadId ? undefined : embed);
		if (!thread) return false;

		if (existingThreadId) {
			try {
				await thread.send({ embeds: [embed] });
			} catch (err: any) {
				console.error(`Failed to send to Discord thread: ${err?.message}`);
				return false;
			}
		}

		return true;
	}

	// ── Events ───────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		currentSessionFile = getSessionKey(ctx);
		lastKnownSessionName = pi.getSessionName() ?? null;
		threadAutoNamed = !!lastKnownSessionName; // if session already has a name, don't auto-name

		if (config?.enabled) {
			ctx.ui.setStatus("discord", "🔔 Discord");
			const result = await startBot();
			if (!result.ok) {
				ctx.ui.notify(`Discord bot failed to connect: ${result.error}`, "warning");
				ctx.ui.setStatus("discord", "⚠️ Discord");
			}
		}
	});

	pi.on("session_switch", async (_event, ctx) => {
		currentSessionFile = getSessionKey(ctx);
		lastKnownSessionName = pi.getSessionName() ?? null;
		threadAutoNamed = !!lastKnownSessionName;
	});

	pi.on("agent_start", async () => {
		agentStartTime = Date.now();
		isAgentBusy = true;
	});

	pi.on("agent_end", async (event, ctx) => {
		isAgentBusy = false;

		// Auto-rename thread when session name changes or generate from context
		if (config?.enabled && client && currentSessionFile && threads[currentSessionFile]) {
			const currentName = pi.getSessionName();
			if (currentName && currentName !== lastKnownSessionName) {
				// Session name changed — use it
				lastKnownSessionName = currentName;
				threadAutoNamed = true;
				const newThreadName = makeThreadName(ctx);
				await renameCurrentThread(newThreadName);
			} else if (!threadAutoNamed && !currentName) {
				// No session name yet — generate one from context
				threadAutoNamed = true;
				const generated = await generateThreadName(ctx);
				if (generated) {
					const project = path.basename(ctx.cwd);
					const fullName = truncateText(`${project} — ${generated}`, 100);
					await renameCurrentThread(fullName);
				}
			}
		}

		if (!config?.enabled || !client) return;

		const duration = Date.now() - agentStartTime;
		const durationSec = Math.round(duration / 1000);
		const durationStr =
			durationSec >= 60 ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s` : `${durationSec}s`;

		// Extract the agent's last message
		let lastMessage: string | null = null;
		if (event.messages) {
			lastMessage = extractLastAssistantText(event.messages as any[]);
		}

		// Always post the response to the Discord thread
		const thread = await getOrCreateThread(ctx);
		if (!thread) return;

		if (lastMessage) {
			// Send as plain text for readability (truncate to Discord's 2000 char limit)
			const content = truncateText(lastMessage, 1900);
			try {
				await thread.send({ content });
			} catch (err: any) {
				console.error(`Discord send failed: ${err?.message}`);
			}
		}

		// For longer tasks, also send an attention-grabbing embed
		if (duration >= config.minDurationMs) {
			const project = path.basename(ctx.cwd);

			const embed = new EmbedBuilder()
				.setTitle("🤖 pi is waiting for your input")
				.setColor(0x7c3aed)
				.addFields(
					{ name: "Project", value: `\`${project}\``, inline: true },
					{ name: "Duration", value: durationStr, inline: true },
				)
				.setFooter({ text: ctx.cwd })
				.setTimestamp();

			try {
				await thread.send({ embeds: [embed] });
			} catch (err: any) {
				console.error(`Discord embed failed: ${err?.message}`);
			}
		}
	});

	// Send images to Discord when pi reads or writes image files
	pi.on("tool_result", async (event, ctx) => {
		if (!config?.enabled || !client) return;

		const toolName = event.toolName;
		const input = event.input as any;

		// Check if this is a read/write/edit of an image file
		let imagePath: string | null = null;
		if ((toolName === "Read" || toolName === "read") && input?.path) {
			imagePath = input.path;
		} else if ((toolName === "Write" || toolName === "write") && input?.path) {
			imagePath = input.path;
		}

		if (!imagePath || !isImagePath(imagePath)) return;

		// Resolve to absolute path
		const absPath = path.isAbsolute(imagePath) ? imagePath : path.resolve(ctx.cwd, imagePath);
		if (!fs.existsSync(absPath)) return;

		try {
			const thread = await getOrCreateThread(ctx);
			if (!thread) return;

			const fileBuffer = fs.readFileSync(absPath);
			const fileName = path.basename(absPath);
			const attachment = new AttachmentBuilder(fileBuffer, { name: fileName });

			const label = toolName.toLowerCase() === "read" ? "📖 Reading" : "✏️ Wrote";
			await thread.send({
				content: `${label} \`${fileName}\``,
				files: [attachment],
			});
		} catch (err: any) {
			console.error(`[discord-notify] Failed to send image to Discord: ${err?.message}`);
		}
	});

	pi.on("session_shutdown", async () => {
		await stopBot();
	});

	// ── Commands ─────────────────────────────────────────────────────

	pi.registerCommand("discord-setup", {
		description: "Configure Discord channel: /discord-setup <channel-id>",
		handler: async (args, ctx) => {
			const channelId = args.trim();

			if (!channelId) {
				ctx.ui.notify(
					[
						"Usage: /discord-setup <channel-id>",
						"",
						"Prerequisites:",
						"  1. Create bot at https://discord.com/developers/applications",
						'  2. Enable "Message Content Intent" in Bot settings',
						"  3. Invite bot to server (Send Messages, Read Messages, Create Public Threads)",
						"  4. Set DISCORD_BOT_TOKEN environment variable with your bot token",
						"  5. Right-click the channel → Copy Channel ID",
						"",
						"Then run: /discord-setup <channel-id>",
					].join("\n"),
					"error",
				);
				return;
			}

			if (!getBotToken()) {
				ctx.ui.notify(
					"DISCORD_BOT_TOKEN environment variable not set.\n" +
					"Set it with: setx DISCORD_BOT_TOKEN <your-bot-token>\n" +
					"Then restart pi.",
					"error",
				);
				return;
			}

			await stopBot();

			config = {
				channelId,
				enabled: true,
				minDurationMs: 15000,
				includePreview: true,
			};
			saveConfig(config);

			const result = await startBot();
			if (!result.ok) {
				ctx.ui.notify(`Failed to connect bot: ${result.error}`, "error");
				return;
			}

			currentSessionFile = getSessionKey(ctx);

			const embed = new EmbedBuilder()
				.setTitle("✅ pi Discord bot connected!")
				.setDescription(
					[
						"Notifications will be sent here when pi needs your input.",
						"",
						isForum
							? "📋 **Forum channel detected** — each session gets its own thread."
							: "💬 **Text channel detected** — each session gets its own thread.",
						"",
						"**Reply in the thread to send messages back to pi!**",
						"🎙️ **Voice messages are supported** — they'll be transcribed locally using Moonshine.",
					].join("\n"),
				)
				.setColor(0x22c55e)
				.setTimestamp();

			const ok = await notify(embed, ctx);
			if (ok) {
				ctx.ui.notify("Discord bot connected! Check your channel.", "info");
				ctx.ui.setStatus("discord", "🔔 Discord");
			} else {
				ctx.ui.notify("Bot connected but failed to send test message. Check channel ID and bot permissions.", "warning");
			}
		},
	});

	pi.registerCommand("discord-test", {
		description: "Send a test Discord notification",
		handler: async (_args, ctx) => {
			if (!config?.channelId || !getBotToken()) {
				ctx.ui.notify("Not configured. Set DISCORD_BOT_TOKEN env var, then run /discord-setup <channel-id>", "error");
				return;
			}

			if (!client) {
				const result = await startBot();
				if (!result.ok) {
					ctx.ui.notify(`Bot not connected: ${result.error}`, "error");
					return;
				}
			}

			currentSessionFile = getSessionKey(ctx);

			const embed = new EmbedBuilder()
				.setTitle("🧪 Test notification from pi")
				.setDescription(
					"If you see this, notifications are working!\n\n" +
					"**Try replying** with text or a 🎙️ voice message — it should appear in pi.",
				)
				.setColor(0x3b82f6)
				.addFields(
					{ name: "Project", value: `\`${path.basename(ctx.cwd)}\``, inline: true },
					{ name: "Status", value: config.enabled ? "✅ Enabled" : "❌ Disabled", inline: true },
				)
				.setTimestamp();

			const ok = await notify(embed, ctx);
			if (ok) {
				ctx.ui.notify("Test notification sent! Check Discord.", "info");
			} else {
				ctx.ui.notify("Failed to send notification.", "error");
			}
		},
	});

	pi.registerCommand("discord-toggle", {
		description: "Enable/disable Discord notifications",
		handler: async (_args, ctx) => {
			if (!config?.channelId || !getBotToken()) {
				ctx.ui.notify("Not configured. Set DISCORD_BOT_TOKEN env var, then run /discord-setup <channel-id>", "error");
				return;
			}

			config.enabled = !config.enabled;
			saveConfig(config);

			if (config.enabled) {
				await startBot();
				ctx.ui.setStatus("discord", "🔔 Discord");
			} else {
				await stopBot();
				ctx.ui.setStatus("discord", undefined);
			}

			ctx.ui.notify(`Discord notifications ${config.enabled ? "enabled ✅" : "disabled ❌"}`, "info");
		},
	});

	pi.registerCommand("discord-config", {
		description: "Show Discord notification configuration",
		handler: async (_args, ctx) => {
			if (!config) {
				ctx.ui.notify("Not configured. Run /discord-setup <token> <channel-id>", "info");
				return;
			}

			const botToken = getBotToken();
			const tokenStatus = botToken ? `✅ Set (${botToken.slice(0, 10)}...${botToken.slice(-4)})` : "❌ Not set";
			const sessionKey = getSessionKey(ctx);
			const threadId = sessionKey ? threads[sessionKey] : undefined;

			const isMuted = threadId ? mutedThreads.has(threadId) : false;

			ctx.ui.notify(
				[
					`Bot token (env): ${tokenStatus}`,
					`Channel: ${config.channelId}`,
					`Channel type: ${isForum ? "forum" : "text"}`,
					`Status: ${config.enabled ? "✅ Enabled" : "❌ Disabled"}`,
					`Connected: ${client ? "✅" : "❌"}`,
					`Min duration: ${config.minDurationMs / 1000}s`,
					`Include preview: ${config.includePreview ? "yes" : "no"}`,
					`Voice transcription: Whisper base (local)`,
					`Current session thread: ${threadId ?? "none yet"}${isMuted ? " (🔇 muted)" : ""}`,
					`Tracked threads: ${Object.keys(threads).length}`,
					`Muted threads: ${mutedThreads.size}`,
				].join("\n"),
				"info",
			);
		},
	});

	pi.registerCommand("discord-rename", {
		description: "Rename the current Discord thread: /discord-rename [name] (empty = auto-generate from context)",
		handler: async (args, ctx) => {
			if (!client) {
				ctx.ui.notify("Discord bot not connected.", "error");
				return;
			}

			if (!currentSessionFile || !threads[currentSessionFile]) {
				ctx.ui.notify("No Discord thread for this session yet.", "error");
				return;
			}

			const name = args.trim();
			const project = path.basename(ctx.cwd);

			if (name) {
				// Manual rename
				const fullName = truncateText(`${project} — ${name}`, 100);
				const ok = await renameCurrentThread(fullName);
				if (ok) {
					threadAutoNamed = true;
					ctx.ui.notify(`Thread renamed to: ${fullName}`, "info");
				} else {
					ctx.ui.notify("Failed to rename thread.", "error");
				}
			} else {
				// Auto-generate from context
				ctx.ui.notify("Generating thread name from context...", "info");
				const generated = await generateThreadName(ctx);
				if (generated) {
					const fullName = truncateText(`${project} — ${generated}`, 100);
					const ok = await renameCurrentThread(fullName);
					if (ok) {
						threadAutoNamed = true;
						ctx.ui.notify(`Thread renamed to: ${fullName}`, "info");
					} else {
						ctx.ui.notify("Failed to rename thread.", "error");
					}
				} else {
					ctx.ui.notify("Couldn't generate a name — not enough context or no model available.", "error");
				}
			}
		},
	});

	pi.registerCommand("discord-unmute", {
		description: "Unmute the current session's Discord thread",
		handler: async (_args, ctx) => {
			if (!currentSessionFile || !threads[currentSessionFile]) {
				ctx.ui.notify("No Discord thread for this session.", "error");
				return;
			}

			const threadId = threads[currentSessionFile];
			if (!mutedThreads.has(threadId)) {
				ctx.ui.notify("This thread is not muted.", "info");
				return;
			}

			mutedThreads.delete(threadId);
			saveMuted(mutedThreads);

			// Send confirmation to the thread
			if (client) {
				try {
					const thread = await client.channels.fetch(threadId);
					if (thread?.isThread()) {
						await (thread as ThreadChannel).send({ content: "🔊 Thread unmuted — notifications resumed." });
					}
				} catch {}
			}

			ctx.ui.notify("Thread unmuted — notifications resumed.", "info");
		},
	});
}
