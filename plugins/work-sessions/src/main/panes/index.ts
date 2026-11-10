import { randomUUID } from "node:crypto";

import {
	KernelError,
	type DomainObjectProvider,
	type ObjectRef,
	type PluginSdk,
} from "@kilo-desktop/kernel";

import {
	EMPTY_WORK_SESSION_PANES,
	Panes,
	WorkSessions,
	type OpenPaneInput,
	type Pane,
	type PaneStatus,
	type WorkSessionPanes,
} from "../../contracts/model";
// The point's manifest metadata is model data; only its renderer implementation is UI (a type).
import { PaneKind } from "../../contracts/ui/pane-kind";
import { panesStore } from "../storage/stores";
import { track } from "../telemetry";
import { openerFor } from "./openers";

export interface PanesOptions {
	readonly createId?: () => string;
}

interface PanePatch {
	readonly title?: string | undefined;
	readonly iconKey?: string | undefined;
	readonly object?: ObjectRef | null | undefined;
	readonly metadata?: Record<string, string> | undefined;
	readonly status?: PaneStatus | null | undefined;
}

const BUNDLED_KIND = /^kilo\.([a-z0-9-]+)\/([a-z0-9-]+)$/;

/**
 * A pane kind as origin's `paneType` named it (`<feature>.<tab>`, the agent
 * pane `chat`), so the events continue origin's series; other plugins' kinds
 * are reported as they are.
 */
export function paneTypeOf(kind: string): string {
	if (kind === "kilo.chat/agent") return "chat";
	const bundled = BUNDLED_KIND.exec(kind);
	return bundled ? `${bundled[1]}.${bundled[2]}` : kind;
}

const sameRef = (left: ObjectRef | undefined, right: ObjectRef) =>
	left?.type === right.type && left.id === right.id;

/**
 * The panes of every work session in main: open panes, active pane,
 * serialized layout and arrangement, kept in kv and shared by every window.
 * Opening applies the pane kind's manifest rules (`singleton`, its title)
 * without its plugin's code, and objects open through `opener`
 * contributions; the canvas owns the layout's shape and only saves it here.
 * A deleted work session's panes go with it. Every pane opened or closed is
 * reported to telemetry by its kind.
 */
export function activatePanes(sdk: PluginSdk, options: PanesOptions = {}): void {
	const createId = options.createId ?? (() => `pane_${randomUUID()}`);
	const store = panesStore(sdk);

	const panes: DomainObjectProvider<typeof Panes> = sdk.domainObjects.provide(Panes, {
		initialState: { byWorkSession: store.snapshot().byWorkSession },
		methods: {
			open: (input) => openPane(input),
			openObject: ({ workSessionId, ref, activate }) => {
				const kind = openerFor(sdk, ref);
				if (!kind) return null;
				const showing = of(workSessionId).panes.find(
					(pane) => pane.kind === kind && sameRef(pane.object, ref),
				);
				return openPane({
					workSessionId,
					kind,
					object: ref,
					...(showing ? { paneId: showing.id } : {}),
					...(activate !== undefined ? { activate } : {}),
				});
			},
			activate: ({ workSessionId, paneId }) => {
				const current = of(workSessionId);
				requirePane(current, paneId);
				write(workSessionId, { ...current, activePaneId: paneId });
			},
			update: ({ workSessionId, paneId, ...patch }) => {
				const current = of(workSessionId);
				const updated = merge(requirePane(current, paneId), patch);
				write(workSessionId, {
					...current,
					panes: current.panes.map((pane) => (pane.id === paneId ? updated : pane)),
				});
				return updated;
			},
			close: ({ workSessionId, paneId }) => {
				const current = of(workSessionId);
				const index = current.panes.findIndex((pane) => pane.id === paneId);
				if (index === -1) return { closed: false };
				const pane = current.panes[index]!;
				const rest = current.panes.filter((candidate) => candidate.id !== paneId);
				const activePaneId =
					current.activePaneId === paneId
						? (rest[Math.min(index, rest.length - 1)]?.id ?? null)
						: current.activePaneId;
				write(workSessionId, { ...current, panes: rest, activePaneId });
				panes.emit("closed", { workSessionId, pane });
				track(sdk, "pane-closed", { paneType: paneTypeOf(pane.kind) });
				return { closed: true };
			},
			setLayout: ({ workSessionId, layout, activePaneId }) => {
				const current = of(workSessionId);
				const knownActive =
					activePaneId === null || current.panes.some((pane) => pane.id === activePaneId);
				write(workSessionId, {
					...current,
					layout,
					...(activePaneId !== undefined && knownActive ? { activePaneId } : {}),
				});
			},
			setArrangement: ({ workSessionId, arrangement }) => {
				write(workSessionId, { ...of(workSessionId), arrangement });
			},
		},
	});

	function openPane(input: OpenPaneInput): Pane {
		const current = of(input.workSessionId);
		const existing = input.paneId
			? current.panes.find((pane) => pane.id === input.paneId)
			: singletonPane(current, input.kind);
		if (existing && existing.kind !== input.kind) {
			throw new KernelError("VALIDATION", "That pane belongs to another kind of pane.");
		}
		const activate = input.activate ?? true;
		if (existing) {
			const updated = merge(existing, input);
			write(input.workSessionId, {
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
			...(input.object ? { object: input.object } : {}),
			metadata: input.metadata ?? {},
			ordinal,
		};
		write(input.workSessionId, {
			...current,
			panes: [...current.panes, pane],
			activePaneId: activate || current.activePaneId === null ? pane.id : current.activePaneId,
		});
		panes.emit("opened", { workSessionId: input.workSessionId, pane });
		track(sdk, "pane-opened", { paneType: paneTypeOf(pane.kind) });
		return pane;
	}

	function of(workSessionId: string): WorkSessionPanes {
		return store.snapshot().byWorkSession[workSessionId] ?? EMPTY_WORK_SESSION_PANES;
	}
	function write(workSessionId: string, next: WorkSessionPanes | null): void {
		const byWorkSession = { ...store.snapshot().byWorkSession };
		if (next) byWorkSession[workSessionId] = next;
		else delete byWorkSession[workSessionId];
		store.set({ byWorkSession });
		panes.setState({ byWorkSession });
	}
	function requirePane(current: WorkSessionPanes, paneId: string): Pane {
		const pane = current.panes.find((candidate) => candidate.id === paneId);
		if (!pane) throw new KernelError("NOT_FOUND", "Pane not found.");
		return pane;
	}
	function merge(pane: Pane, patch: PanePatch): Pane {
		const { object: _object, status: _status, ...rest } = pane;
		const object = patch.object === undefined ? pane.object : (patch.object ?? undefined);
		const status = patch.status === undefined ? pane.status : (patch.status ?? undefined);
		return {
			...rest,
			...(patch.title?.trim() ? { title: patch.title.trim() } : {}),
			...(patch.iconKey ? { iconKey: patch.iconKey } : {}),
			...(patch.metadata ? { metadata: patch.metadata } : {}),
			...(object ? { object } : {}),
			...(status ? { status } : {}),
		};
	}
	function kindMetadata(kind: string) {
		return sdk.extensions.list(PaneKind).find((contribution) => contribution.key === kind)
			?.metadata;
	}
	function singletonPane(current: WorkSessionPanes, kind: string): Pane | undefined {
		if (!kindMetadata(kind)?.singleton) return undefined;
		return current.panes.find((pane) => pane.kind === kind);
	}
	function kindTitle(kind: string, ordinal: number): string {
		const title = kindMetadata(kind)?.title ?? "Pane";
		return ordinal > 1 ? `${title} ${ordinal}` : title;
	}

	const stopDeleted = sdk.domainObjects.get(WorkSessions)?.on("deleted", ({ workSession }) => {
		if (store.snapshot().byWorkSession[workSession.id]) write(workSession.id, null);
	});
	sdk.onDispose(() => stopDeleted?.());
}
