import type { KiloClient } from "@kilocode/sdk/v2/client";

import { hasKiloDesktopSessionMetadata } from "../../session/activity/session-activity-logic.js";

/**
 * Filters `experimental.session.list` to sessions stamped with Kilo Desktop
 * current or pre-rename Desktop metadata so the thread-list adapter and activity
 * hydration ignore Kilo CLI sessions.
 */
export function withKiloDesktopSessionListFilter(client: KiloClient): KiloClient {
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
			data: data.filter((row) => hasKiloDesktopSessionMetadata(row.metadata)),
		};
	}) as typeof session.list;
	return client;
}
