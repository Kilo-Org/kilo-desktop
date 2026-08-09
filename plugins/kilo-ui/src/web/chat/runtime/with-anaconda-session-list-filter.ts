import type { KiloClient } from "@kilocode/sdk/v2/client";

import { hasAnacondaSessionMetadata } from "../session-activity/session-activity-logic.js";

/**
 * Filters `experimental.session.list` to sessions stamped with Anaconda metadata
 * so the thread-list adapter (and activity hydration) ignore Kilo CLI sessions.
 */
export function withAnacondaSessionListFilter(client: KiloClient): KiloClient {
	const session = client.experimental?.session;
	if (!session || typeof session.list !== "function") {
		return client;
	}

	const list = session.list.bind(session);
	session.list = (async (...args: Parameters<typeof list>) => {
		const response = await list(...args);
		const data = response.data ?? [];
		return {
			...response,
			data: data.filter((row) => hasAnacondaSessionMetadata(row.metadata)),
		};
	}) as typeof session.list;
	return client;
}
