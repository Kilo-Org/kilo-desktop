import { beforeEach, describe, expect, it, vi } from "vitest";

const { execa } = vi.hoisted(() => ({ execa: vi.fn() }));
vi.mock("execa", () => ({ execa }));

import {
	GithubRepositoryService,
	githubRepositoryFailure,
	parseCloneTarget,
	type PersistedRepositoryListing,
} from "./github-repositories";

function node(nameWithOwner: string, overrides: Record<string, unknown> = {}) {
	return {
		nameWithOwner,
		name: nameWithOwner.split("/")[1],
		description: null,
		isPrivate: false,
		isArchived: false,
		url: `https://github.com/${nameWithOwner}`,
		pushedAt: "2026-10-01T00:00:00Z",
		...overrides,
	};
}

/** `gh api --paginate --jq '... | @json'` prints one compact JSON node per line, across pages. */
function listOutput(...nodes: object[]) {
	return { exitCode: 0, stdout: nodes.map((value) => JSON.stringify(value)).join("\n") };
}

beforeEach(() => {
	execa.mockReset();
});

/** In-memory stand-in for the plugin's kv store. */
function memoryStore(initial: PersistedRepositoryListing = { repositories: [], fetchedAt: 0 }) {
	let value = initial;
	return {
		snapshot: () => value,
		set: vi.fn((patch: Partial<PersistedRepositoryListing>) => (value = { ...value, ...patch })),
	};
}

const MINUTE = 60_000;

describe("GithubRepositoryService.list", () => {
	it("lists every reachable repository through one paginated GraphQL query", async () => {
		execa.mockResolvedValue(
			listOutput(node("acme/app", { isPrivate: true, description: "The app" }), node("me/dots")),
		);

		await expect(new GithubRepositoryService({ now: () => 1000 }).list()).resolves.toEqual({
			repositories: [
				node("acme/app", { isPrivate: true, description: "The app" }),
				node("me/dots"),
			],
			fetchedAt: 1000,
			refreshing: false,
		});

		const [command, args] = execa.mock.calls[0]!;
		expect(command).toBe("gh");
		expect(args).toEqual(expect.arrayContaining(["api", "graphql", "--paginate"]));
		const query = args[args.indexOf("-f") + 1] as string;
		expect(query).toContain("affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]");
		expect(query).toContain("ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]");
		expect(query).toContain("orderBy: { field: PUSHED_AT, direction: DESC }");
	});

	it("waits for the environment before spawning gh", async () => {
		let ready!: () => void;
		const environment = new Promise<void>((resolve) => (ready = resolve));
		execa.mockResolvedValue(listOutput(node("acme/app")));
		const listing = new GithubRepositoryService({ environmentReady: () => environment }).list();

		await Promise.resolve();
		expect(execa).not.toHaveBeenCalled();
		ready();

		await expect(listing).resolves.toMatchObject({ repositories: [node("acme/app")] });
		expect(execa).toHaveBeenCalledTimes(1);
	});

	it("drops malformed rows and duplicate repositories", async () => {
		execa.mockResolvedValue({
			exitCode: 0,
			stdout: [
				JSON.stringify(node("acme/app")),
				"not json",
				JSON.stringify({ nameWithOwner: 42 }),
				JSON.stringify(node("acme/app")),
				"",
			].join("\n"),
		});

		const { repositories } = await new GithubRepositoryService().list();
		expect(repositories).toEqual([node("acme/app")]);
	});

	it("persists a fetched listing and serves it on the next launch without asking GitHub", async () => {
		const store = memoryStore();
		execa.mockResolvedValue(listOutput(node("acme/app")));
		await new GithubRepositoryService({ store, now: () => 1000 }).list();
		expect(store.set).toHaveBeenCalledWith({ repositories: [node("acme/app")], fetchedAt: 1000 });

		execa.mockClear();
		const relaunched = new GithubRepositoryService({ store, now: () => 1000 + MINUTE });

		await expect(relaunched.list()).resolves.toEqual({
			repositories: [node("acme/app")],
			fetchedAt: 1000,
			refreshing: false,
		});
		expect(execa).not.toHaveBeenCalled();
	});

	it("answers a stale listing immediately and refreshes it in the background", async () => {
		const store = memoryStore({ repositories: [node("acme/old")], fetchedAt: 1000 });
		const onRefreshed = vi.fn();
		let finishFetch!: (value: unknown) => void;
		execa.mockReturnValue(new Promise((resolve) => (finishFetch = resolve)));
		const github = new GithubRepositoryService({
			store,
			onRefreshed,
			now: () => 1000 + 6 * MINUTE,
		});

		await expect(github.list()).resolves.toEqual({
			repositories: [node("acme/old")],
			fetchedAt: 1000,
			refreshing: true,
		});
		await vi.waitFor(() => expect(execa).toHaveBeenCalledTimes(1));
		expect(onRefreshed).not.toHaveBeenCalled();

		finishFetch(listOutput(node("acme/new")));
		await vi.waitFor(() => expect(onRefreshed).toHaveBeenCalledTimes(1));

		await expect(github.list()).resolves.toEqual({
			repositories: [node("acme/new")],
			fetchedAt: 1000 + 6 * MINUTE,
			refreshing: false,
		});
		expect(store.snapshot().repositories).toEqual([node("acme/new")]);
	});

	it("keeps the known listing when a background refresh fails and still tells readers", async () => {
		const store = memoryStore({ repositories: [node("acme/old")], fetchedAt: 1000 });
		const onRefreshed = vi.fn();
		execa.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "network failed" });
		const github = new GithubRepositoryService({
			store,
			onRefreshed,
			now: () => 1000 + 6 * MINUTE,
		});

		await github.list();
		await vi.waitFor(() => expect(onRefreshed).toHaveBeenCalledTimes(1));

		// The re-read the event prompts must not start another (failing) refresh.
		await expect(github.list()).resolves.toMatchObject({
			repositories: [node("acme/old")],
			refreshing: false,
		});
		expect(execa).toHaveBeenCalledTimes(1);
	});

	it("tries a failed background refresh again after a minute", async () => {
		const store = memoryStore({ repositories: [node("acme/old")], fetchedAt: 1000 });
		const onRefreshed = vi.fn();
		let now = 1000 + 6 * MINUTE;
		execa.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "network failed" });
		execa.mockResolvedValueOnce(listOutput(node("acme/new")));
		const github = new GithubRepositoryService({ store, onRefreshed, now: () => now });

		await github.list();
		await vi.waitFor(() => expect(onRefreshed).toHaveBeenCalledTimes(1));
		now += MINUTE;
		await github.list();
		await vi.waitFor(() => expect(onRefreshed).toHaveBeenCalledTimes(2));

		expect(execa).toHaveBeenCalledTimes(2);
		await expect(github.list()).resolves.toMatchObject({ repositories: [node("acme/new")] });
	});

	it("waits for a fresh fetch when asked to refresh", async () => {
		const store = memoryStore({ repositories: [node("acme/old")], fetchedAt: 1000 });
		execa.mockResolvedValue(listOutput(node("acme/new")));
		const github = new GithubRepositoryService({ store, now: () => 1000 + MINUTE });

		await expect(github.list({ refresh: true })).resolves.toEqual({
			repositories: [node("acme/new")],
			fetchedAt: 1000 + MINUTE,
			refreshing: false,
		});
	});

	it("shares one fetch between concurrent callers", async () => {
		execa.mockResolvedValue(listOutput(node("acme/app")));
		const github = new GithubRepositoryService();

		await Promise.all([github.list(), github.list(), github.list({ refresh: true })]);

		expect(execa).toHaveBeenCalledTimes(1);
	});

	it("rejects a first fetch that fails, stays silent, and retries on the next call", async () => {
		const onRefreshed = vi.fn();
		execa.mockResolvedValueOnce({
			exitCode: 1,
			stdout: "",
			stderr: "To get started with GitHub CLI, please run:  gh auth login",
		});
		execa.mockResolvedValueOnce(listOutput(node("acme/app")));
		const github = new GithubRepositoryService({ onRefreshed });

		await expect(github.list()).rejects.toMatchObject({
			code: "BUSINESS",
			message: "Not authenticated with GitHub CLI. Run 'gh auth login' first.",
		});
		expect(onRefreshed).not.toHaveBeenCalled();
		await expect(github.list()).resolves.toMatchObject({ repositories: [node("acme/app")] });
	});

	it("ignores a persisted listing that is malformed", async () => {
		const store = memoryStore({
			repositories: [{ nameWithOwner: 1 }, node("acme/app")],
			fetchedAt: 1000,
		});

		await expect(
			new GithubRepositoryService({ store, now: () => 1000 }).list(),
		).resolves.toMatchObject({ repositories: [node("acme/app")] });
		expect(execa).not.toHaveBeenCalled();
	});

	it("explains a missing GitHub CLI", async () => {
		execa.mockRejectedValue(Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }));

		await expect(new GithubRepositoryService().list()).rejects.toMatchObject({
			message: expect.stringContaining("not installed"),
		});
	});

	it("explains a GitHub CLI that does not answer in time", async () => {
		execa.mockResolvedValue({ exitCode: undefined, stdout: "", stderr: "", timedOut: true });

		await expect(new GithubRepositoryService().list()).rejects.toMatchObject({
			code: "BUSINESS",
			message: "The GitHub CLI took too long to respond.",
		});
	});
});

describe("GithubRepositoryService.clone", () => {
	it("clones through gh with interactive prompts disabled", async () => {
		execa.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

		await new GithubRepositoryService().clone({
			repository: "acme/app",
			destination: "/projects/app",
		});

		expect(execa).toHaveBeenCalledWith(
			"gh",
			["repo", "clone", "acme/app", "/projects/app"],
			expect.objectContaining({
				reject: false,
				env: expect.objectContaining({ GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" }),
			}),
		);
	});

	it("explains a repository GitHub cannot find", async () => {
		execa.mockResolvedValue({
			exitCode: 1,
			stdout: "",
			stderr:
				"GraphQL: Could not resolve to a Repository with the name 'anaconda/dot-or'. (repository)",
		});

		await expect(
			new GithubRepositoryService().clone({
				repository: "anaconda/dot-or",
				destination: "/p/dot-or",
			}),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message:
				"GitHub couldn't find anaconda/dot-or. Check the name, or make sure your GitHub account has access to it.",
		});
	});

	it("falls back to the tail of git's output for failures it does not recognize", async () => {
		execa.mockResolvedValue({
			exitCode: 1,
			stdout: "",
			stderr: "Cloning into '/projects/app'...\nfatal: early EOF\nfatal: index-pack failed",
		});

		await expect(
			new GithubRepositoryService().clone({ repository: "acme/app", destination: "/projects/app" }),
		).rejects.toMatchObject({
			code: "BUSINESS",
			message: "The repository could not be cloned. fatal: early EOF\nfatal: index-pack failed",
		});
	});

	it("rejects anything that is not a GitHub repository before spawning gh", async () => {
		await expect(
			new GithubRepositoryService().clone({ repository: "--upload-pack=x", destination: "/p/x" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		expect(execa).not.toHaveBeenCalled();
	});
});

describe("githubRepositoryFailure", () => {
	it.each([
		[
			"remote: Repository not found.\nfatal: repository 'https://github.com/a/b/' not found",
			"NOT_FOUND",
			"couldn't find a/b",
		],
		["Resource protected by organization SAML enforcement.", "BUSINESS", "single sign-on"],
		["git@github.com: Permission denied (publickey).", "BUSINESS", "over SSH"],
		[
			"fatal: could not read Username for 'https://github.com': terminal prompts disabled",
			"BUSINESS",
			"gh auth login",
		],
		[
			"fatal: destination path 'b' already exists and is not an empty directory.",
			"VALIDATION",
			"already exists",
		],
		["fatal: Could not resolve host: github.com", "BUSINESS", "internet connection"],
		["error: unable to write file: No space left on device", "BUSINESS", "disk space"],
	])("maps %j to an actionable error", (stderr, code, message) => {
		const error = githubRepositoryFailure(stderr, "a/b", "Failed.");
		expect(error.code).toBe(code);
		expect(error.message).toContain(message);
	});
});

describe("GithubRepositoryService.resolve", () => {
	it("looks a repository up with gh repo view", async () => {
		execa.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify(node("acme/app")) });

		await expect(
			new GithubRepositoryService().resolve("https://github.com/acme/app"),
		).resolves.toEqual(node("acme/app"));
		expect(execa).toHaveBeenCalledWith(
			"gh",
			[
				"repo",
				"view",
				"https://github.com/acme/app",
				"--json",
				"nameWithOwner,name,description,isPrivate,isArchived,url,pushedAt",
			],
			expect.objectContaining({ reject: false }),
		);
	});

	it("reports a repository that does not exist as not found", async () => {
		execa.mockResolvedValue({
			exitCode: 1,
			stdout: "",
			stderr: "GraphQL: Could not resolve to a Repository with the name 'acme/nope'. (repository)",
		});

		await expect(new GithubRepositoryService().resolve("acme/nope")).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: expect.stringContaining("couldn't find acme/nope"),
		});
	});

	it("rejects an unexpected response", async () => {
		execa.mockResolvedValue({ exitCode: 0, stdout: "not json" });

		await expect(new GithubRepositoryService().resolve("acme/app")).rejects.toMatchObject({
			code: "BUSINESS",
			message: "GitHub returned an unexpected response.",
		});
	});

	it("rejects input that is not a GitHub repository before spawning gh", async () => {
		await expect(new GithubRepositoryService().resolve("not a repo")).rejects.toMatchObject({
			code: "VALIDATION",
		});
		expect(execa).not.toHaveBeenCalled();
	});
});

describe("parseCloneTarget", () => {
	it.each([
		["acme/app", "acme/app"],
		["  acme/app.git ", "acme/app"],
		["https://github.com/acme/app", "https://github.com/acme/app"],
		["git@github.com:acme/app.git", "https://github.com/acme/app"],
		["https://tenant.ghe.com/acme/app/", "https://tenant.ghe.com/acme/app"],
	])("accepts %j", (input, expected) => {
		expect(parseCloneTarget(input)).toBe(expected);
	});

	it.each(["", "app", "acme/app/extra", "-acme/app", "https://gitlab.com/acme/app", "a b/c"])(
		"rejects %j",
		(input) => {
			expect(parseCloneTarget(input)).toBeNull();
		},
	);
});
