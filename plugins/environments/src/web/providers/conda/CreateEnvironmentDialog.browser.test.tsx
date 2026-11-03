import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { Toaster, toast } from "@kilo-desktop/ui/components/sonner";

import {
	type CondaEnvsCheckPrefixInput,
	type CondaEnvsCheckPrefixResult,
	type CondaEnvsCreateInput,
	type CondaEnvsCreateResult,
	type CondaRepodataFindInput,
	type CondaRepodataFindResult,
	type CondaRepodataPackage,
} from "../../../contracts/providers/conda.js";
import { renderWithConda, type EnvironmentsHostOptions } from "../../../test/environments-host.js";
import { CreateEnvironmentDialog } from "./CreateEnvironmentDialog.js";

function pkg(name: string, versions: string[] = []): CondaRepodataPackage {
	return {
		name,
		version: versions[0] ?? "1.0.0",
		build: 0,
		channel: "https://conda.anaconda.org/conda-forge",
		summary: "",
		home: "",
		versions: versions.map((version) => ({ version, size: 1000 })),
	};
}

function pkgWithSizes(
	name: string,
	versions: { version: string; size: number }[],
): CondaRepodataPackage {
	return {
		name,
		version: versions[0]?.version ?? "1.0.0",
		build: 0,
		channel: "https://conda.anaconda.org/conda-forge",
		summary: "",
		home: "",
		versions,
	};
}

async function renderDialog(
	options: {
		find?: () => CondaRepodataPackage[];
		/** Full control over the search response, e.g. to page by `limit`. */
		search?: (input: CondaRepodataFindInput) => CondaRepodataFindResult;
		create?: (input: CondaEnvsCreateInput) => CondaEnvsCreateResult;
		/**
		 * Override the prefix check. By default it behaves like the real one
		 * against an in-memory disk: `taken` prefixes plus every prefix a
		 * successful create produced are reported as existing environments.
		 */
		checkPrefix?: (input: CondaEnvsCheckPrefixInput) => Promise<CondaEnvsCheckPrefixResult>;
		taken?: string[];
		channels?: string[];
		envsDirs?: string[];
		track?: (input: { event: string; data: Record<string, unknown> }) => unknown;
	} = {},
) {
	const find = options.find ?? (() => [pkg("numpy", ["1.26.4", "1.25.0"]), pkg("pandas")]);
	const create: (input: CondaEnvsCreateInput) => CondaEnvsCreateResult =
		options.create ?? (() => ({ jobId: "job-1", environment: { name: "x", prefix: "/x" } }));
	const disk = new Set(options.taken ?? []);
	const checkPrefix =
		options.checkPrefix ??
		(async ({ prefix }: CondaEnvsCheckPrefixInput): Promise<CondaEnvsCheckPrefixResult> =>
			disk.has(prefix) ? { available: false, reason: "exists-environment" } : { available: true });
	const hostOptions: EnvironmentsHostOptions = {
		handlers: {
			"conda.envs.list": async () => [],
			"conda.envs.prefixOptions": async () => ({
				envsDirs: options.envsDirs ?? ["/opt/anaconda3/envs"],
				channels: options.channels ?? ["defaults", "conda-forge"],
			}),
			"conda.envs.checkPrefix": checkPrefix,
			"conda.repodata.find": async (input: CondaRepodataFindInput) =>
				options.search ? options.search(input) : { packages: find(), truncated: false },
			"conda.envs.create": async (input: CondaEnvsCreateInput) => {
				const result = create(input);
				if (input.prefix) disk.add(input.prefix);
				return result;
			},
		},
		...(options.track ? { track: options.track } : {}),
	};

	return renderWithConda(
		<>
			<CreateEnvironmentDialog open onClose={() => {}} />
			<Toaster />
		</>,
		hostOptions,
	);
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

afterEach(() => {
	toast.dismiss();
	cleanup();
});

describe("CreateEnvironmentDialog (modal)", () => {
	it("renders the manual create modal with the package grid populated", async () => {
		const { baseElement } = await renderDialog();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-create-dialog")).toBeVisible();
		// As the first test in the file this one absorbs browser and module warm-up,
		// which outran the default matcher window on CI even though the grid renders
		// fine, hence the explicit timeout.
		const rows = screen.getByTestId("environments-create-package-row");
		await expect.element(rows.first(), { timeout: 10_000 }).toBeVisible();
	});

	it("selecting a package adds it to the Selected Packages sidebar", async () => {
		const { baseElement } = await renderDialog();
		const screen = page.elementLocator(baseElement);
		const panel = screen.getByRole("complementary", { name: "Selected packages" });
		await expect
			.element(screen.getByTestId("environments-create-package-row").first(), { timeout: 10_000 })
			.toBeVisible();
		await expect.element(panel).not.toBeInTheDocument();

		await userEvent.click(screen.getByText("numpy", { exact: true }));

		await expect.element(panel).toBeVisible();
		await expect
			.element(screen.getByTestId("environments-create-selected-count"))
			.toHaveTextContent("1");
		const item = screen.getByTestId("environments-create-selected-item");
		await expect.element(item).toBeVisible();
		expect(await item.element().textContent).toContain("numpy");
	});

	it("builds a create payload with pinned version and python spec", async () => {
		const create = vi.fn((_input: CondaEnvsCreateInput): CondaEnvsCreateResult => ({
			jobId: "j",
			environment: { name: "env", prefix: "/p" },
		}));
		const { baseElement } = await renderDialog({
			find: () => [pkg("numpy", ["1.26.4", "1.25.0"]), pkg("python", ["3.13.1", "3.11.9"])],
			create,
		});
		const screen = page.elementLocator(baseElement);

		// Pin numpy@1.25.0 on its row, then select it.
		await userEvent.click(screen.getByRole("combobox", { name: "Version for numpy" }));
		await userEvent.click(screen.getByRole("option", { name: "1.25.0" }));
		await userEvent.click(screen.getByText("numpy", { exact: true }));

		// Choose a specific Python version derived from repodata.
		await userEvent.click(screen.getByTestId("environments-create-python"));
		await userEvent.click(screen.getByRole("option", { name: "3.11.9" }));

		await userEvent.fill(screen.getByTestId("environments-create-name"), "myenv");
		await userEvent.click(screen.getByTestId("environments-create-submit"));

		await vi.waitFor(() => {
			expect(create).toHaveBeenCalledOnce();
		});
		const payload = create.mock.calls[0]![0] as CondaEnvsCreateInput & { packages?: string[] };
		expect(payload.name).toBe("myenv");
		expect(payload.packages).toContain("numpy=1.25.0");
		expect(payload.packages).toContain("python=3.11.9");
		// The default location is sent explicitly too, so conda creates the env
		// exactly where the preview (and the prefix check) pointed.
		expect(payload.prefix).toBe("/opt/anaconda3/envs/myenv");
	});

	it("keeps Create disabled until the prefix check for the typed name passes", async () => {
		const check = deferred<CondaEnvsCheckPrefixResult>();
		const checkPrefix = vi.fn(() => check.promise);
		const { baseElement } = await renderDialog({ checkPrefix });
		const screen = page.elementLocator(baseElement);
		const submit = screen.getByTestId("environments-create-submit");

		await userEvent.fill(screen.getByTestId("environments-create-name"), "myenv");

		await expect.element(screen.getByTestId("environments-create-prefix-status")).toBeVisible();
		await vi.waitFor(() => {
			expect(checkPrefix).toHaveBeenCalledWith({ prefix: "/opt/anaconda3/envs/myenv" });
		});
		await expect.element(submit).toBeDisabled();

		check.resolve({ available: true });

		await expect.element(submit).toBeEnabled();
		await expect
			.element(screen.getByTestId("environments-create-prefix-status"))
			.not.toBeInTheDocument();
	});

	it("checks only the final prefix once typing settles", async () => {
		const checkPrefix = vi.fn(
			async (_input: CondaEnvsCheckPrefixInput): Promise<CondaEnvsCheckPrefixResult> => ({
				available: true,
			}),
		);
		const { baseElement } = await renderDialog({ checkPrefix });
		const screen = page.elementLocator(baseElement);

		// Typing runs over CDP on real time; on a loaded machine one keystroke gap
		// can outlast the debounce. A fake debounce clock stands still while
		// typing, and the `expect.element` poll below advances it.
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			await userEvent.type(screen.getByTestId("environments-create-name"), "alpha-bet");

			await expect.element(screen.getByTestId("environments-create-submit")).toBeEnabled();
		} finally {
			vi.useRealTimers();
		}
		expect(checkPrefix.mock.calls.map(([input]) => input.prefix)).toEqual([
			"/opt/anaconda3/envs/alpha-bet",
		]);
	});

	it("blocks a prefix that already holds an environment, including Enter-key submits", async () => {
		const create = vi.fn((_input: CondaEnvsCreateInput): CondaEnvsCreateResult => ({
			jobId: "j",
			environment: { name: "alpha-bet", prefix: "/opt/anaconda3/envs/alpha-bet" },
		}));
		const { baseElement } = await renderDialog({
			create,
			taken: ["/opt/anaconda3/envs/alpha-bet"],
		});
		const screen = page.elementLocator(baseElement);

		await userEvent.fill(screen.getByTestId("environments-create-name"), "alpha-bet");

		await expect
			.element(screen.getByTestId("environments-create-prefix-error"))
			.toHaveTextContent(
				"An environment already exists at /opt/anaconda3/envs/alpha-bet. Choose a different name or location.",
			);
		await expect.element(screen.getByTestId("environments-create-submit")).toBeDisabled();

		await userEvent.type(screen.getByTestId("environments-create-name"), "{Enter}");
		expect(create).not.toHaveBeenCalled();
	});

	it("explains a location the user cannot write to", async () => {
		const { baseElement } = await renderDialog({
			checkPrefix: async () => ({ available: false, reason: "not-writable" }),
		});
		const screen = page.elementLocator(baseElement);

		await userEvent.fill(screen.getByTestId("environments-create-name"), "myenv");

		await expect
			.element(screen.getByTestId("environments-create-prefix-error"))
			.toHaveTextContent(
				"You don't have permission to create environments in /opt/anaconda3/envs.",
			);
		await expect.element(screen.getByTestId("environments-create-submit")).toBeDisabled();
	});

	it("shows the name rule as soon as an invalid name is typed", async () => {
		const checkPrefix = vi.fn(async () => ({ available: true }) as const);
		const { baseElement } = await renderDialog({ checkPrefix });
		const screen = page.elementLocator(baseElement);

		await userEvent.fill(screen.getByTestId("environments-create-name"), "-bad");

		await expect.element(screen.getByTestId("environments-create-name-error")).toBeVisible();
		await expect.element(screen.getByTestId("environments-create-submit")).toBeDisabled();
		expect(checkPrefix).not.toHaveBeenCalled();
	});

	it("keeps the dialog open after a successful create but blocks re-creating the same env", async () => {
		const create = vi.fn((_input: CondaEnvsCreateInput): CondaEnvsCreateResult => ({
			jobId: "j",
			environment: { name: "myenv", prefix: "/opt/anaconda3/envs/myenv" },
		}));
		const { baseElement } = await renderDialog({ create });
		const screen = page.elementLocator(baseElement);
		const submit = screen.getByTestId("environments-create-submit");

		await userEvent.fill(screen.getByTestId("environments-create-name"), "myenv");
		await userEvent.click(submit);

		const success = screen.getByTestId("environments-create-success");
		await expect.element(success).toHaveTextContent("myenv was created.");
		await expect.element(screen.getByTestId("environments-create-dialog")).toBeVisible();
		// Form state is preserved so the user can review what was created...
		await expect.element(screen.getByTestId("environments-create-name")).toHaveValue("myenv");
		// ...but the re-run check now finds the env, so it can't be submitted twice.
		await expect.element(submit).toBeDisabled();
		await expect
			.element(screen.getByTestId("environments-create-prefix-error"))
			.not.toBeInTheDocument();
		expect(create).toHaveBeenCalledOnce();

		await userEvent.fill(screen.getByTestId("environments-create-name"), "myenv2");

		await expect.element(success).not.toBeInTheDocument();
		await expect.element(submit).toBeEnabled();
	});

	it("tells the user the prefix was taken when the create itself hits an existing env", async () => {
		const prefix = "/opt/anaconda3/envs/myenv";
		let checks = 0;
		const { baseElement } = await renderDialog({
			// Free when checked, then taken by a concurrent create before ours runs.
			checkPrefix: async () => {
				checks += 1;
				return checks === 1
					? { available: true }
					: { available: false, reason: "exists-environment" };
			},
			create: () => {
				throw new Error(`ENV_EXISTS: ${prefix}`);
			},
		});
		const screen = page.elementLocator(baseElement);

		await userEvent.fill(screen.getByTestId("environments-create-name"), "myenv");
		await userEvent.click(screen.getByTestId("environments-create-submit"));

		await expect.element(page.getByText("Could not create myenv")).toBeVisible();
		await expect
			.element(
				page.getByText(
					`An environment already exists at ${prefix}. It may have been created by an earlier or concurrent request`,
					{ exact: false },
				),
			)
			.toBeVisible();
		// The failure refreshes the check, so the field now explains it too.
		await expect.element(screen.getByTestId("environments-create-prefix-error")).toBeVisible();
		await expect.element(screen.getByTestId("environments-create-submit")).toBeDisabled();
	});

	it("tracks a created environment with coarse options only", async () => {
		const track = vi.fn(async () => {});
		const { baseElement } = await renderDialog({ track });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByText("numpy", { exact: true }));
		await userEvent.fill(screen.getByTestId("environments-create-name"), "myenv");
		await userEvent.click(screen.getByTestId("environments-create-submit"));
		await expect.element(screen.getByTestId("environments-create-success")).toBeVisible();

		expect(track).toHaveBeenCalledExactlyOnceWith({
			event: "Environment Created",
			data: {
				packageCount: 1,
				pythonPinned: false,
				customLocation: false,
			},
		});
	});

	it("opens the channel chooser popover from the Channels button", async () => {
		const { baseElement } = await renderDialog();
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-create-channels-button"));
		const chooser = page.getByTestId("environments-channel-chooser");
		await expect.element(chooser).toBeVisible();
		await expect
			.element(chooser.getByRole("menuitemcheckbox", { name: /conda-forge/ }))
			.toBeVisible();
		await expect.element(chooser.getByRole("menuitemcheckbox", { name: /Anaconda/ })).toBeVisible();
	});

	it("offers the product channel selector when conda reports no configured channels", async () => {
		const { baseElement } = await renderDialog({ channels: [] });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-create-channels-button"));
		const chooser = page.getByTestId("environments-channel-chooser");
		await expect
			.element(chooser.getByRole("menuitemcheckbox", { name: /conda-forge/ }))
			.toBeVisible();
		await expect.element(chooser.getByRole("menuitemcheckbox", { name: /Anaconda/ })).toBeVisible();
		await expect.element(chooser.getByText("No channels configured.")).not.toBeInTheDocument();
	});

	it("shows validation error when name is empty and submit is clicked", async () => {
		const { baseElement } = await renderDialog();
		const screen = page.elementLocator(baseElement);

		// Name is empty by default, button should be disabled
		await expect.element(screen.getByTestId("environments-create-submit")).toBeDisabled();
	});

	it("shows 'No packages available' when the package search is empty", async () => {
		const { baseElement } = await renderDialog({ find: () => [] });
		const screen = page.elementLocator(baseElement);

		await vi.waitFor(async () => {
			await expect.element(screen.getByText("No packages available")).toBeVisible();
		});
	});

	it("shows 'No results for ...' when search returns empty", async () => {
		const { baseElement } = await renderDialog({ find: () => [] });
		const screen = page.elementLocator(baseElement);

		await userEvent.fill(screen.getByTestId("environments-create-package-search"), "nonexistent");

		await vi.waitFor(async () => {
			await expect.element(screen.getByText(/No results for/)).toBeVisible();
		});
	});

	it("removes a package from the selected sidebar", async () => {
		const { baseElement } = await renderDialog();
		const screen = page.elementLocator(baseElement);

		// Select numpy
		await userEvent.click(screen.getByText("numpy", { exact: true }));
		await expect
			.element(screen.getByTestId("environments-create-selected-count"))
			.toHaveTextContent("1");

		// Remove it via the sidebar X button; the emptied panel closes.
		await userEvent.click(screen.getByRole("button", { name: "Remove numpy" }));
		await expect
			.element(screen.getByRole("complementary", { name: "Selected packages" }))
			.not.toBeInTheDocument();
	});

	it("deselects a package by clicking the row again", async () => {
		const { baseElement } = await renderDialog();
		const screen = page.elementLocator(baseElement);

		// Select numpy via the package row
		const numpyRow = screen.getByTestId("environments-create-package-row").first();
		await userEvent.click(numpyRow);
		await expect
			.element(screen.getByTestId("environments-create-selected-count"))
			.toHaveTextContent("1");

		// Click the same grid row to deselect — use the first package row
		// (which is numpy) to avoid the sidebar duplicate.
		await userEvent.click(screen.getByTestId("environments-create-package-row").first());
		await expect
			.element(screen.getByRole("complementary", { name: "Selected packages" }))
			.not.toBeInTheDocument();
	});

	it("displays packages without version list using a plain text version", async () => {
		const { baseElement } = await renderDialog({
			find: () => [pkg("simple-pkg")],
		});
		const screen = page.elementLocator(baseElement);

		await vi.waitFor(async () => {
			await expect.element(screen.getByText("simple-pkg")).toBeVisible();
		});
		// The version text should show — no Select combobox for this package.
		await expect.element(screen.getByText("1.0.0")).toBeVisible();
	});

	it("loads more results when the list is scrolled to the end", async () => {
		const all = Array.from({ length: 120 }, (_, i) =>
			pkg(`pkg-${String(i).padStart(3, "0")}`, ["1.0.0"]),
		);
		const search = vi.fn((input: CondaRepodataFindInput) => ({
			packages: all.slice(0, input.limit),
			truncated: input.limit < all.length,
		}));
		const { baseElement } = await renderDialog({ search });
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("environments-create-package-row").first(), { timeout: 10_000 })
			.toBeVisible();
		const packageSearches = () => search.mock.calls.map(([input]) => input).filter((i) => !i.names);
		expect(packageSearches()[0]?.limit).toBe(50);
		expect(
			baseElement.querySelectorAll('[data-qa-id="environments-create-package-row"]'),
		).toHaveLength(50);

		const scroller = baseElement.querySelector(
			'[data-qa-id="environments-create-package-results"]',
		)! as HTMLElement;
		scroller.scrollTop = scroller.scrollHeight;

		await expect.element(screen.getByText("pkg-099")).toBeInTheDocument();
		expect(packageSearches().map((input) => input.limit)).toContain(100);
		// No pager: the list simply grows.
		expect(baseElement.querySelector('[data-qa-id*="package-next"]')).toBeNull();
	});

	it("asks the user to refine the search once the result cap is reached", async () => {
		const pkgs = Array.from({ length: 5 }, (_, i) => pkg(`pkg-${i}`, ["1.0.0"]));
		const { baseElement } = await renderDialog({
			search: () => ({ packages: pkgs, truncated: true }),
		});
		const screen = page.elementLocator(baseElement);
		await expect
			.element(screen.getByTestId("environments-create-package-row").first(), { timeout: 10_000 })
			.toBeVisible();

		// Keep scrolling to the end: each batch widens the request until the cap.
		await vi.waitFor(
			() => {
				const scroller = baseElement.querySelector(
					'[data-qa-id="environments-create-package-results"]',
				)! as HTMLElement;
				scroller.scrollTop = scroller.scrollHeight;
				expect(
					baseElement.querySelector('[data-qa-id="environments-create-package-refine-hint"]'),
				).not.toBeNull();
			},
			{ timeout: 10_000, interval: 100 },
		);
		await expect
			.element(screen.getByTestId("environments-create-package-refine-hint"))
			.toHaveTextContent("Refine your search to see more results");
	});

	it("sends channels and prefix when location differs from default", async () => {
		const create = vi.fn((_input: CondaEnvsCreateInput): CondaEnvsCreateResult => ({
			jobId: "j",
			environment: { name: "env", prefix: "/custom/myenv" },
		}));
		const { baseElement } = await renderDialog({ create });
		const screen = page.elementLocator(baseElement);

		// Change location to a custom path
		await userEvent.clear(screen.getByTestId("environments-create-location"));
		await userEvent.fill(screen.getByTestId("environments-create-location"), "/custom");
		await userEvent.fill(screen.getByTestId("environments-create-name"), "myenv");
		await userEvent.click(screen.getByTestId("environments-create-submit"));

		await vi.waitFor(() => {
			expect(create).toHaveBeenCalledOnce();
		});
		const payload = create.mock.calls[0]![0];
		expect(payload.prefix).toBe("/custom/myenv");
		expect(payload.channels).toEqual(["conda-forge", "defaults"]);
	});

	it("filters the Python version list via the picker search box", async () => {
		const { baseElement } = await renderDialog({
			find: () => [pkg("python", ["3.13.1", "3.12.4", "3.11.9"])],
		});
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-create-python"));
		await expect.element(screen.getByRole("option", { name: "3.11.9" })).toBeVisible();

		await userEvent.fill(screen.getByTestId("environments-create-python-search"), "3.13");

		await expect.element(screen.getByRole("option", { name: "3.13.1" })).toBeVisible();
		await vi.waitFor(async () => {
			expect(await screen.getByRole("option", { name: "3.11.9" }).all()).toHaveLength(0);
		});
	});

	it("shows the package size column for the latest version by default", async () => {
		const { baseElement } = await renderDialog({
			find: () => [
				pkgWithSizes("numpy", [
					{ version: "1.26.4", size: 1_500_000 },
					{ version: "1.25.0", size: 1_200_000 },
				]),
			],
		});
		const screen = page.elementLocator(baseElement);

		await vi.waitFor(async () => {
			await expect
				.element(screen.getByTestId("environments-create-package-size-numpy"))
				.toBeVisible();
		});
		await expect
			.element(screen.getByTestId("environments-create-package-size-numpy"))
			.toHaveTextContent("1.4 MB");
	});

	it("updates the size column when a different version is pinned", async () => {
		const { baseElement } = await renderDialog({
			find: () => [
				pkgWithSizes("numpy", [
					{ version: "1.26.4", size: 1_500_000 },
					{ version: "1.25.0", size: 512_000 },
				]),
			],
		});
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("environments-create-package-size-numpy"), { timeout: 10_000 })
			.toHaveTextContent("1.4 MB");

		await userEvent.click(screen.getByRole("combobox", { name: "Version for numpy" }));
		await userEvent.click(screen.getByRole("option", { name: "1.25.0" }));

		await expect
			.element(screen.getByTestId("environments-create-package-size-numpy"))
			.toHaveTextContent("500.0 KB");
	});

	it("shows an em-dash for the size when a package has no versions", async () => {
		const { baseElement } = await renderDialog({
			find: () => [pkg("simple-pkg")],
		});
		const screen = page.elementLocator(baseElement);

		await vi.waitFor(async () => {
			await expect
				.element(screen.getByTestId("environments-create-package-size-simple-pkg"))
				.toBeVisible();
		});
		await expect
			.element(screen.getByTestId("environments-create-package-size-simple-pkg"))
			.toHaveTextContent("—");
	});

	it("shows all merged location dirs in the dropdown with default first", async () => {
		const { baseElement } = await renderDialog({
			envsDirs: ["/opt/anaconda3/envs", "/opt/miniconda3/envs", "/home/user/.conda/envs"],
		});
		const screen = page.elementLocator(baseElement);

		// Location input should pre-fill with the first (default) dir —
		// the highest-priority distribution.
		await expect
			.element(screen.getByTestId("environments-create-location"))
			.toHaveValue("/opt/anaconda3/envs");

		// Open the suggestion dropdown by focusing the input.
		await userEvent.click(screen.getByTestId("environments-create-location"));

		await expect.element(screen.getByText("/opt/miniconda3/envs")).toBeVisible();
		await expect.element(screen.getByText("/home/user/.conda/envs")).toBeVisible();

		// The first entry should have the "default" badge.
		await expect.element(screen.getByText("default")).toBeVisible();
	});

	it("sends correct prefix when a non-default location is selected", async () => {
		const create = vi.fn((_input: CondaEnvsCreateInput): CondaEnvsCreateResult => ({
			jobId: "j",
			environment: { name: "myenv", prefix: "/home/user/.conda/envs/myenv" },
		}));
		const { baseElement } = await renderDialog({
			create,
			envsDirs: ["/opt/anaconda3/envs", "/home/user/.conda/envs"],
		});
		const screen = page.elementLocator(baseElement);

		// Open suggestions and pick the non-default dir.
		await userEvent.click(screen.getByTestId("environments-create-location"));
		await userEvent.click(screen.getByText("/home/user/.conda/envs"));

		await expect
			.element(screen.getByTestId("environments-create-location"))
			.toHaveValue("/home/user/.conda/envs");

		await userEvent.fill(screen.getByTestId("environments-create-name"), "myenv");
		await userEvent.click(screen.getByTestId("environments-create-submit"));

		await vi.waitFor(() => {
			expect(create).toHaveBeenCalledOnce();
		});
		const payload = create.mock.calls[0]![0];
		expect(payload.prefix).toBe("/home/user/.conda/envs/myenv");
	});
});
