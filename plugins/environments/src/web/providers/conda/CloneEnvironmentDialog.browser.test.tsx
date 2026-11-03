import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
	type CondaEnv,
	type CondaEnvsCloneInput,
	type CondaEnvsCloneResult,
} from "../../../contracts/providers/conda.js";
import { renderWithConda, type EnvironmentsHostOptions } from "../../../test/environments-host.js";
import { CloneEnvironmentDialog } from "./CloneEnvironmentDialog.js";

function notImplemented(): never {
	throw new Error("not implemented");
}

async function renderDialog(
	options: {
		env?: CondaEnv;
		clone?: (input: CondaEnvsCloneInput) => CondaEnvsCloneResult;
		onClose?: () => void;
	} = {},
) {
	const env: CondaEnv = options.env ?? { name: "myenv", prefix: "/opt/anaconda3/envs/myenv" };
	const clone: (input: CondaEnvsCloneInput) => CondaEnvsCloneResult =
		options.clone ??
		(() => ({
			jobId: "job-1",
			environment: { name: "myenv-copy", prefix: "/opt/anaconda3/envs/myenv-copy" },
		}));
	const onClose = options.onClose ?? (() => {});

	const hostOptions: EnvironmentsHostOptions = {
		handlers: {
			"conda.envs.list": notImplemented,
			"conda.envs.distributions": notImplemented,
			"conda.envs.create": notImplemented,
			"conda.envs.clone": async (input: CondaEnvsCloneInput) => clone(input),
			"conda.envs.createFromFile": notImplemented,
			"conda.envs.delete": notImplemented,
			"conda.envs.pickFile": notImplemented,
			"conda.envs.readFile": notImplemented,
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

	return renderWithConda(
		<>
			<CloneEnvironmentDialog env={env} open onClose={onClose} />
		</>,
		hostOptions,
	);
}

afterEach(cleanup);

describe("CloneEnvironmentDialog", () => {
	it("renders the dialog with the name pre-filled as env.name-copy", async () => {
		const { baseElement } = await renderDialog();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-clone-dialog")).toBeVisible();
		await expect.element(screen.getByTestId("environments-clone-name")).toHaveValue("myenv-copy");
	});

	it("submits the clone and calls onClose on success", async () => {
		const clone = vi.fn((_input: CondaEnvsCloneInput): CondaEnvsCloneResult => ({
			jobId: "j",
			environment: { name: "myenv-copy", prefix: "/p" },
		}));
		const onClose = vi.fn();
		const { baseElement } = await renderDialog({ clone, onClose });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-clone-submit"));

		await vi.waitFor(() => {
			expect(clone).toHaveBeenCalledOnce();
		});
		expect(clone).toHaveBeenCalledWith({
			sourceName: "myenv",
			sourcePrefix: "/opt/anaconda3/envs/myenv",
			name: "myenv-copy",
		});
		await vi.waitFor(() => {
			expect(onClose).toHaveBeenCalledOnce();
		});
	});

	it("shows validation error for empty name", async () => {
		const { baseElement } = await renderDialog();
		const screen = page.elementLocator(baseElement);

		await userEvent.clear(screen.getByTestId("environments-clone-name"));
		await userEvent.click(screen.getByTestId("environments-clone-submit"));

		await expect.element(screen.getByText("Name is required.")).toBeVisible();
	});

	it("shows validation error for invalid name", async () => {
		const { baseElement } = await renderDialog();
		const screen = page.elementLocator(baseElement);

		await userEvent.clear(screen.getByTestId("environments-clone-name"));
		await userEvent.fill(screen.getByTestId("environments-clone-name"), "has space");
		await userEvent.click(screen.getByTestId("environments-clone-submit"));

		await expect
			.element(
				screen.getByText(
					"Name must start with a letter or digit and contain only letters, digits, '.', '_', or '-'.",
				),
			)
			.toBeVisible();
	});

	it("shows server error when clone fails", async () => {
		const clone = () => {
			throw new Error("ENV_EXISTS: already exists");
		};
		const { baseElement } = await renderDialog({ clone });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-clone-submit"));

		await expect
			.element(
				screen.getByText(
					"An environment already exists at that location. Choose a different name or location.",
				),
			)
			.toBeVisible();
	});

	it("shows structural guard error when env.name is empty (prefix-only env)", async () => {
		const env: CondaEnv = { name: "", prefix: "/opt/anaconda3" };
		const { baseElement } = await renderDialog({ env });
		const screen = page.elementLocator(baseElement);

		// The pre-filled name uses the basename of the prefix when env.name is empty.
		await expect
			.element(screen.getByTestId("environments-clone-name"))
			.toHaveValue("anaconda3-copy");

		await userEvent.click(screen.getByTestId("environments-clone-submit"));

		await expect
			.element(screen.getByText("Cannot clone a prefix-only environment by name."))
			.toBeVisible();
	});
});
