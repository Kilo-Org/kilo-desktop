import { KernelError, type Contribution, type PluginSdk } from "@kilo-desktop/kernel";

import {
	WorkbookTemplatePoint,
	WorkbookTemplates,
	workbookTemplateSchema,
	type TemplateSummary,
	type WorkbookTemplate,
} from "../contracts";

type TemplateContribution = Contribution<typeof WorkbookTemplatePoint>;

/**
 * Provides `kilo.workbooks/templates` from every `template` contribution
 * implemented in main, re-read whenever the point changes.
 *
 * Each contribution's template is validated on every read; one that fails, or
 * that repeats an id a higher-priority contribution already offers, is left
 * out and reported as an issue (and logged once), so a broken template never
 * hides the others. Contributions are taken in the registry's priority order;
 * the subscription is disposed with the plugin.
 */
export function provideTemplates(sdk: PluginSdk): void {
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
		for (const contribution of sdk.extensions.list(WorkbookTemplatePoint)) {
			const outcome = readTemplate(contribution);
			if ("problem" in outcome) {
				if (outcome.problem) report(contribution.key, outcome.problem);
				continue;
			}
			const { template } = outcome;
			if (next.has(template.id)) {
				report(contribution.key, `the id "${template.id}" is already taken`);
				continue;
			}
			next.set(template.id, template);
			summaries.push({
				id: template.id,
				name: template.name,
				description: template.description,
				...(template.icon ? { icon: template.icon } : {}),
				fields: template.brief.fields,
				source: contribution.key,
			});
		}
		templates = next;
		templatesObject.setState({ templates: summaries, issues });
	};

	reread();
	sdk.extensions.subscribe(WorkbookTemplatePoint, reread);
}

function readTemplate(
	contribution: TemplateContribution,
): { template: WorkbookTemplate } | { problem: string | null } {
	// Implemented in another process (never, for a main point) or not yet bound.
	if (!contribution.implementation) return { problem: null };
	try {
		const result = workbookTemplateSchema.safeParse(contribution.implementation.read());
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
