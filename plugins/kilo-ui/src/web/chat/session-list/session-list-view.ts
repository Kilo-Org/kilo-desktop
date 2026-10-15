import {
	needsAttention,
	resolveSessionLocationLabel,
	type SessionActivity,
} from "../session-activity/session-activity-logic.js";

/** Versioned key — bump the suffix if the stored shape changes. */
export const SESSION_LIST_VIEW_STORAGE_KEY = "kilo-ui.session-list-view:v1";

export const SESSION_LIST_GROUPINGS = ["lifecycle", "workspace", "updated"] as const;
export const SESSION_LIST_ORDERINGS = ["recency", "title"] as const;
export const SESSION_LIST_SHOW_FIELDS = ["workspace", "updated", "pr"] as const;
export const SESSION_LIST_STATUS_FILTERS = [
	"all",
	"attention",
	"working",
	"idle",
	"archived",
] as const;

export type SessionListGrouping = (typeof SESSION_LIST_GROUPINGS)[number];
export type SessionListOrdering = (typeof SESSION_LIST_ORDERINGS)[number];
export type SessionListShowField = (typeof SESSION_LIST_SHOW_FIELDS)[number];
export type SessionListStatusFilter = (typeof SESSION_LIST_STATUS_FILTERS)[number];

export type SessionListView = {
	grouping: SessionListGrouping;
	ordering: SessionListOrdering;
	show: readonly SessionListShowField[];
	status: SessionListStatusFilter;
	/** Workspace id to focus, or `null` for all workspaces. */
	focus: string | null;
};

export const DEFAULT_SESSION_LIST_VIEW: SessionListView = {
	grouping: "lifecycle",
	ordering: "recency",
	show: ["pr"],
	status: "all",
	focus: null,
};

export const SESSION_LIST_GROUPING_LABELS: Record<SessionListGrouping, string> = {
	lifecycle: "Status",
	workspace: "Workspace",
	updated: "Updated",
};

export const SESSION_LIST_ORDERING_LABELS: Record<SessionListOrdering, string> = {
	recency: "Updated",
	title: "Title",
};

export const SESSION_LIST_SHOW_LABELS: Record<SessionListShowField, string> = {
	workspace: "Workspace",
	updated: "Updated",
	pr: "PR",
};

export const SESSION_LIST_STATUS_LABELS: Record<SessionListStatusFilter, string> = {
	all: "All",
	attention: "Needs attention",
	working: "Working",
	idle: "Idle",
	archived: "Archived",
};

export type SessionListViewEntry = {
	id: string;
	remoteId?: string | undefined;
	title?: string | undefined;
	sourceIndex: number;
	archived: boolean;
};

export type SessionListSectionTone =
	| "attention"
	| "pinned"
	| "active"
	| "archived"
	| "workspace"
	| "updated";

export type SessionListSectionRow = {
	id: string;
	archived: boolean;
};

export type SessionListSection = {
	key: string;
	label: string | null;
	tone: SessionListSectionTone;
	rows: SessionListSectionRow[];
	workspaceId?: string | undefined;
};

type Lifecycle = Exclude<SessionListStatusFilter, "all">;

type Enriched = SessionListViewEntry & {
	activity: SessionActivity | undefined;
	lifecycle: Lifecycle;
	location: string | null;
	title: string;
};

function isMember<T extends string>(value: unknown, allowed: readonly T[]): value is T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function normalizeShow(value: unknown): SessionListShowField[] {
	if (!Array.isArray(value)) return [];
	return SESSION_LIST_SHOW_FIELDS.filter((field) => value.includes(field));
}

export function parseSessionListView(value: unknown): SessionListView {
	if (!value || typeof value !== "object") return DEFAULT_SESSION_LIST_VIEW;
	const record = value as Record<string, unknown>;
	return {
		grouping: isMember(record.grouping, SESSION_LIST_GROUPINGS)
			? record.grouping
			: DEFAULT_SESSION_LIST_VIEW.grouping,
		ordering: isMember(record.ordering, SESSION_LIST_ORDERINGS)
			? record.ordering
			: DEFAULT_SESSION_LIST_VIEW.ordering,
		show: normalizeShow(record.show),
		status: isMember(record.status, SESSION_LIST_STATUS_FILTERS)
			? record.status
			: DEFAULT_SESSION_LIST_VIEW.status,
		focus: typeof record.focus === "string" && record.focus.length > 0 ? record.focus : null,
	};
}

export function isDefaultSessionListView(view: SessionListView): boolean {
	return (
		view.grouping === DEFAULT_SESSION_LIST_VIEW.grouping &&
		view.ordering === DEFAULT_SESSION_LIST_VIEW.ordering &&
		view.status === DEFAULT_SESSION_LIST_VIEW.status &&
		view.show.length === DEFAULT_SESSION_LIST_VIEW.show.length &&
		DEFAULT_SESSION_LIST_VIEW.show.every((field) => view.show.includes(field)) &&
		view.focus === DEFAULT_SESSION_LIST_VIEW.focus
	);
}

/** Workspace grouping is only meaningful across all workspaces. */
export function resolveSessionListGrouping(view: SessionListView): SessionListGrouping {
	if (view.grouping === "workspace" && view.focus) return "lifecycle";
	return view.grouping;
}

function getLocalStorage(): Storage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

export function readSessionListView(
	storage: Pick<Storage, "getItem"> | null = getLocalStorage(),
): SessionListView {
	if (!storage) return DEFAULT_SESSION_LIST_VIEW;
	try {
		const raw = storage.getItem(SESSION_LIST_VIEW_STORAGE_KEY);
		if (!raw) return DEFAULT_SESSION_LIST_VIEW;
		return parseSessionListView(JSON.parse(raw));
	} catch {
		return DEFAULT_SESSION_LIST_VIEW;
	}
}

export function writeSessionListView(
	view: SessionListView,
	storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
): void {
	if (!storage) return;
	try {
		storage.setItem(SESSION_LIST_VIEW_STORAGE_KEY, JSON.stringify(parseSessionListView(view)));
	} catch {
		// Keep the in-memory view usable when persistence is unavailable.
	}
}

/** Versioned key — bump the suffix if the stored shape changes. */
export const SESSION_LIST_ARCHIVED_EXPANDED_STORAGE_KEY =
	"kilo-ui.session-list-archived-expanded:v1";

export function readSessionListArchivedExpanded(
	storage: Pick<Storage, "getItem"> | null = getLocalStorage(),
): boolean {
	if (!storage) return false;
	try {
		return storage.getItem(SESSION_LIST_ARCHIVED_EXPANDED_STORAGE_KEY) === "true";
	} catch {
		return false;
	}
}

export function writeSessionListArchivedExpanded(
	expanded: boolean,
	storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
): void {
	if (!storage) return;
	try {
		storage.setItem(SESSION_LIST_ARCHIVED_EXPANDED_STORAGE_KEY, String(expanded));
	} catch {
		// Keep the in-memory shelf state usable when persistence is unavailable.
	}
}

/** Versioned key — bump the suffix if the stored shape changes. */
export const SESSION_LIST_PINS_STORAGE_KEY = "kilo-ui.session-list-pins:v1";

export function parseSessionListPins(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const ids: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string" || entry.length === 0 || ids.includes(entry)) continue;
		ids.push(entry);
	}
	return ids;
}

export function readSessionListPins(
	storage: Pick<Storage, "getItem"> | null = getLocalStorage(),
): string[] {
	if (!storage) return [];
	try {
		const raw = storage.getItem(SESSION_LIST_PINS_STORAGE_KEY);
		if (!raw) return [];
		return parseSessionListPins(JSON.parse(raw));
	} catch {
		return [];
	}
}

export function writeSessionListPins(
	ids: readonly string[],
	storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
): void {
	if (!storage) return;
	try {
		storage.setItem(SESSION_LIST_PINS_STORAGE_KEY, JSON.stringify(parseSessionListPins(ids)));
	} catch {
		// Keep the in-memory pins usable when persistence is unavailable.
	}
}

export function toggleSessionListPin(ids: readonly string[], id: string): string[] {
	return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
}

function isWorking(activity: SessionActivity | undefined): boolean {
	return activity?.status === "busy" || activity?.status === "retry";
}

function lifecycleOf(activity: SessionActivity | undefined, archived: boolean): Lifecycle {
	if (archived) return "archived";
	if (needsAttention(activity)) return "attention";
	if (isWorking(activity)) return "working";
	return "idle";
}

function enrich(
	entries: readonly SessionListViewEntry[],
	activityBySessionId: Readonly<Record<string, SessionActivity>>,
	workspaces: readonly { id: string; name: string }[],
): Enriched[] {
	return entries.map((entry) => {
		const activity = entry.remoteId ? activityBySessionId[entry.remoteId] : undefined;
		return {
			...entry,
			activity,
			lifecycle: lifecycleOf(activity, entry.archived),
			location: resolveSessionLocationLabel(activity, workspaces),
			title: entry.title || "New Chat",
		};
	});
}

/**
 * Kilo bumps `updatedAt` after every agent step, so ranking a working session
 * by it makes concurrent runs leapfrog. `workingSince` (the turn start, i.e.
 * the user's last message) holds it still until the turn finishes.
 */
function recencyTime(activity: SessionActivity | undefined): number {
	if (isWorking(activity) && activity?.workingSince !== undefined) return activity.workingSince;
	return activity?.updatedAt ?? activity?.createdAt ?? 0;
}

function sortRows(rows: Enriched[], ordering: SessionListOrdering) {
	return rows.toSorted((left, right) => {
		if (ordering === "title") {
			return left.title.localeCompare(right.title) || left.sourceIndex - right.sourceIndex;
		}
		return (
			recencyTime(right.activity) - recencyTime(left.activity) ||
			left.sourceIndex - right.sourceIndex
		);
	});
}

function toRows(rows: Enriched[]): SessionListSectionRow[] {
	return rows.map(({ id, archived }) => ({ id, archived }));
}

function workspaceKey(row: Enriched): string {
	return row.activity?.workspaceId ?? "unknown";
}

function pinKey(row: SessionListViewEntry): string {
	return row.remoteId ?? row.id;
}

function sortAttentionFirst(rows: Enriched[], ordering: SessionListOrdering): Enriched[] {
	const attention = sortRows(
		rows.filter((row) => row.lifecycle === "attention"),
		ordering,
	);
	const rest = sortRows(
		rows.filter((row) => row.lifecycle !== "attention"),
		ordering,
	);
	return [...attention, ...rest];
}

function startOfLocalDay(ms: number): number {
	const date = new Date(ms);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
}

function recencyBucket(
	stamp: number | undefined,
	now: number,
): { key: string; label: string; order: number } {
	if (stamp === undefined) return { key: "older", label: "Older", order: 4 };
	const days = Math.round((startOfLocalDay(now) - startOfLocalDay(stamp)) / 86_400_000);
	if (days <= 0) return { key: "today", label: "Today", order: 0 };
	if (days === 1) return { key: "yesterday", label: "Yesterday", order: 1 };
	if (days < 7) return { key: "week", label: "Last 7 Days", order: 2 };
	if (days < 30) return { key: "month", label: "Last 30 Days", order: 3 };
	return { key: "older", label: "Older", order: 4 };
}

/**
 * Every known workspace gets a group, even with no chats, so a new workspace
 * is visible before its first chat and stays visible after its last one is
 * archived or deleted. Chats from deleted or no workspace still add groups;
 * the "No workspace" group always comes last.
 */
function workspaceSections(
	rows: Enriched[],
	workspaces: readonly { id: string; name: string }[],
	ordering: SessionListOrdering,
): SessionListSection[] {
	const groups = new Map<string, { label: string; rows: Enriched[] }>(
		workspaces.map((workspace) => [workspace.id, { label: workspace.name, rows: [] }]),
	);
	for (const row of rows) {
		const key = workspaceKey(row);
		const group = groups.get(key);
		if (group) {
			group.rows.push(row);
			continue;
		}
		groups.set(key, { label: row.location ?? "No workspace", rows: [row] });
	}

	return [...groups.entries()]
		.toSorted(
			(left, right) =>
				Number(left[0] === "unknown") - Number(right[0] === "unknown") ||
				left[1].label.localeCompare(right[1].label) ||
				left[0].localeCompare(right[0]),
		)
		.map(([key, group]) => ({
			key: `workspace:${key}`,
			label: group.label,
			tone: "workspace" as const,
			rows: toRows(sortAttentionFirst(group.rows, ordering)),
			...(key === "unknown" ? {} : { workspaceId: key }),
		}));
}

function updatedSections(
	rows: Enriched[],
	ordering: SessionListOrdering,
	now: number,
): SessionListSection[] {
	const groups = new Map<string, { label: string; order: number; rows: Enriched[] }>();
	for (const row of rows) {
		const bucket = recencyBucket(row.activity?.updatedAt ?? row.activity?.createdAt, now);
		const group = groups.get(bucket.key);
		if (group) {
			group.rows.push(row);
			continue;
		}
		groups.set(bucket.key, { label: bucket.label, order: bucket.order, rows: [row] });
	}

	return [...groups.entries()]
		.toSorted((left, right) => left[1].order - right[1].order)
		.map(([key, group]) => ({
			key: `updated:${key}`,
			label: group.label,
			tone: "updated" as const,
			rows: toRows(sortAttentionFirst(group.rows, ordering)),
		}));
}

/**
 * Groups filtered session-list entries for the sidebar. Status grouping
 * partitions attention into its own first section. Workspace and updated
 * grouping keep those sessions in their folder/day, sorted to the top.
 * Pinned active sessions are a separate first section in every mode, while
 * archived sessions always occupy the final shelf.
 */
export function buildSessionListSections(args: {
	entries: readonly SessionListViewEntry[];
	activityBySessionId: Readonly<Record<string, SessionActivity>>;
	workspaces: readonly { id: string; name: string }[];
	view: SessionListView;
	pinnedIds?: ReadonlySet<string>;
	now?: number;
}): SessionListSection[] {
	const pinnedIds = args.pinnedIds ?? new Set<string>();
	const grouping = resolveSessionListGrouping(args.view);
	const rows = enrich(args.entries, args.activityBySessionId, args.workspaces).filter((row) => {
		if (args.view.status !== "all" && row.lifecycle !== args.view.status) return false;
		if (args.view.focus && row.activity?.workspaceId !== args.view.focus) return false;
		return true;
	});

	const pullAttention = grouping === "lifecycle";
	const attention = pullAttention
		? sortRows(
				rows.filter((row) => row.lifecycle === "attention"),
				args.view.ordering,
			)
		: [];
	const rest = pullAttention ? rows.filter((row) => row.lifecycle !== "attention") : rows;
	const archived = sortRows(
		rest.filter((row) => row.lifecycle === "archived"),
		args.view.ordering,
	);
	const activeRows = rest.filter((row) => row.lifecycle !== "archived");
	const pinned = sortRows(
		activeRows.filter((row) => pinnedIds.has(pinKey(row))),
		args.view.ordering,
	);
	const unpinned = activeRows.filter((row) => !pinnedIds.has(pinKey(row)));

	const sections: SessionListSection[] = [];
	if (attention.length > 0) {
		sections.push({
			key: "attention",
			label: "Needs attention",
			tone: "attention",
			rows: toRows(attention),
		});
	}
	if (pinned.length > 0) {
		sections.push({
			key: "pinned",
			label: "Pinned",
			tone: "pinned",
			rows: toRows(pinned),
		});
	}

	switch (grouping) {
		case "lifecycle": {
			const active = sortRows(unpinned, args.view.ordering);
			if (active.length > 0) {
				sections.push({ key: "active", label: "Active", tone: "active", rows: toRows(active) });
			}
			break;
		}
		case "workspace": {
			// Archived chats only ever land in the Archived shelf, so under that
			// filter every workspace group would be empty.
			const workspaces = args.view.status === "archived" ? [] : args.workspaces;
			sections.push(...workspaceSections(unpinned, workspaces, args.view.ordering));
			break;
		}
		case "updated": {
			sections.push(...updatedSections(unpinned, args.view.ordering, args.now ?? Date.now()));
			break;
		}
		default: {
			const _exhaustive: never = grouping;
			return _exhaustive;
		}
	}
	if (archived.length > 0) {
		sections.push({ key: "archived", label: "Archived", tone: "archived", rows: toRows(archived) });
	}
	return sections;
}

export function visibleShowFields(view: SessionListView): SessionListShowField[] {
	const workspaceStated = view.focus !== null || view.grouping === "workspace";
	return view.show.filter((field) => !(field === "workspace" && workspaceStated));
}

/** The focused workspace, or null when there is none or it no longer exists. */
export function resolveWorkspaceFocus(
	focus: string | null,
	workspaces: readonly { id: string }[],
): string | null {
	return focus && workspaces.some((workspace) => workspace.id === focus) ? focus : null;
}
