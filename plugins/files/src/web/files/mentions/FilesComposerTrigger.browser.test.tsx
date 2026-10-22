import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { filesContract, type FilesServiceContract } from "../../../contracts/schemas.js";
import { FilesComposerTrigger, type TriggerPopoverProps } from "./FilesComposerTrigger.js";

afterEach(cleanup);

it("offers files from every workspace folder", async () => {
	const list = vi.fn<FilesServiceContract["list"]>(async ({ workspaceDirectory }) => ({
		paths: [workspaceDirectory.endsWith("app") ? "src/App.tsx" : "docs/Guide.md"],
		truncated: false,
	}));
	const handlers: FilesServiceContract = {
		list,
		existingPaths: async ({ relativePaths }) => ({ paths: relativePaths }),
		resolveFileLink: async () => ({ kind: "none", paths: [], truncated: false }),
		read: async () => ({ kind: "unsupported", reason: "binary", byteLength: 0 }),
		listExternalEditors: async () => ({ editors: [] }),
		openExternalEditor: async () => ({ opened: true }),
		write: async () => ({ status: "saved", revision: "a".repeat(64) }),
		gitStatus: async () => null,
	};
	const sdk = createFakeSdk({
		featureId: "files",
		channels: filesContract,
		handlers,
	});
	const system = createFakeFeatureSystem({ sdks: { files: sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	let triggerProps: TriggerPopoverProps | undefined;
	const TriggerPopover = (props: TriggerPopoverProps) => {
		triggerProps = props;
		return null;
	};

	render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<FilesComposerTrigger
					workspaceDirectory="/projects/app"
					workspaceFolders={[
						{ path: "/projects/app", isPrimary: true },
						{ path: "/projects/reference", isPrimary: false },
					]}
					TriggerPopover={TriggerPopover}
				/>
			</QueryClientProvider>
		</SdkProvider>,
	);

	await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
	await vi.waitFor(() =>
		expect(triggerProps?.adapter?.categoryItems("")).toEqual([
			{
				id: "/projects/app/src/App.tsx",
				type: "file",
				label: "App.tsx",
				description: "app/src/App.tsx",
				metadata: { icon: "file" },
			},
			{
				id: "/projects/reference/docs/Guide.md",
				type: "file",
				label: "Guide.md",
				description: "reference/docs/Guide.md",
				metadata: { icon: "file" },
			},
		]),
	);
});
