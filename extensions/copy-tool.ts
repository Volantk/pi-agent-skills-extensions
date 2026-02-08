/**
 * Copy Tool — Copy files or directories from source to destination.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { cp, stat } from "node:fs/promises";
import { resolve } from "node:path";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "copy",
		label: "Copy",
		description:
			"Copy a file or directory from source to destination. Copies recursively for directories. Creates destination parent directories if needed.",
		parameters: Type.Object({
			source: Type.String({ description: "Source file or directory path (absolute or relative to cwd)" }),
			destination: Type.String({ description: "Destination path (absolute or relative to cwd)" }),
			overwrite: Type.Optional(
				Type.Boolean({
					description: "Whether to overwrite existing files at the destination (default: false)",
				})
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { source, destination, overwrite } = params as {
				source: string;
				destination: string;
				overwrite?: boolean;
			};

			const srcPath = resolve(ctx.cwd, source);
			const dstPath = resolve(ctx.cwd, destination);

			try {
				// Check source exists
				const srcStat = await stat(srcPath);
				const isDir = srcStat.isDirectory();

				// Copy
				await cp(srcPath, dstPath, {
					recursive: true,
					force: overwrite ?? false,
					errorOnExist: !(overwrite ?? false),
				});

				const type = isDir ? "directory" : "file";
				return {
					content: [
						{
							type: "text",
							text: `Copied ${type}: ${srcPath} → ${dstPath}`,
						},
					],
					details: { source: srcPath, destination: dstPath, type, overwrite: overwrite ?? false },
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Copy failed: ${err.message}` }],
					details: { error: err.message, source: srcPath, destination: dstPath },
					isError: true,
				};
			}
		},
	});
}
