import type { OpenCodeClient } from "@kilocode/client";

const WAIT_MS = 30_000;
const POLL_MS = 100;

/**
 * Waits until a Kilo location lists its plugins, or the wait runs out. While a
 * location starts, kilo2 answers its lists with only its core entries (the
 * Code agent, no commands) because the plugins that add the rest (Kilo's own
 * Plan, Ask and Debug agents, plugin commands) haven't registered yet; read
 * then, a catalog cached for the session would stay short. A server without
 * the plugin inventory ends the wait at once.
 */
export async function locationReady(
	client: Pick<OpenCodeClient, "plugin">,
	directory: string,
	options: { readonly waitMs?: number; readonly pollMs?: number } = {},
): Promise<void> {
	const deadline = Date.now() + (options.waitMs ?? WAIT_MS);
	const pollMs = options.pollMs ?? POLL_MS;
	while (Date.now() < deadline) {
		// Each poll decides whether another is needed.
		// react-doctor-disable-next-line react-doctor/async-await-in-loop
		const listed = await client.plugin.list({ location: { directory } }).then(
			(result) => result.data.length > 0,
			() => true,
		);
		if (listed) return;
		// react-doctor-disable-next-line react-doctor/async-await-in-loop
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
}
