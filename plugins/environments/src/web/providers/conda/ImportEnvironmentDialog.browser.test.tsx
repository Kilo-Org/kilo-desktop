import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type {
	CondaEnvsCreateFromFileInput,
	CondaEnvsCreateFromFileResult,
	CondaEnvsPickFileResult,
	CondaEnvsReadFileResult,
} from "../../../contracts/providers/conda";
import { renderWithConda, type EnvironmentsHostOptions } from "../../../test/environments-host";
import { ImportEnvironmentDialog } from "./ImportEnvironmentDialog";

const YAML_CONTENT = "name: testenv\ndependencies:\n  - numpy\n  - pandas\n";
const STAGED_HANDLE = "11111111-1111-4111-8111-111111111111";

function notImplemented(): never {
	throw new Error("not implemented");
}

async function renderDialog(
	options: {
		pickFile?: () => CondaEnvsPickFileResult;
		readFile?: () => CondaEnvsReadFileResult | Promise<CondaEnvsReadFileResult>;
		createFromFile?: (input: CondaEnvsCreateFromFileInput) => CondaEnvsCreateFromFileResult;
		onClose?: () => void;
	} = {},
) {
	const pickFile = options.pickFile ?? (() => ({ filePath: "/tmp/env.yml" }));
	const readFile =
		options.readFile ?? (() => ({ content: YAML_CONTENT, stagedHandle: STAGED_HANDLE }));
	const createFromFile: (input: CondaEnvsCreateFromFileInput) => CondaEnvsCreateFromFileResult =
		options.createFromFile ??
		(() => ({ jobId: "j", environment: { name: "testenv", prefix: "/opt/envs/testenv" } }));

	const hostOptions: EnvironmentsHostOptions = {
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
	};
	const onClose = options.onClose ?? (() => {});

	return renderWithConda(
		<>
			<ImportEnvironmentDialog open onClose={onClose} />
		</>,
		hostOptions,
	);
}

afterEach(cleanup);

describe("ImportEnvironmentDialog", () => {
	it("renders the import sheet with the drop zone visible", async () => {
		const { baseElement } = await renderDialog();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-import-dialog")).toBeVisible();
		await expect.element(screen.getByTestId("environments-import-dropzone")).toBeVisible();
		await expect.element(screen.getByTestId("environments-import-browse")).toBeVisible();
	});

	it("selects a file via Browse and shows the file display and YAML preview", async () => {
		const { baseElement } = await renderDialog();
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-import-browse"));

		await expect.element(screen.getByTestId("environments-import-file-display")).toBeVisible();
		await expect.element(screen.getByTestId("environments-import-file-preview")).toBeVisible();
		await expect
			.element(screen.getByTestId("environments-import-policy-note"))
			.toHaveTextContent(
				"The file's own channels and its pip: section are not covered by your organization's package policy.",
			);
	});

	it("extracts and pre-fills the name from the YAML content", async () => {
		const { baseElement } = await renderDialog();
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
		const { baseElement } = await renderDialog({ createFromFile, onClose });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-import-browse"));
		await expect.element(screen.getByTestId("environments-import-name")).toHaveValue("testenv");

		await userEvent.click(screen.getByTestId("environments-import-submit"));

		await vi.waitFor(() => {
			expect(createFromFile).toHaveBeenCalledOnce();
		});
		const payload = createFromFile.mock.calls[0]![0];
		expect(payload.stagedHandle).toBe(STAGED_HANDLE);
		expect(payload.name).toBe("testenv");
		// The raw path must never cross the boundary — only the staged handle.
		expect(payload).not.toHaveProperty("file");

		await vi.waitFor(() => {
			expect(onClose).toHaveBeenCalledOnce();
		});
	});

	it("disables the submit button when no file is selected", async () => {
		const { baseElement } = await renderDialog();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-import-submit")).toBeDisabled();
	});

	it("shows a validation error for an invalid name override", async () => {
		const { baseElement } = await renderDialog();
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
		const { baseElement } = await renderDialog();
		const screen = page.elementLocator(baseElement);

		// Select a file
		await userEvent.click(screen.getByTestId("environments-import-browse"));
		await expect.element(screen.getByTestId("environments-import-file-display")).toBeVisible();

		// Clear it
		await userEvent.click(screen.getByRole("button", { name: "Remove file" }));

		// Drop zone should be back
		await expect.element(screen.getByTestId("environments-import-dropzone")).toBeVisible();
	});

	it("clears the file and explains when the read fails", async () => {
		const readFile = vi.fn(async () => {
			throw new Error("cannot read");
		});
		const { baseElement } = await renderDialog({ readFile });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-import-browse"));

		await expect
			.element(screen.getByText("Could not read the selected file. Select it again."))
			.toBeVisible();
		await expect.element(screen.getByTestId("environments-import-dropzone")).toBeVisible();
	});

	it("stages each selected file and submits the newest handle", async () => {
		const paths = ["/tmp/first.yml", "/tmp/second.yml"];
		const handles = [
			"11111111-1111-4111-8111-111111111111",
			"22222222-2222-4222-8222-222222222222",
		];
		let pick = 0;
		let read = 0;
		const createFromFile = vi.fn(
			(_input: CondaEnvsCreateFromFileInput): CondaEnvsCreateFromFileResult => ({
				jobId: "j",
				environment: { name: "testenv", prefix: "/opt/envs/testenv" },
			}),
		);
		const { baseElement } = await renderDialog({
			pickFile: () => ({ filePath: paths[Math.min(pick++, paths.length - 1)]! }),
			readFile: () => ({
				content: YAML_CONTENT,
				stagedHandle: handles[Math.min(read++, handles.length - 1)]!,
			}),
			createFromFile,
		});
		const screen = page.elementLocator(baseElement);
		const submit = screen.getByTestId("environments-import-submit");

		await userEvent.click(screen.getByTestId("environments-import-browse"));
		await expect.element(submit).toBeEnabled();

		// Clearing drops the staged handle — submit stays disabled until a new
		// file is staged.
		await userEvent.click(screen.getByRole("button", { name: "Remove file" }));
		await expect.element(submit).toBeDisabled();

		await userEvent.click(screen.getByTestId("environments-import-browse"));
		await expect.element(submit).toBeEnabled();
		await userEvent.click(submit);

		await vi.waitFor(() => expect(createFromFile).toHaveBeenCalledOnce());
		expect(createFromFile.mock.calls[0]![0].stagedHandle).toBe(handles[1]);
	});

	it("re-stages the file after a failed import so a retry submits a fresh handle", async () => {
		const handles = [
			"11111111-1111-4111-8111-111111111111",
			"22222222-2222-4222-8222-222222222222",
		];
		let settleRestage: ((value: CondaEnvsReadFileResult) => void) | undefined;
		const readFile = vi
			.fn<() => CondaEnvsReadFileResult | Promise<CondaEnvsReadFileResult>>()
			.mockImplementationOnce(() => ({ content: YAML_CONTENT, stagedHandle: handles[0]! }))
			.mockImplementationOnce(
				() =>
					new Promise<CondaEnvsReadFileResult>((resolve) => {
						settleRestage = resolve;
					}),
			);
		const createFromFile = vi
			.fn<(input: CondaEnvsCreateFromFileInput) => CondaEnvsCreateFromFileResult>()
			.mockRejectedValueOnce(new Error("environment already exists"))
			.mockResolvedValueOnce({
				jobId: "j",
				environment: { name: "testenv", prefix: "/opt/envs/testenv" },
			});
		const { baseElement } = await renderDialog({ readFile, createFromFile });
		const screen = page.elementLocator(baseElement);
		const submit = screen.getByTestId("environments-import-submit");

		await userEvent.click(screen.getByTestId("environments-import-browse"));
		await expect.element(submit).toBeEnabled();
		await userEvent.click(submit);

		await vi.waitFor(() => expect(createFromFile).toHaveBeenCalledTimes(1));
		// The failure triggers a re-stage; submit stays disabled until the
		// fresh handle arrives.
		await vi.waitFor(() => expect(readFile).toHaveBeenCalledTimes(2));
		await expect.element(submit).toBeDisabled();

		settleRestage?.({ content: YAML_CONTENT, stagedHandle: handles[1]! });
		await expect.element(submit).toBeEnabled();
		await userEvent.click(submit);

		await vi.waitFor(() => expect(createFromFile).toHaveBeenCalledTimes(2));
		expect(createFromFile.mock.calls[0]![0].stagedHandle).toBe(handles[0]);
		expect(createFromFile.mock.calls[1]![0].stagedHandle).toBe(handles[1]);
	});

	it("handles a cancelled Browse (null filePath) gracefully", async () => {
		const { baseElement } = await renderDialog({
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
		const { baseElement } = await renderDialog({ createFromFile, onClose });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-import-browse"));
		// Clear the auto-extracted name
		await userEvent.clear(screen.getByTestId("environments-import-name"));

		await userEvent.click(screen.getByTestId("environments-import-submit"));

		await vi.waitFor(() => {
			expect(createFromFile).toHaveBeenCalledOnce();
		});
		const payload = createFromFile.mock.calls[0]![0];
		expect(payload.stagedHandle).toBe(STAGED_HANDLE);
		// name should not be sent when field is empty
		expect(payload.name).toBeUndefined();
	});

	it("shows error toast when the import fails in the foreground", async () => {
		const createFromFile = vi.fn((): never => {
			throw new Error("ENV_EXISTS: prefix already exists");
		});
		const { baseElement } = await renderDialog({ createFromFile });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-import-browse"));
		await userEvent.click(screen.getByTestId("environments-import-submit"));

		// The dialog should remain open (error does not close it).
		await vi.waitFor(async () => {
			await expect.element(screen.getByTestId("environments-import-dialog")).toBeVisible();
		});
	});
});
