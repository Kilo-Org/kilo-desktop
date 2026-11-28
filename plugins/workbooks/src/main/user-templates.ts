import { KernelError, type PluginFs } from "@kilo-desktop/kernel";

import {
	templateIssues,
	workbookTemplateSchema,
	type SectionTypeLookup,
	type WorkbookTemplateInput,
} from "../contracts";
import { GUIDE_FILE, templateFromFiles } from "./template-files";

/** Where user templates live in kilo.workbooks' own data folder: one folder per template. */
export const USER_TEMPLATES_DIR = "templates";
const MANIFEST = "workbook.json";

/** A user template as read from disk: its folder id and either its template or why it can't be read. */
export type UserTemplate =
	| { readonly folder: string; readonly template: WorkbookTemplateInput }
	| { readonly folder: string; readonly problem: string };

/**
 * Workbook templates the person (through an agent) has made, kept in
 * kilo.workbooks' plugin data folder as `templates/<id>/workbook.json` and
 * `AGENTS.md` — the same files a built-in template has. They are read when
 * the plugin starts and after every save or delete (there is no file
 * watcher; edits made outside the app show after the next save or restart).
 * A template is checked against the schema before it is written, so a save
 * never leaves a broken template behind; one broken by hand is reported
 * like any other invalid template and never hides the rest.
 */
export class UserTemplates {
	#templates: UserTemplate[] = [];

	constructor(private readonly fs: PluginFs) {}

	list(): readonly UserTemplate[] {
		return this.#templates;
	}

	async load(): Promise<void> {
		const folders = (await this.fs.readdir(USER_TEMPLATES_DIR).catch(() => [])).sort();
		this.#templates = await Promise.all(folders.map((folder) => this.#read(folder)));
	}

	/**
	 * Validates and writes a template: `template` is `workbook.json`'s content,
	 * `guide` the guide's markdown. Returns the template as it will be offered.
	 * Throws VALIDATION naming every problem.
	 */
	async save(
		template: unknown,
		guide: string,
		reserved: ReadonlySet<string>,
		types: SectionTypeLookup,
	): Promise<WorkbookTemplateInput> {
		const { guide: _, schemaVersion: __, ...rest } = template as Record<string, unknown>;
		const checked = workbookTemplateSchema.safeParse({ ...rest, guide });
		if (!checked.success) {
			throw new KernelError(
				"VALIDATION",
				`Not a valid workbook template: ${issuesOf(checked.error)}`,
			);
		}
		const issues = templateIssues(checked.data, types);
		if (issues.length > 0) {
			throw new KernelError("VALIDATION", `Not a valid workbook template: ${issues.join("; ")}`);
		}
		if (reserved.has(checked.data.id)) {
			throw new KernelError(
				"VALIDATION",
				`"${checked.data.id}" is a built-in template's id; choose another.`,
			);
		}
		const folder = `${USER_TEMPLATES_DIR}/${checked.data.id}`;
		await this.fs.mkdir(folder);
		await this.fs.writeFile(
			`${folder}/${MANIFEST}`,
			`${JSON.stringify({ schemaVersion: 3, ...rest }, null, "\t")}\n`,
		);
		await this.fs.writeFile(`${folder}/${GUIDE_FILE}`, guide.endsWith("\n") ? guide : `${guide}\n`);
		await this.load();
		return { ...(rest as Omit<WorkbookTemplateInput, "guide">), guide };
	}

	async remove(id: string): Promise<void> {
		if (!this.#templates.some((entry) => entry.folder === id)) {
			throw new KernelError("NOT_FOUND", `No template of yours is called "${id}".`);
		}
		await this.fs.remove(`${USER_TEMPLATES_DIR}/${id}`);
		await this.load();
	}

	async #read(folder: string): Promise<UserTemplate> {
		try {
			const manifest = JSON.parse(
				await this.fs.readFile(`${USER_TEMPLATES_DIR}/${folder}/${MANIFEST}`),
			);
			const guide = await this.fs.readFile(`${USER_TEMPLATES_DIR}/${folder}/${GUIDE_FILE}`);
			const files = { [GUIDE_FILE]: guide };
			return { folder, template: templateFromFiles(manifest, files) };
		} catch (error) {
			return { folder, problem: problemOf(error) };
		}
	}
}

function problemOf(error: unknown): string {
	if (error && typeof error === "object" && "issues" in error) return issuesOf(error as never);
	return error instanceof Error ? error.message : String(error);
}

function issuesOf(error: {
	issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): string {
	return error.issues
		.map(
			(issue) => (issue.path.length ? `${issue.path.map(String).join(".")}: ` : "") + issue.message,
		)
		.join("; ");
}
