import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
	type CondaEnv,
	type CondaEnvsDeleteInput,
	type CondaEnvsDeleteResult,
} from "../../../contracts/providers/conda";
import { renderWithConda, type EnvironmentsHostOptions } from "../../../test/environments-host";
import { DeleteEnvironmentDialog } from "./DeleteEnvironmentDialog";

function notImplemented(): never {
	throw new Error("not implemented");
}

async function renderDialog(
	options: {
		env?: CondaEnv;
		deleteFn?: (input: CondaEnvsDeleteInput) => CondaEnvsDeleteResult;
		onClose?: () => void;
		track?: () => Promise<void>;
	} = {},
) {
	const env: CondaEnv = options.env ?? { name: "myenv", prefix: "/opt/anaconda3/envs/myenv" };
	const deleteFn: (input: CondaEnvsDeleteInput) => CondaEnvsDeleteResult =
		options.deleteFn ??
		(() => ({
			jobId: "job-1",
			name: "myenv",
		}));
	const onClose = options.onClose ?? (() => {});

	const hostOptions: EnvironmentsHostOptions = {
		handlers: {
			"conda.envs.list": notImplemented,
			"conda.envs.distributions": notImplemented,
			"conda.envs.create": notImplemented,
			"conda.envs.clone": notImplemented,
			"conda.envs.createFromFile": notImplemented,
			"conda.envs.delete": async (input: CondaEnvsDeleteInput) => deleteFn(input),
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
		...(options.track ? { track: options.track } : {}),
	};

	return renderWithConda(
		<>
			<DeleteEnvironmentDialog env={env} open onClose={onClose} />
		</>,
		hostOptions,
	);
}

afterEach(cleanup);

describe("DeleteEnvironmentDialog", () => {
	it("renders the dialog with the environment name in the title", async () => {
		const { baseElement } = await renderDialog();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-delete-dialog")).toBeVisible();
		await expect.element(screen.getByText("Delete myenv?")).toBeVisible();
	});

	it("shows a warning that the action is irreversible", async () => {
		const { baseElement } = await renderDialog();
		const screen = page.elementLocator(baseElement);

		await expect
			.element(
				screen.getByText(
					"This permanently removes the environment and all its installed packages. This action cannot be undone.",
				),
			)
			.toBeVisible();
	});

	it("closes immediately and fires the mutation on confirm", async () => {
		const deleteFn = vi.fn((_input: CondaEnvsDeleteInput): CondaEnvsDeleteResult => ({
			jobId: "j",
			name: "myenv",
		}));
		const onClose = vi.fn();
		const { baseElement } = await renderDialog({ deleteFn, onClose });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-delete-submit"));

		// Dialog closes immediately — no waiting for the mutation to finish.
		expect(onClose).toHaveBeenCalledOnce();

		await vi.waitFor(() => {
			expect(deleteFn).toHaveBeenCalledOnce();
		});
		expect(deleteFn).toHaveBeenCalledWith({
			name: "myenv",
			prefix: "/opt/anaconda3/envs/myenv",
		});
	});

	it("tracks a removal only once deletion succeeds", async () => {
		const track = vi.fn(async () => {});
		const { baseElement } = await renderDialog({ track });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-delete-submit"));

		await vi.waitFor(() =>
			expect(track).toHaveBeenCalledExactlyOnceWith({
				event: "Environment Removed",
				data: {},
			}),
		);
	});

	it("does not track a removal when deletion fails", async () => {
		const track = vi.fn(async () => {});
		const deleteFn = vi.fn((): CondaEnvsDeleteResult => {
			throw new Error("busy");
		});
		const { baseElement } = await renderDialog({ track, deleteFn });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-delete-submit"));
		await vi.waitFor(() => expect(deleteFn).toHaveBeenCalledOnce());
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(track).not.toHaveBeenCalled();
	});

	it("uses prefix basename for nameless envs in the title", async () => {
		const env: CondaEnv = { name: "", prefix: "/opt/anaconda3" };
		const { baseElement } = await renderDialog({ env });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Delete anaconda3?")).toBeVisible();
	});
});
