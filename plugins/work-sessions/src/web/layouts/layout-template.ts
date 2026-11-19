import {
	ARTIFACT_PANE_PREFERRED_WIDTH,
	descriptor,
	getPaneColumns,
	PANE_MIN_WIDTH,
	type PaneGroup,
	type PaneKind as LayoutKind,
	type PaneLayout,
} from "@kilo-desktop/pane-layout";
import type { ObjectRef } from "@kilo-desktop/kernel";
import type { LayoutTemplate, Pane, WorkSessionPanes } from "../../contracts";
import { panesInOrder, saveLayout, sessionPanesOf, type PanesHandle } from "../shared/pane-actions";
import { sessionLayout } from "../shared/session-layout";

/** What templates need of the pane kinds contributed in this window (`usePaneKinds()` fits). */
export interface TemplateKinds {
	readonly byKey: ReadonlyMap<
		string,
		{
			readonly metadata: {
				readonly launch: { readonly newSession: boolean; readonly inSession: boolean };
			};
		}
	>;
	readonly layoutKindOf: (kind: string) => LayoutKind;
}

export interface CapturedTemplate {
	readonly template: LayoutTemplate;
	/** Titles of panes a template can't recreate, so they are left out. */
	readonly omittedTitles: string[];
}

type TemplateGroup = LayoutTemplate["groups"][number];

/** A kind can be recreated when it starts without an object (from "+" or the New Session page). */
function recreatable(kinds: TemplateKinds, kind: string | undefined): boolean {
	const launch = kind === undefined ? undefined : kinds.byKey.get(kind)?.metadata.launch;
	return launch !== undefined && (launch.inSession || launch.newSession);
}

/**
 * A template of the work session's panes as the canvas shows them: one slot per
 * pane whose kind can be recreated, grouped, sized, pinned and stacked as
 * now. Pane identities, titles and metadata are not kept.
 */
export function captureLayoutTemplate(
	state: WorkSessionPanes,
	kinds: TemplateKinds,
): CapturedTemplate {
	const layout = sessionLayout(state, kinds.layoutKindOf);
	const kindOf = new Map(state.panes.map((pane) => [pane.id, pane.kind]));
	const slots: LayoutTemplate["slots"] = [];
	const groups: TemplateGroup[] = [];
	const omittedTitles: string[] = [];
	let activePaneId: string | undefined;
	for (const column of getPaneColumns(layout.groups, layout.sizes)) {
		const columnGroups: TemplateGroup[] = [];
		for (const group of column.groups) {
			const ids = new Map<string, string>();
			for (const pane of group.tabs) {
				const kind = kindOf.get(pane.id);
				if (kind === undefined || !recreatable(kinds, kind)) {
					omittedTitles.push(pane.title);
					continue;
				}
				const id = `slot-${slots.length + 1}`;
				slots.push({ id, kind });
				ids.set(pane.id, id);
				if (pane.id === layout.activePaneId) activePaneId = id;
			}
			const tabs = [...ids.values()];
			if (tabs.length === 0) continue;
			columnGroups.push({
				id: `group-${groups.length + columnGroups.length + 1}`,
				tabs,
				activePaneId: ids.get(group.activePaneId) ?? tabs[0]!,
				width: column.width,
				pinned: column.pinned,
				...(group.stackWeight === undefined ? {} : { stackWeight: group.stackWeight }),
			});
		}
		const total = columnGroups.reduce((sum, group) => sum + (group.stackWeight ?? 1), 0);
		for (const group of columnGroups) {
			if (columnGroups.length > 1) {
				group.stackId = `stack-${groups.length + 1}`;
				group.stackWeight = (group.stackWeight ?? 1) / total;
			} else delete group.stackWeight;
		}
		groups.push(...columnGroups);
	}
	const active = activePaneId ?? groups[0]?.activePaneId;
	return {
		template: {
			version: 2,
			arrangement: state.arrangement,
			...(active === undefined ? {} : { activePaneId: active }),
			slots,
			groups,
		},
		omittedTitles,
	};
}

/** Something the work session holds but no pane shows (a closed chat), and the pane kind that opens it. */
export interface ClosedObject {
	readonly kind: string;
	readonly object: ObjectRef;
}

export interface LayoutPlan {
	/** Slots filled by panes the work session already has. */
	readonly reused: ReadonlyMap<string, Pane>;
	/** Slots that need a new pane, in template order: on a closed object, or empty. */
	readonly opens: readonly {
		readonly slotId: string;
		readonly kind: string;
		readonly object?: ObjectRef;
	}[];
	/** Slots left out because no plugin in this window contributes their kind. */
	readonly skipped: readonly string[];
	/** Panes the template has no slot for, in tab order: closed when the caller closes them. */
	readonly unplaced: readonly Pane[];
}

export interface TemplateOptions {
	/** Closed objects, in the order to reopen them (see `planLayoutTemplate`). */
	readonly closed?: readonly ClosedObject[];
	/**
	 * Closes an unplaced pane, false when it stays (its kind's `canClose`
	 * declined). Panes that stay keep a column at the end.
	 */
	readonly close?: (pane: Pane) => Promise<boolean>;
}

/**
 * How a template applies to a work session. Each slot reuses the work session's next
 * unused pane of its kind (in the order the tabs show), else reopens the next
 * of `closed` its kind opens (a closed chat in an agent slot), else opens an
 * empty one. Panes left over are unplaced, whatever their kind.
 */
export function planLayoutTemplate(
	template: LayoutTemplate,
	state: WorkSessionPanes,
	kinds: TemplateKinds,
	{ closed = [] }: Pick<TemplateOptions, "closed"> = {},
): LayoutPlan {
	const byId = new Map(state.panes.map((pane) => [pane.id, pane]));
	const unused = panesInOrder(sessionLayout(state, kinds.layoutKindOf)).flatMap((id) => {
		const pane = byId.get(id);
		return pane ? [pane] : [];
	});
	const reopenable = [...closed];
	const reused = new Map<string, Pane>();
	const opens: { slotId: string; kind: string; object?: ObjectRef }[] = [];
	const skipped: string[] = [];
	for (const slot of template.slots) {
		if (!kinds.byKey.has(slot.kind)) {
			skipped.push(slot.id);
			continue;
		}
		const index = unused.findIndex((pane) => pane.kind === slot.kind);
		if (index !== -1) {
			reused.set(slot.id, unused.splice(index, 1)[0]!);
			continue;
		}
		const reopen = reopenable.findIndex((candidate) => candidate.kind === slot.kind);
		const object = reopen === -1 ? undefined : reopenable.splice(reopen, 1)[0]!.object;
		opens.push({ slotId: slot.id, kind: slot.kind, ...(object ? { object } : {}) });
	}
	return { reused, opens, skipped, unplaced: unused };
}

/**
 * The canvas layout a template describes, given the pane in each slot.
 * Groups whose slots are all missing are dropped, as is a stack left with a
 * single group; surviving stack weights are rescaled.
 */
export function buildTemplateLayout(
	template: LayoutTemplate,
	panesBySlot: ReadonlyMap<string, Pane>,
	extras: readonly Pane[],
	layoutKindOf: (kind: string) => LayoutKind,
): PaneLayout {
	const place = (pane: Pane) =>
		descriptor({ id: pane.id, kind: layoutKindOf(pane.kind), title: pane.title });
	const groups: PaneGroup[] = template.groups.flatMap((group) => {
		const tabs = group.tabs.flatMap((slotId) => {
			const pane = panesBySlot.get(slotId);
			return pane ? [place(pane)] : [];
		});
		if (tabs.length === 0) return [];
		return [
			{
				id: `preset:${group.id}`,
				tabs,
				activePaneId: panesBySlot.get(group.activePaneId)?.id ?? tabs[0]!.id,
				preferredWidth: Math.max(PANE_MIN_WIDTH, group.width),
				minWidth: PANE_MIN_WIDTH,
				pinned: group.pinned,
				...(group.stackId ? { stackId: `preset:${group.stackId}` } : {}),
				...(group.stackWeight === undefined ? {} : { stackWeight: group.stackWeight }),
			},
		];
	});
	for (const group of groups) {
		if (!group.stackId) continue;
		const stack = groups.filter((candidate) => candidate.stackId === group.stackId);
		if (stack.length === 1) {
			delete group.stackId;
			delete group.stackWeight;
			continue;
		}
		const total = stack.reduce((sum, candidate) => sum + (candidate.stackWeight ?? 1), 0);
		for (const candidate of stack) candidate.stackWeight = (candidate.stackWeight ?? 1) / total;
	}
	if (extras.length > 0) {
		const tabs = extras.map(place);
		groups.push({
			id: "preset-extra-panes",
			tabs,
			activePaneId: tabs[0]!.id,
			preferredWidth: ARTIFACT_PANE_PREFERRED_WIDTH,
			minWidth: PANE_MIN_WIDTH,
			pinned: false,
		});
	}
	const templateActive =
		template.activePaneId === undefined ? undefined : panesBySlot.get(template.activePaneId)?.id;
	return {
		groups,
		activePaneId: templateActive ?? groups[0]?.activePaneId ?? "",
		sizes: Object.fromEntries(groups.map((group) => [group.id, group.preferredWidth])),
	};
}

/**
 * Applies a template to a work session: closes the panes it has no slot for (`close`),
 * opens what's missing (on `closed` objects first, see `planLayoutTemplate`),
 * then saves its layout and arrangement.
 */
export async function applyLayoutTemplate(
	panes: PanesHandle,
	workSessionId: string,
	template: LayoutTemplate,
	kinds: TemplateKinds,
	{ closed, close }: TemplateOptions = {},
): Promise<void> {
	const plan = planLayoutTemplate(template, sessionPanesOf(panes, workSessionId), kinds, {
		...(closed ? { closed } : {}),
	});
	const kept: Pane[] = [];
	for (const pane of plan.unplaced) {
		// A close may ask the person to confirm, so panes close one at a time.
		// react-doctor-disable-next-line react-doctor/async-await-in-loop
		if (!close || !(await close(pane))) kept.push(pane);
	}
	const bySlot = new Map(plan.reused);
	const placed = new Set([...plan.reused.values()].map((pane) => pane.id));
	for (const { slotId, kind, object } of plan.opens) {
		// Opens run in slot order so a singleton kind's one pane lands in its first slot.
		// react-doctor-disable-next-line react-doctor/async-await-in-loop
		const pane = await panes.methods.open({
			workSessionId,
			kind,
			...(object ? { object } : {}),
			activate: false,
		});
		// A singleton kind hands back its one pane; it fills only the first slot.
		if (placed.has(pane.id)) continue;
		placed.add(pane.id);
		bySlot.set(slotId, pane);
	}
	const layout = buildTemplateLayout(template, bySlot, kept, kinds.layoutKindOf);
	if (layout.groups.length > 0) await saveLayout(panes, workSessionId, layout);
	await panes.methods.setArrangement({ workSessionId, arrangement: template.arrangement });
}
