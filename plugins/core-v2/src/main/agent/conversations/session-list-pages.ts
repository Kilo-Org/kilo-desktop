/**
 * Cursor paging over Kilo's `experimental.session.list`, which orders rows by
 * `time.updated` descending, caps them at `limit` (server default 100), and
 * keeps rows with `time_updated < cursor`.
 *
 * The server's `x-next-cursor` header is not CORS-exposed to the renderer, so a
 * full page (rows === limit) is the "maybe more" signal; an exact multiple of the
 * page size costs one extra empty request.
 *
 * Cursors include the boundary millisecond so sessions sharing it are never
 * skipped; callers dedupe the repeated rows by id. When a whole page shares the
 * boundary (no progress), the next cursor turns exclusive so paging always
 * terminates.
 */
export const SESSION_LIST_PAGE_SIZE = 100;

type SessionListCursor = { updatedAt: number; inclusive: boolean };

type PagedSessionRow = { time: { updated: number } };

export type SessionListPageQuery = {
	roots: true;
	archived: true;
	limit: number;
	cursor?: number;
};

const CURSOR_PATTERN = /^(<=?)(\d+)$/;

function encodeCursor({ updatedAt, inclusive }: SessionListCursor): string {
	return `${inclusive ? "<=" : "<"}${updatedAt}`;
}

function decodeCursor(after: string | undefined): SessionListCursor | undefined {
	const match = after ? CURSOR_PATTERN.exec(after) : null;
	if (!match) return undefined;
	return { updatedAt: Number(match[2]), inclusive: match[1] === "<=" };
}

export function sessionListPageQuery(
	after: string | undefined,
	limit = SESSION_LIST_PAGE_SIZE,
): SessionListPageQuery {
	const cursor = decodeCursor(after);
	return {
		roots: true,
		archived: true,
		limit,
		...(cursor ? { cursor: cursor.inclusive ? cursor.updatedAt + 1 : cursor.updatedAt } : {}),
	};
}

/** Cursor for the page after `rows` (the unfiltered server page), or undefined when exhausted. */
export function nextSessionListCursor(
	after: string | undefined,
	rows: readonly PagedSessionRow[],
	limit = SESSION_LIST_PAGE_SIZE,
): string | undefined {
	const last = rows.at(-1);
	if (!last || rows.length < limit) return undefined;
	const previous = decodeCursor(after);
	const stalled = previous?.inclusive === true && previous.updatedAt === last.time.updated;
	return encodeCursor({ updatedAt: last.time.updated, inclusive: !stalled });
}

/** Walks every page, deduping the boundary rows that inclusive cursors repeat. */
export async function listAllSessionPages<Row extends PagedSessionRow & { id: string }>(
	fetchPage: (query: SessionListPageQuery) => Promise<readonly Row[]>,
	limit = SESSION_LIST_PAGE_SIZE,
): Promise<Row[]> {
	const rowsById = new Map<string, Row>();
	let after: string | undefined;
	do {
		const rows = await fetchPage(sessionListPageQuery(after, limit));
		for (const row of rows) {
			if (!rowsById.has(row.id)) rowsById.set(row.id, row);
		}
		after = nextSessionListCursor(after, rows, limit);
	} while (after);
	return [...rowsById.values()];
}
