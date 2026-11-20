import { KernelError, mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import {
	DEFAULT_PAGES_MCP_SERVER,
	Workbooks,
	workbookSchema,
	type AddWorkbookInput,
	type Workbook,
	type WorkbookBackend,
	type WorkbookSectionRef,
	type WorkbookTemplate,
} from "../contracts";
import { createWorkbookContent } from "./create-workbook";
import { discoverWorkbooks, markerFor } from "./discover";
import { kickoffText } from "./kickoff";
import {
	nextStep,
	openQuestions,
	openReviewTasks,
	openTasks,
	planSteps,
	stepTasks,
	whereILeftOff,
} from "./progress";
import { sectionMarkdown } from "./section-scope";
import type { PagesToolCaller } from "./pages-tools";

interface SavedWorkbooks extends Record<string, unknown> {
	workbooks: unknown[];
}

export interface WorkbookStoreDeps {
	readonly template: (id: string) => WorkbookTemplate | undefined;
	/** Every template on offer, to recognise a found workbook's sections. */
	readonly templates: () => readonly WorkbookTemplate[];
	/** Whether a workspace exists, to record a new workbook's first use there. */
	readonly workspace: (id: string) => object | undefined;
	readonly pages: (backend: WorkbookBackend) => PagesToolCaller;
	readonly now?: () => Date;
}

export interface WorkbookStore {
	/** Records that a work session started on the workbook, in a workspace or (null) none. */
	recordUse(id: string, workspaceId: string | null): void;
	/** A saved workbook id as it is now (ids were random before they became Pages project ids). */
	currentId(savedId: string): string | undefined;
}

const DEFAULT_BACKEND: WorkbookBackend = { kind: "pages-mcp", server: DEFAULT_PAGES_MCP_SERVER };

/**
 * Provides `kilo.workbooks/workbooks`. Pages decides which workbooks exist:
 * `refresh` lists the Projects marked as workbooks and replaces the list with
 * them, keeping what's known of each (its sections, and where and when the
 * person used it, which only orders the picker). The list is saved in this
 * plugin's kv store so the picker shows at once and offline; a failed refresh
 * keeps it. Workbooks created here join the list at once, and survive a
 * refresh that was already listing when they were made.
 *
 * Saved entries are re-validated on load and any that no longer parse are
 * dropped (with a warning) rather than failing the plugin. Older entries are
 * upgraded: those saved while a workbook belonged to one workspace read as
 * used there, and random ids become Pages project ids (`currentId` maps the
 * old ones, for the session store).
 */
export function provideWorkbooks(sdk: PluginSdk, deps: WorkbookStoreDeps): WorkbookStore {
	const now = deps.now ?? (() => new Date());
	const store = mainHost(sdk).storage.kv<SavedWorkbooks>({
		namespace: "workbooks",
		defaults: { workbooks: [] },
	});

	const formerIds = new Map<string, string>();
	const loaded: Workbook[] = [];
	for (const saved of store.get("workbooks")) {
		const parsed = workbookSchema.safeParse(fromWorkspaceScoped(saved));
		if (!parsed.success) {
			sdk.logger.warn("Dropped a saved workbook that no longer matches its schema.");
			continue;
		}
		const workbook = parsed.data;
		if (workbook.id !== workbook.projectId) formerIds.set(workbook.id, workbook.projectId);
		loaded.push({ ...workbook, id: workbook.projectId });
	}

	let refreshing: Promise<void> | null = null;
	/** Workbooks created while a refresh lists Pages, which its listing may have missed. */
	const createdDuringRefresh = new Set<string>();

	const workbooks = sdk.domainObjects.provide(Workbooks, {
		initialState: { workbooks: loaded, refreshing: false, refreshError: null },
		methods: {
			refresh: () => {
				refreshing ??= refresh().finally(() => {
					refreshing = null;
				});
				return refreshing;
			},
			create: async ({ workspaceId, templateId, name, values }) => {
				const template = deps.template(templateId);
				if (!template) throw new KernelError("NOT_FOUND", `No workbook template "${templateId}".`);
				if (workspaceId !== null && !deps.workspace(workspaceId)) {
					throw new KernelError("NOT_FOUND", `No workspace "${workspaceId}".`);
				}
				const content = await createWorkbookContent(deps.pages(DEFAULT_BACKEND), {
					template,
					name,
					values,
					description: markerFor(template),
				});
				const workbook = addWorkbook({
					workspaceId,
					name,
					templateId,
					backend: DEFAULT_BACKEND,
					...content,
				});
				if (refreshing) createdDuringRefresh.add(workbook.id);
				return workbook;
			},
			add: (input) => addWorkbook(input),
			rename: ({ id, name }) => {
				const renamed = { ...find(id), name };
				save(
					workbooks.state.workbooks.map((workbook) => (workbook.id === id ? renamed : workbook)),
				);
				return renamed;
			},
			forget: ({ id }) => {
				const remaining = workbooks.state.workbooks.filter(
					(workbook) => workbook.id !== currentId(id),
				);
				if (remaining.length === workbooks.state.workbooks.length) return { forgotten: false };
				save(remaining);
				return { forgotten: true };
			},
			progress: async ({ workbookId }) => {
				const workbook = find(workbookId);
				const pages = deps.pages(workbook.backend);
				const page = (itemType: string, id?: string) =>
					workbook.sections.find((section) =>
						id ? section.id === id : section.itemType === itemType,
					);
				const read = async (section: WorkbookSectionRef | undefined) => {
					if (!section) return "";
					const target = section.pageId
						? { page_id: section.pageId }
						: { project_id: workbook.projectId };
					return sectionMarkdown((await readMarkdown(pages, target)) ?? "", section.heading);
				};
				const reviewSection = page("finding", "review");
				const [brief, plan, tasks, questions, review] = await Promise.all([
					readMarkdown(pages, { project_id: workbook.projectId }, { strict: true }).then(
						(text) => text ?? "",
					),
					read(page("plan-step")),
					read(page("task", "tasks")),
					read(page("question")),
					read(reviewSection),
				]);
				const steps = planSteps(plan);
				const next = nextStep(steps);
				return {
					whereILeftOff: whereILeftOff(brief),
					steps,
					...(next ? { next: { number: next.number, title: next.title } } : {}),
					openTasks: openTasks(tasks) + openTasks(stepTasks(plan)),
					openQuestions: openQuestions(questions),
					// Older workbooks have Tasks and Review pages; now both are tasks under steps.
					openReview: reviewSection
						? openTasks(review)
						: openReviewTasks(tasks) + openReviewTasks(stepTasks(plan)),
				};
			},
			kickoff: async ({ workbookId, focus, fresh }) => {
				const workbook = find(workbookId);
				const pages = deps.pages(workbook.backend);
				const [brief, guide] = await Promise.all([
					readMarkdown(pages, { project_id: workbook.projectId }),
					workbook.guidePageId ? readMarkdown(pages, { page_id: workbook.guidePageId }) : undefined,
				]);
				const firstMove = fresh ? deps.template(workbook.templateId)?.firstMove : undefined;
				return kickoffText(workbook, {
					...(brief ? { brief } : {}),
					...(guide ? { guide } : {}),
					...(firstMove ? { firstMove } : {}),
					...(focus ? { focus } : {}),
				});
			},
		},
	});

	/** A page's markdown, or undefined when Pages can't be read (the kick-off then points at it instead). */
	async function readMarkdown(
		pages: PagesToolCaller,
		target: Readonly<Record<string, string>>,
		options: { readonly strict?: boolean } = {},
	): Promise<string | undefined> {
		try {
			const page = (await pages.call("read_page", { ...target, comments: "none" })) as {
				blocks?: { markdown?: string }[];
			};
			const text = (page?.blocks ?? [])
				.map((block) => block.markdown ?? "")
				.join("\n\n")
				.trim();
			return text || undefined;
		} catch (error) {
			if (options.strict) throw error;
			sdk.logger.warn(`Couldn't read a workbook page for the kick-off: ${String(error)}`);
			return undefined;
		}
	}

	async function refresh() {
		createdDuringRefresh.clear();
		workbooks.setState({ ...workbooks.state, refreshing: true });
		try {
			const found = await discoverWorkbooks(deps.pages(DEFAULT_BACKEND), {
				templates: deps.templates,
				known: (projectId) => {
					const known = byId(projectId);
					return known && (known.sections.length > 0 || known.guidePageId) ? known : undefined;
				},
			});
			const foundIds = new Set(found.map((workbook) => workbook.id));
			const next: Workbook[] = [
				...found.map((workbook) => {
					const known = byId(workbook.id);
					return {
						...workbook,
						createdAt: known?.createdAt ?? workbook.createdAt,
						lastUsedAt: known?.lastUsedAt ?? workbook.createdAt,
						usedIn: known?.usedIn ?? [],
					};
				}),
				...workbooks.state.workbooks.filter(
					(workbook) => createdDuringRefresh.has(workbook.id) && !foundIds.has(workbook.id),
				),
			];
			save(next, { refreshing: false, refreshError: null });
		} catch (error) {
			sdk.logger.warn(`Couldn't refresh workbooks from Pages: ${String(error)}`);
			workbooks.setState({
				...workbooks.state,
				refreshing: false,
				refreshError: error instanceof Error ? error.message : String(error),
			});
		}
	}

	function addWorkbook({ workspaceId, ...reference }: AddWorkbookInput): Workbook {
		const createdAt = now().toISOString();
		const workbook: Workbook = {
			...reference,
			id: reference.projectId,
			createdAt,
			lastUsedAt: createdAt,
			usedIn: workspaceId ? [{ workspaceId, lastUsedAt: createdAt }] : [],
		};
		save([...workbooks.state.workbooks.filter((entry) => entry.id !== workbook.id), workbook]);
		return workbook;
	}

	function byId(id: string): Workbook | undefined {
		return workbooks.state.workbooks.find((workbook) => workbook.id === id);
	}

	function currentId(savedId: string): string | undefined {
		const id = formerIds.get(savedId) ?? savedId;
		return byId(id) ? id : undefined;
	}

	function recordUse(id: string, workspaceId: string | null) {
		const current = byId(id);
		if (!current) return;
		const lastUsedAt = now().toISOString();
		const usedIn = workspaceId
			? [
					...current.usedIn.filter((use) => use.workspaceId !== workspaceId),
					{ workspaceId, lastUsedAt },
				]
			: current.usedIn;
		const used = { ...current, lastUsedAt, usedIn };
		save(workbooks.state.workbooks.map((workbook) => (workbook.id === id ? used : workbook)));
	}

	function find(id: string): Workbook {
		const workbook = byId(currentId(id) ?? id);
		if (!workbook) throw new KernelError("NOT_FOUND", `No workbook "${id}".`);
		return workbook;
	}

	function save(
		next: Workbook[],
		status: Partial<Pick<typeof workbooks.state, "refreshing" | "refreshError">> = {},
	) {
		store.set({ workbooks: next });
		workbooks.setState({ ...workbooks.state, ...status, workbooks: next });
	}

	return { recordUse, currentId };
}

/** A reference saved while workbooks belonged to one workspace, read as used there since it was created. */
function fromWorkspaceScoped(saved: unknown): unknown {
	if (typeof saved !== "object" || saved === null || "usedIn" in saved) return saved;
	const { workspaceId, ...reference } = saved as { workspaceId?: unknown; createdAt?: unknown };
	if (typeof workspaceId !== "string" || typeof reference.createdAt !== "string") return saved;
	return {
		...reference,
		lastUsedAt: reference.createdAt,
		usedIn: [{ workspaceId, lastUsedAt: reference.createdAt }],
	};
}
