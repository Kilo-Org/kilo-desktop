import { KernelError, type PluginSdk } from "@kilo-desktop/kernel";

import {
	WorkbookTemplatePoint,
	WorkbookTemplates,
	FIRST_MOVE,
	templateQuestions,
	workbookTemplateSchema,
	type TemplateSummary,
	type WorkbookTemplate,
} from "../contracts";

/** Templates from outside the extension point: the person's own, by source label. */
export interface ExtraTemplate {
	readonly source: string;
	read(): unknown;
}

/**
 * Provides `kilo.workbooks/templates` from every `template` contribution
 * implemented in main, then any `extra` ones (the person's own templates),
 * re-read whenever the point changes or `reread` is called.
 *
 * Each contribution's template is validated on every read; one that fails, or
 * that repeats an id a higher-priority contribution already offers, is left
 * out and reported as an issue (and logged once), so a broken template never
 * hides the others. Contributions are taken in the registry's priority order;
 * the subscription is disposed with the plugin.
 */
export function provideTemplates(
	sdk: PluginSdk,
	extra: () => readonly ExtraTemplate[] = () => [],
): {
	find(id: string): WorkbookTemplate | undefined;
	all(): WorkbookTemplate[];
	/** Ids contributed through the extension point (built-ins and plugins'). */
	contributedIds(): ReadonlySet<string>;
	reread(): void;
} {
	let contributed = new Set<string>();
	let templates = new Map<string, WorkbookTemplate>();
	const warned = new Set<string>();

	const templatesObject = sdk.domainObjects.provide(WorkbookTemplates, {
		initialState: { templates: [], issues: [] },
		methods: {
			get: ({ id }) => {
				const template = templates.get(id);
				if (!template) throw new KernelError("NOT_FOUND", `No workbook template "${id}".`);
				return template;
			},
		},
	});

	const reread = () => {
		const next = new Map<string, WorkbookTemplate>();
		const summaries: TemplateSummary[] = [];
		const issues: { source: string; message: string }[] = [];
		const report = (source: string, message: string) => {
			issues.push({ source, message });
			const line = `Skipped workbook template "${source}": ${message}`;
			if (!warned.has(line)) {
				warned.add(line);
				sdk.logger.warn(line);
			}
		};
		const sources = [
			...sdk.extensions.list(WorkbookTemplatePoint).map((contribution) => ({
				key: contribution.key,
				read: contribution.implementation ? () => contribution.implementation!.read() : undefined,
			})),
			...extra().map((template) => ({ key: template.source, read: () => template.read() })),
		];
		const pointCount = sdk.extensions.list(WorkbookTemplatePoint).length;
		const fromPoint = new Set<string>();
		for (const [index, contribution] of sources.entries()) {
			const outcome = readTemplate(contribution.read);
			if ("problem" in outcome) {
				if (outcome.problem) report(contribution.key, outcome.problem);
				continue;
			}
			const { template } = outcome;
			if (next.has(template.id)) {
				report(contribution.key, `the id "${template.id}" is already taken`);
				continue;
			}
			if (index < pointCount) fromPoint.add(template.id);
			next.set(template.id, template);
			summaries.push({
				id: template.id,
				name: template.name,
				description: template.description,
				...(template.icon ? { icon: template.icon } : {}),
				fields: templateQuestions(template),
				firstMove: FIRST_MOVE,
				source: contribution.key,
			});
		}
		templates = next;
		contributed = fromPoint;
		templatesObject.setState({ templates: summaries, issues });
	};

	reread();
	sdk.extensions.subscribe(WorkbookTemplatePoint, reread);
	return {
		find: (id) => templates.get(id),
		all: () => [...templates.values()],
		contributedIds: () => contributed,
		reread,
	};
}

function readTemplate(
	read: (() => unknown) | undefined,
): { template: WorkbookTemplate } | { problem: string | null } {
	// Implemented in another process (never, for a main point) or not yet bound.
	if (!read) return { problem: null };
	try {
		const result = workbookTemplateSchema.safeParse(read());
		if (result.success) return { template: result.data };
		return {
			problem: result.error.issues
				.map((issue) => (issue.path.length ? `${issue.path.join(".")}: ` : "") + issue.message)
				.join("; "),
		};
	} catch (error) {
		return { problem: error instanceof Error ? error.message : String(error) };
	}
}
