import { randomUUID } from "node:crypto";

import { KernelError, mainHost, type DomainProvider, type PluginSdk } from "@kilo-desktop/kernel";

import {
	EMPTY_SESSION_PANES,
	PaneKind,
	PaneOpener,
	Panes,
	SESSIONS_PLUGIN_ID,
	Sessions,
	type OpenPaneInput,
	type Pane,
	type SessionPanes,
} from "../contracts";
import { readLegacyPanes } from "./legacy-panes";

interface PersistedPanes extends Record<string, unknown> {
	bySession: Record<string, SessionPanes>;
	legacyImported: boolean;
}

/** `*` matches within a path segment, `**` across segments, `?` one character. */
export function globToRegExp(glob: string): RegExp {
	let source = "";
	for (let index = 0; index < glob.length; index++) {
		const char = glob[index]!;
		if (char === "*" && glob[index + 1] === "*") {
			source += ".*";
			index++;
		} else if (char === "*") source += "[^/]*";
		else if (char === "?") source += "[^/]";
		else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`(^|/)${source}$`, "i");
}

/**
 * kilo.sessions' panes in main: every session's open panes, active pane,
 * serialized layout and arrangement, kept in kv and shared by every window.
 * Opening applies the pane kind's manifest rules (singleton) without its
 * plugin's code; the canvas owns the layout's shape and only saves it here.
 * A deleted session's panes go with it; origin's per-window state is handed
 * over once by the main window.
 */
export function providePanes(
	sdk: PluginSdk,
	options: {
		readonly createId?: () => string;
		/**
		 * Settles once origin's sessions are imported, so their panes find them:
		 * true when they were (or there were none), false when the import will
		 * be retried next launch, and origin's panes with it.
		 */
		readonly originSessionsImported?: () => Promise<boolean>;
	} = {},
): DomainProvider<typeof Panes> {
	const createId = options.createId ?? (() => `pane_${randomUUID()}`);
	const store = mainHost(sdk).storage.kv<PersistedPanes>({
		namespace: "panes",
		defaults: { bySession: {}, legacyImported: false },
	});

	const panes: DomainProvider<typeof Panes> = sdk.domains.provide(Panes, {
		initialState: { bySession: store.snapshot().bySession },
		methods: {
			open: (input) => openPane(input),
			openObject: ({ sessionId, ref }) => {
				const opener = sdk.extensions
					.list(PaneOpener)
					.find(
						({ metadata }) =>
							metadata.match.type === ref.type &&
							(!metadata.match.pattern || globToRegExp(metadata.match.pattern).test(ref.id)),
					);
				if (!opener) return null;
				const current = of(sessionId);
				const already = current.panes.find(
					(pane) =>
						pane.kind === opener.metadata.pane &&
						pane.metadata.objectType === ref.type &&
						pane.metadata.objectId === ref.id,
				);
				return openPane({
					sessionId,
					kind: opener.metadata.pane,
					...(already ? { paneId: already.id } : {}),
					metadata: { ...already?.metadata, objectType: ref.type, objectId: ref.id },
				});
			},
			activate: ({ sessionId, paneId }) => {
				const current = of(sessionId);
				requirePane(current, paneId);
				write(sessionId, { ...current, activePaneId: paneId });
			},
			update: ({ sessionId, paneId, ...patch }) => {
				const current = of(sessionId);
				const updated = merge(requirePane(current, paneId), patch);
				write(sessionId, {
					...current,
					panes: current.panes.map((pane) => (pane.id === paneId ? updated : pane)),
				});
				return updated;
			},
			close: ({ sessionId, paneId }) => {
				const current = of(sessionId);
				const index = current.panes.findIndex((pane) => pane.id === paneId);
				if (index === -1) return { closed: false };
				const pane = current.panes[index]!;
				const rest = current.panes.filter((candidate) => candidate.id !== paneId);
				const activePaneId =
					current.activePaneId === paneId
						? (rest[Math.min(index, rest.length - 1)]?.id ?? null)
						: current.activePaneId;
				write(sessionId, { ...current, panes: rest, activePaneId });
				panes.emit("closed", { sessionId, pane });
				return { closed: true };
			},
			setLayout: ({ sessionId, layout, activePaneId }) => {
				const current = of(sessionId);
				write(sessionId, {
					...current,
					layout,
					...(activePaneId !== undefined &&
					(activePaneId === null || current.panes.some((pane) => pane.id === activePaneId))
						? { activePaneId }
						: {}),
				});
			},
			setArrangement: ({ sessionId, arrangement }) => {
				write(sessionId, { ...of(sessionId), arrangement });
			},
			importLegacy: async ({ state }, caller) => {
				if (caller.pluginId !== SESSIONS_PLUGIN_ID) {
					throw new KernelError("PERMISSION_DENIED", "Only kilo.sessions hands over its panes.");
				}
				if (!((await options.originSessionsImported?.()) ?? true)) return;
				if (store.snapshot().legacyImported) return;
				const imported = readLegacyPanes(state, knownSessionTitles());
				const bySession = { ...imported, ...store.snapshot().bySession };
				store.set({ bySession, legacyImported: true });
				panes.setState({ bySession });
			},
		},
	});

	function openPane(input: OpenPaneInput): Pane {
		const current = of(input.sessionId);
		const existing = input.paneId
			? current.panes.find((pane) => pane.id === input.paneId)
			: singletonPane(current, input.kind);
		if (existing && existing.kind !== input.kind) {
			throw new KernelError("VALIDATION", "That pane belongs to another kind of pane.");
		}
		const activate = input.activate ?? true;
		if (existing) {
			const updated = merge(existing, input);
			write(input.sessionId, {
				...current,
				panes: current.panes.map((pane) => (pane.id === existing.id ? updated : pane)),
				activePaneId: activate ? updated.id : current.activePaneId,
			});
			return updated;
		}
		const ordinal =
			Math.max(0, ...current.panes.filter((p) => p.kind === input.kind).map((p) => p.ordinal)) + 1;
		const pane: Pane = {
			id: input.paneId ?? createId(),
			kind: input.kind,
			title: input.title?.trim() || kindTitle(input.kind, ordinal),
			...(input.iconKey ? { iconKey: input.iconKey } : {}),
			metadata: input.metadata ?? {},
			ordinal,
		};
		write(input.sessionId, {
			...current,
			panes: [...current.panes, pane],
			activePaneId: activate || current.activePaneId === null ? pane.id : current.activePaneId,
		});
		panes.emit("opened", { sessionId: input.sessionId, pane });
		return pane;
	}

	function of(sessionId: string): SessionPanes {
		return store.snapshot().bySession[sessionId] ?? EMPTY_SESSION_PANES;
	}
	function write(sessionId: string, next: SessionPanes | null): void {
		const bySession = { ...store.snapshot().bySession };
		if (next) bySession[sessionId] = next;
		else delete bySession[sessionId];
		store.set({ bySession });
		panes.setState({ bySession });
	}
	function requirePane(current: SessionPanes, paneId: string): Pane {
		const pane = current.panes.find((candidate) => candidate.id === paneId);
		if (!pane) throw new KernelError("NOT_FOUND", "Pane not found.");
		return pane;
	}
	function merge(
		pane: Pane,
		patch: {
			title?: string | undefined;
			iconKey?: string | undefined;
			metadata?: Record<string, string> | undefined;
		},
	): Pane {
		return {
			...pane,
			...(patch.title?.trim() ? { title: patch.title.trim() } : {}),
			...(patch.iconKey ? { iconKey: patch.iconKey } : {}),
			...(patch.metadata ? { metadata: patch.metadata } : {}),
		};
	}
	function kindMetadata(kind: string) {
		return sdk.extensions.list(PaneKind).find((contribution) => contribution.key === kind)
			?.metadata;
	}
	function singletonPane(current: SessionPanes, kind: string): Pane | undefined {
		if (!kindMetadata(kind)?.singleton) return undefined;
		return current.panes.find((pane) => pane.kind === kind);
	}
	function kindTitle(kind: string, ordinal: number): string {
		const title = kindMetadata(kind)?.title ?? "Pane";
		return ordinal > 1 ? `${title} ${ordinal}` : title;
	}
	function knownSessionTitles(): Map<string, string> {
		const sessions = sdk.domains.get(Sessions)?.getState().sessions ?? [];
		return new Map(sessions.map((session) => [session.id, session.title]));
	}

	const stop = sdk.domains.get(Sessions)?.on("deleted", ({ session }) => {
		if (store.snapshot().bySession[session.id]) write(session.id, null);
	});
	sdk.onDispose(() => stop?.());
	return panes;
}
