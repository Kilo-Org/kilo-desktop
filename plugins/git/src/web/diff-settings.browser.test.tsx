import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import {
	DEFAULT_DIFF_OPTIONS,
	DIFF_OPTIONS_STORAGE_KEY,
	DiffConfigProvider,
	useDiffOptions,
} from "./diff-options.js";
import {
	patchResponseStream,
	renderView,
	resetViewTestDom,
	stubFetch,
	waitForTreePath,
} from "./test-utils.js";

function DiffOptionsProbe() {
	const [opts, setOpt, setOpts] = useDiffOptions();
	return (
		<div>
			<div data-qa-id="probe-options">{JSON.stringify(opts)}</div>
			<button
				data-qa-id="probe-set-style"
				onClick={() => setOpt("diffStyle", "split")}
				type="button"
			>
				set style
			</button>
			<button
				data-qa-id="probe-set-batch"
				onClick={() => setOpts({ showBackgrounds: false, wrapLines: false })}
				type="button"
			>
				set batch
			</button>
			<button
				data-qa-id="probe-set-two"
				onClick={() => {
					setOpt("diffStyle", "split");
					setOpt("diffIndicators", "none");
				}}
				type="button"
			>
				set two
			</button>
		</div>
	);
}

function renderProbe() {
	render(
		<DiffConfigProvider>
			<DiffOptionsProbe />
		</DiffConfigProvider>,
	);
	return page.getByTestId("probe-options");
}

afterEach(resetViewTestDom);

describe("DiffConfigProvider", () => {
	it("provides the defaults when storage is empty", async () => {
		const options = renderProbe();
		await expect.element(options).toHaveTextContent(JSON.stringify(DEFAULT_DIFF_OPTIONS));
		expect(JSON.parse(localStorage.getItem(DIFF_OPTIONS_STORAGE_KEY)!)).toEqual(
			DEFAULT_DIFF_OPTIONS,
		);
	});

	it("setOpt updates the value and persists the whole object under git.diffOptions:v1", async () => {
		renderProbe();
		await page.getByTestId("probe-set-style").click();
		await expect
			.element(page.getByTestId("probe-options"))
			.toHaveTextContent(JSON.stringify({ ...DEFAULT_DIFF_OPTIONS, diffStyle: "split" }));
		expect(JSON.parse(localStorage.getItem(DIFF_OPTIONS_STORAGE_KEY)!)).toMatchObject({
			diffStyle: "split",
		});
	});

	it("setOpts merges several keys in one write", async () => {
		renderProbe();
		await page.getByTestId("probe-set-batch").click();
		await expect
			.element(page.getByTestId("probe-options"))
			.toHaveTextContent(
				JSON.stringify({ ...DEFAULT_DIFF_OPTIONS, showBackgrounds: false, wrapLines: false }),
			);
		expect(JSON.parse(localStorage.getItem(DIFF_OPTIONS_STORAGE_KEY)!)).toMatchObject({
			showBackgrounds: false,
			wrapLines: false,
		});
	});

	it("two setOpt calls in the same tick compose", async () => {
		renderProbe();
		await page.getByTestId("probe-set-two").click();
		await expect
			.element(page.getByTestId("probe-options"))
			.toHaveTextContent(
				JSON.stringify({ ...DEFAULT_DIFF_OPTIONS, diffStyle: "split", diffIndicators: "none" }),
			);
		expect(JSON.parse(localStorage.getItem(DIFF_OPTIONS_STORAGE_KEY)!)).toMatchObject({
			diffStyle: "split",
			diffIndicators: "none",
		});
	});

	it("sanitizes a garbage stored field on read", async () => {
		localStorage.setItem(DIFF_OPTIONS_STORAGE_KEY, JSON.stringify({ diffIndicators: "garbage" }));
		const options = renderProbe();
		await expect.element(options).toHaveTextContent(JSON.stringify(DEFAULT_DIFF_OPTIONS));
	});
});

describe("Diff settings menu", () => {
	it("toggles split/unified and persists the choice", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		await page.getByTestId("git-diff-settings").click();
		await expect.element(page.getByTestId("git-diff-settings-layout-split")).toBeVisible();
		await expect
			.element(page.getByTestId("git-diff-settings-layout-unified"))
			.toHaveAttribute("aria-checked", "true");
		await page.getByTestId("git-diff-settings-layout-split").click();
		expect(JSON.parse(localStorage.getItem("git.diffOptions:v1")!)).toMatchObject({
			diffStyle: "split",
		});
		/*
			Radio/checkbox menu items keep the dropdown open (Base UI
			closeOnClick=false), so assert on the still-open menu — a second
			trigger click would close it and race the exit-animation unmount.
		*/
		await expect
			.element(page.getByTestId("git-diff-settings-layout-split"))
			.toHaveAttribute("aria-checked", "true");
	});

	it("selects the indicators style and persists the choice", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		await page.getByTestId("git-diff-settings").click();
		await expect
			.element(page.getByTestId("git-diff-settings-indicators-bars"))
			.toHaveAttribute("aria-checked", "true");
		await page.getByTestId("git-diff-settings-indicators-classic").click();
		expect(JSON.parse(localStorage.getItem("git.diffOptions:v1")!)).toMatchObject({
			diffIndicators: "classic",
		});
		await expect
			.element(page.getByTestId("git-diff-settings-indicators-classic"))
			.toHaveAttribute("aria-checked", "true");
	});

	it("starts with the persisted indicators style selected", async () => {
		localStorage.setItem("git.diffOptions:v1", JSON.stringify({ diffIndicators: "none" }));
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		await page.getByTestId("git-diff-settings").click();
		await expect
			.element(page.getByTestId("git-diff-settings-indicators-none"))
			.toHaveAttribute("aria-checked", "true");
	});

	it("falls back to bars when the persisted indicators value is unrecognized", async () => {
		localStorage.setItem("git.diffOptions:v1", JSON.stringify({ diffIndicators: "garbage" }));
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		await page.getByTestId("git-diff-settings").click();
		await expect
			.element(page.getByTestId("git-diff-settings-indicators-bars"))
			.toHaveAttribute("aria-checked", "true");
	});

	it("toggles backgrounds off and persists the choice", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		await page.getByTestId("git-diff-settings").click();
		const backgrounds = page.getByTestId("git-diff-settings-backgrounds");
		await expect.element(backgrounds).toBeVisible();
		await expect.element(backgrounds).toHaveAttribute("aria-checked", "true");
		await backgrounds.click();
		expect(JSON.parse(localStorage.getItem("git.diffOptions:v1")!)).toMatchObject({
			showBackgrounds: false,
		});
		await expect.element(backgrounds).toHaveAttribute("aria-checked", "false");
	});

	it("starts with backgrounds off when the persisted choice is off", async () => {
		localStorage.setItem("git.diffOptions:v1", JSON.stringify({ showBackgrounds: false }));
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		await page.getByTestId("git-diff-settings").click();
		await expect
			.element(page.getByTestId("git-diff-settings-backgrounds"))
			.toHaveAttribute("aria-checked", "false");
	});

	it("toggles line numbers off and persists the choice", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		await page.getByTestId("git-diff-settings").click();
		const lineNumbers = page.getByTestId("git-diff-settings-line-numbers");
		await expect.element(lineNumbers).toBeVisible();
		await expect.element(lineNumbers).toHaveAttribute("aria-checked", "true");
		await lineNumbers.click();
		expect(JSON.parse(localStorage.getItem("git.diffOptions:v1")!)).toMatchObject({
			showLineNumbers: false,
		});
		await expect.element(lineNumbers).toHaveAttribute("aria-checked", "false");
	});

	it("starts with line numbers off when the persisted choice is off", async () => {
		localStorage.setItem("git.diffOptions:v1", JSON.stringify({ showLineNumbers: false }));
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		await page.getByTestId("git-diff-settings").click();
		await expect
			.element(page.getByTestId("git-diff-settings-line-numbers"))
			.toHaveAttribute("aria-checked", "false");
	});

	it("toggles wrap long lines off and persists the choice", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		await page.getByTestId("git-diff-settings").click();
		const wrap = page.getByTestId("git-diff-settings-wrap");
		await expect.element(wrap).toBeVisible();
		await expect.element(wrap).toHaveAttribute("aria-checked", "true");
		await wrap.click();
		expect(JSON.parse(localStorage.getItem("git.diffOptions:v1")!)).toMatchObject({
			wrapLines: false,
		});
		await expect.element(wrap).toHaveAttribute("aria-checked", "false");
	});

	it("starts with wrapping disabled when the persisted choice is scroll", async () => {
		localStorage.setItem("git.diffOptions:v1", JSON.stringify({ wrapLines: false }));
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		await page.getByTestId("git-diff-settings").click();
		await expect
			.element(page.getByTestId("git-diff-settings-wrap"))
			.toHaveAttribute("aria-checked", "false");
	});

	it("starts in split view when the persisted choice is split", async () => {
		localStorage.setItem("git.diffOptions:v1", JSON.stringify({ diffStyle: "split" }));
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		await page.getByTestId("git-diff-settings").click();
		await expect
			.element(page.getByTestId("git-diff-settings-layout-split"))
			.toHaveAttribute("aria-checked", "true");
		await expect
			.element(page.getByTestId("git-diff-settings-layout-unified"))
			.toHaveAttribute("aria-checked", "false");
	});
});
