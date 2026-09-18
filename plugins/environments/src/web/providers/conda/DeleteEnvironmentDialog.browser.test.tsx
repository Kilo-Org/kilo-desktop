import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import {
	condaContract,
	type CondaEnv,
	type CondaEnvsDeleteInput,
	type CondaEnvsDeleteResult,
} from "../../../contracts/providers/conda.js";
import { DeleteEnvironmentDialog } from "./DeleteEnvironmentDialog.js";

function notImplemented(): never {
	throw new Error("not implemented");
}

function renderDialog(
	options: {
		env?: CondaEnv;
		deleteFn?: (input: CondaEnvsDeleteInput) => CondaEnvsDeleteResult;
		onClose?: () => void;
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

	const sdk = createFakeSdk({
		featureId: "environments",
		channels: condaContract,
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
	});
	const system = createFakeFeatureSystem({ sdks: { environments: sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	return render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<DeleteEnvironmentDialog env={env} open onClose={onClose} />
			</QueryClientProvider>
		</SdkProvider>,
	);
}

afterEach(cleanup);

describe("DeleteEnvironmentDialog", () => {
	it("renders the dialog with the environment name in the title", async () => {
		const { baseElement } = renderDialog();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-delete-dialog")).toBeVisible();
		await expect.element(screen.getByText("Delete myenv")).toBeVisible();
	});

	it("shows a warning that the action is irreversible", async () => {
		const { baseElement } = renderDialog();
		const screen = page.elementLocator(baseElement);

		await expect
			.element(
				screen.getByText(
					"This will permanently remove the environment and all its installed packages. This action cannot be undone.",
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
		const { baseElement } = renderDialog({ deleteFn, onClose });
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

	it("uses prefix basename for nameless envs in the title", async () => {
		const env: CondaEnv = { name: "", prefix: "/opt/anaconda3" };
		const { baseElement } = renderDialog({ env });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Delete anaconda3")).toBeVisible();
	});
});
