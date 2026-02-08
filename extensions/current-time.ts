/**
 * Current Time Tool - Returns the current date and time
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "current_time",
		label: "Current Time",
		description: "Returns the current date and time. Use this when the user asks for the current time or date.",
		parameters: Type.Object({
			timezone: Type.Optional(
				Type.String({
					description:
						'IANA timezone identifier (e.g., "America/New_York", "Europe/London", "Asia/Tokyo"). If not provided, uses the system local time.',
				})
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { timezone } = params as { timezone?: string };

			try {
				const now = new Date();
				const options: Intl.DateTimeFormatOptions = {
					weekday: "long",
					year: "numeric",
					month: "long",
					day: "numeric",
					hour: "2-digit",
					minute: "2-digit",
					second: "2-digit",
					hour12: false,
					timeZoneName: "long",
				};

				if (timezone) {
					options.timeZone = timezone;
				}

				const formatted = new Intl.DateTimeFormat("en-US", options).format(now);
				const iso = now.toISOString();

				return {
					content: [
						{
							type: "text",
							text: `Current time: ${formatted}\nISO 8601: ${iso}`,
						},
					],
					details: { formatted, iso, timezone: timezone ?? "local" },
				};
			} catch (e: any) {
				return {
					content: [
						{
							type: "text",
							text: `Error: ${e.message}. Please use a valid IANA timezone identifier (e.g., "America/New_York", "Europe/London").`,
						},
					],
					details: { error: e.message },
					isError: true,
				};
			}
		},
	});
}
