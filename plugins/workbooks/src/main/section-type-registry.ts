import { z } from "zod";

import type { PluginSdk } from "@kilo-desktop/kernel";

import {
	SectionTypePoint,
	SectionTypes,
	type SectionTypeDefinition,
	type SectionTypeLookup,
	type SectionTypeSummary,
} from "../contracts";

const VERBS = ["starter", "add", "setStatus", "remove", "supersede", "write"] as const;

/** The shape a contributed section type must have; its behaviour is trusted once it does. */
const definitionSchema = z.looseObject({
	single: z.boolean(),
	title: z.string().min(1),
	collects: z.string().min(1),
	usage: z.string().min(1),
	actions: z
		.record(
			z.string().regex(/^[a-z][a-z0-9_-]*$/, "name actions in lowercase, dashes or underscores"),
			z.looseObject({
				description: z.string().min(1),
				input: z.custom<z.ZodType>(
					(value) => typeof (value as { safeParse?: unknown })?.safeParse === "function",
					"must be a zod schema",
				),
				run: z.custom<(...args: never[]) => unknown>(
					(value) => typeof value === "function",
					"must be a function",
				),
			}),
		)
		.optional(),
	...Object.fromEntries(
		VERBS.map((verb) => [
			verb,
			z.custom((value) => typeof value === "function", "must be a function").optional(),
		]),
	),
});

const TYPE_ID = /^[a-z][a-z0-9-]*$/;

export interface SectionTypeRegistry {
	/** A section type's definition, when one is offered. */
	find(type: string): SectionTypeDefinition | undefined;
	/** What templates need of a type, for resolving and checking them. */
	readonly facts: SectionTypeLookup;
	/** Calls `listener` after the types on offer change. */
	subscribe(listener: () => void): void;
}

/**
 * Provides `kilo.workbooks/section-types` from every `section-type`
 * contribution implemented in main, re-read whenever the point changes. A
 * contribution's id is the type's id. One whose definition is malformed, or
 * whose id a higher-priority contribution already offers, is left out and
 * reported (and logged once), so a broken type never hides the others;
 * listeners (the template registry) re-read after every change.
 */
export function provideSectionTypes(sdk: PluginSdk): SectionTypeRegistry {
	let types = new Map<string, SectionTypeDefinition>();
	const listeners = new Set<() => void>();
	const warned = new Set<string>();
	const object = sdk.domainObjects.provide(SectionTypes, {
		initialState: { types: [], issues: [] },
		methods: {},
	});

	const reread = () => {
		const next = new Map<string, SectionTypeDefinition>();
		const summaries: SectionTypeSummary[] = [];
		const issues: { source: string; message: string }[] = [];
		const report = (source: string, message: string) => {
			issues.push({ source, message });
			const line = `Skipped workbook section type "${source}": ${message}`;
			if (!warned.has(line)) {
				warned.add(line);
				sdk.logger.warn(line);
			}
		};
		for (const contribution of sdk.extensions.list(SectionTypePoint)) {
			const definition = contribution.implementation;
			if (!definition) continue;
			if (!TYPE_ID.test(contribution.id)) {
				report(contribution.key, "its id must be lowercase letters, digits and dashes");
				continue;
			}
			const checked = definitionSchema.safeParse(definition);
			if (!checked.success) {
				report(
					contribution.key,
					checked.error.issues
						.map((issue) => (issue.path.length ? `${issue.path.join(".")}: ` : "") + issue.message)
						.join("; "),
				);
				continue;
			}
			if (next.has(contribution.id)) {
				report(contribution.key, `the id "${contribution.id}" is already taken`);
				continue;
			}
			next.set(contribution.id, definition);
			summaries.push({
				id: contribution.id,
				title: definition.title,
				collects: definition.collects,
				usage: definition.usage,
				single: definition.single,
				actions: Object.entries(definition.actions ?? {}).map(([name, action]) => ({
					name,
					description: action.description,
				})),
				source: contribution.key,
			});
		}
		types = next;
		object.setState({ types: summaries, issues });
		for (const listener of listeners) listener();
	};

	reread();
	sdk.extensions.subscribe(SectionTypePoint, reread);
	return {
		find: (type) => types.get(type),
		facts: (type) => types.get(type),
		subscribe: (listener) => void listeners.add(listener),
	};
}
