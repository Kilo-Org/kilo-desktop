import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import type {
	CondaEnvsCreateFromFileInput,
	CondaEnvsCreateFromFileResult,
	CondaEnvsPickFileResult,
	CondaEnvsReadFileResult,
} from "../../../contracts/providers/conda.js";
import { condaContract } from "../../../contracts/providers/conda.js";
import { ImportEnvironmentDialog } from "./ImportEnvironmentDialog.js";

const YAML_CONTENT = "name: testenv\ndependencies:\n  - numpy\n  - pandas\n";

function notImplemented(): never {
	throw new Error("not implemented");
}

function renderDialog(
	options: {
		pickFile?: () => CondaEnvsPickFileResult;
		readFile?: () => CondaEnvsReadFileResult;
		createFromFile?: (input: CondaEnvsCreateFromFileInput) => CondaEnvsCreateFromFileResult;
		onClose?: () => void;
	} = {},
) {
	const pickFile = options.pickFile ?? (() => ({ filePath: "/tmp/env.yml" }));
	const readFile = options.readFile ?? (() => ({ content: YAML_CONTENT }));
	const createFromFile: (input: CondaEnvsCreateFromFileInput) => CondaEnvsCreateFromFileResult =
		options.createFromFile ??
		(() => ({ jobId: "j", environment: { name: "testenv", prefix: "/opt/envs/testenv" } }));

	const sdk = createFakeSdk({
		featureId: "environments",
		channels: condaContract,
		handlers: {
			"conda.envs.list": async () => [],
			"conda.envs.distributions": notImplemented,
			"conda.envs.create": notImplemented,
			"conda.envs.clone": notImplemented,
			"conda.envs.createFromFile": async (input: CondaEnvsCreateFromFileInput) =>
				createFromFile(input),
			"conda.envs.delete": notImplemented,
			"conda.envs.pickFile": async () => pickFile(),
			"conda.envs.readFile": async () => readFile(),
			"conda.envs.prefixOptions": notImplemented,
			"conda.packages.list": notImplemented,
			"conda.packages.install": notImplemented,
			"conda.packages.remove": notImplemented,
			"conda.channels.list": notImplemented,
			"conda.channels.add": notImplemented,
			"conda.channels.remove": notImplemented,
			"conda.repodata.find": notImplemented,
			"conda.jobs.cancel": notImplemented,
		},
	});
	const system = createFakeFeatureSystem({ sdks: { environments: sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const onClose = options.onClose ?? (() => {});

	return render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<ImportEnvironmentDialog open onClose={onClose} />
			</QueryClientProvider>
		</SdkProvider>,
	);
}

afterEach(cleanup);

describe("ImportEnvironmentDialog", () => {
	it("renders the import sheet with the drop zone visible", async () => {
		const { baseElement } = renderDialog();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-import-dialog")).toBeVisible();
		await expect.element(screen.getByTestId("environments-import-dropzone")).toBeVisible();
		await expect.element(screen.getByTestId("environments-import-browse")).toBeVisible();
	});

	it("selects a file via Browse and shows the file display and YAML preview", async () => {
		const { baseElement } = renderDialog();
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-import-browse"));

		await expect.element(screen.getByTestId("environments-import-file-display")).toBeVisible();
		await expect.element(screen.getByTestId("environments-import-file-preview")).toBeVisible();
	});

	it("extracts and pre-fills the name from the YAML content", async () => {
		const { baseElement } = renderDialog();
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-import-browse"));

		await expect.element(screen.getByTestId("environments-import-name")).toHaveValue("testenv");
	});

	it("submits the import and calls onClose on success", async () => {
		const createFromFile = vi.fn(
			(_input: CondaEnvsCreateFromFileInput): CondaEnvsCreateFromFileResult => ({
				jobId: "j",
				environment: { name: "testenv", prefix: "/opt/envs/testenv" },
			}),
		);
		const onClose = vi.fn();
		const { baseElement } = renderDialog({ createFromFile, onClose });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-import-browse"));
		await expect.element(screen.getByTestId("environments-import-name")).toHaveValue("testenv");

		await userEvent.click(screen.getByTestId("environments-import-submit"));

		await vi.waitFor(() => {
			expect(createFromFile).toHaveBeenCalledOnce();
		});
		const payload = createFromFile.mock.calls[0]![0];
		expect(payload.file).toBe("/tmp/env.yml");
		expect(payload.name).toBe("testenv");

		await vi.waitFor(() => {
			expect(onClose).toHaveBeenCalledOnce();
		});
	});

	it("disables the submit button when no file is selected", async () => {
		const { baseElement } = renderDialog();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-import-submit")).toBeDisabled();
	});

	it("shows a validation error for an invalid name override", async () => {
		const { baseElement } = renderDialog();
		const screen = page.elementLocator(baseElement);

		// Select a file first so the file-required validation passes.
		await userEvent.click(screen.getByTestId("environments-import-browse"));
		await expect.element(screen.getByTestId("environments-import-file-display")).toBeVisible();

		// Enter an invalid name (starts with a dash).
		await userEvent.clear(screen.getByTestId("environments-import-name"));
		await userEvent.fill(screen.getByTestId("environments-import-name"), "-bad-name");

		await userEvent.click(screen.getByTestId("environments-import-submit"));

		await expect
			.element(
				screen.getByText(
					"Name must start with a letter or digit and contain only letters, digits, '.', '_', or '-'.",
				),
			)
			.toBeVisible();
	});

	it("clears the selected file when the remove button is clicked", async () => {
		const { baseElement } = renderDialog();
		const screen = page.elementLocator(baseElement);

		// Select a file
		await userEvent.click(screen.getByTestId("environments-import-browse"));
		await expect.element(screen.getByTestId("environments-import-file-display")).toBeVisible();

		// Clear it
		await userEvent.click(screen.getByRole("button", { name: "Remove file" }));

		// Drop zone should be back
		await expect.element(screen.getByTestId("environments-import-dropzone")).toBeVisible();
	});

	it("handles a cancelled Browse (null filePath) gracefully", async () => {
		const { baseElement } = renderDialog({
			pickFile: () => ({ filePath: null }),
		});
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-import-browse"));

		// Drop zone should still be shown since no file was selected.
		await expect.element(screen.getByTestId("environments-import-dropzone")).toBeVisible();
	});

	it("submits without name override when the field is empty", async () => {
		const createFromFile = vi.fn(
			(_input: CondaEnvsCreateFromFileInput): CondaEnvsCreateFromFileResult => ({
				jobId: "j",
				environment: { name: "testenv", prefix: "/opt/envs/testenv" },
			}),
		);
		const onClose = vi.fn();
		const { baseElement } = renderDialog({ createFromFile, onClose });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-import-browse"));
		// Clear the auto-extracted name
		await userEvent.clear(screen.getByTestId("environments-import-name"));

		await userEvent.click(screen.getByTestId("environments-import-submit"));

		await vi.waitFor(() => {
			expect(createFromFile).toHaveBeenCalledOnce();
		});
		const payload = createFromFile.mock.calls[0]![0];
		expect(payload.file).toBe("/tmp/env.yml");
		// name should not be sent when field is empty
		expect(payload.name).toBeUndefined();
	});

	it("shows error toast when the import fails in the foreground", async () => {
		const createFromFile = vi.fn((): never => {
			throw new Error("[BUSINESS] ENV_EXISTS: prefix already exists");
		});
		const { baseElement } = renderDialog({ createFromFile });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-import-browse"));
		await userEvent.click(screen.getByTestId("environments-import-submit"));

		// The dialog should remain open (error does not close it).
		await vi.waitFor(async () => {
			await expect.element(screen.getByTestId("environments-import-dialog")).toBeVisible();
		});
	});
});
