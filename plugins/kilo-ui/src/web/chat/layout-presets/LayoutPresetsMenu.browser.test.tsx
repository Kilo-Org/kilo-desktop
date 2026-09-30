import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";
import { FeatureError } from "@kilo-desktop/feature-sdk";
import { Toaster } from "@kilo-desktop/ui/components/sonner";
import {
	layoutPresetsContract,
	type LayoutPreset,
	type LayoutPresetsService,
	type LayoutPresetsState,
	type LayoutTemplate,
} from "../../../contracts/layout-presets/schemas.js";
import { LayoutPresetsMenu } from "./LayoutPresetsMenu.js";

const template: LayoutTemplate = {
	version: 1,
	activePaneId: "chat",
	slots: [{ id: "chat", type: "chat" }],
	groups: [{ id: "chat-group", tabs: ["chat"], activePaneId: "chat", width: 640, pinned: false }],
	arrangement: "tiles",
};
const coding: LayoutPreset = { id: "coding", name: "Coding", template };

function renderMenu(
	options: {
		state?: LayoutPresetsState;
		handlers?: Partial<LayoutPresetsService>;
		omittedTitles?: string[];
	} = {},
) {
	let state = options.state ?? { presets: [], defaultPresetId: null };
	const handlers = {
		"layoutPresets.get": async () => state,
		"layoutPresets.save": async (input) => {
			const preset = { id: input.id ?? "saved", name: input.name, template: input.template };
			state = {
				presets: [...state.presets.filter((item) => item.id !== preset.id), preset],
				defaultPresetId: input.makeDefault ? preset.id : state.defaultPresetId,
			};
			return state;
		},
		"layoutPresets.setDefault": async ({ id }) => {
			state = { ...state, defaultPresetId: id };
			return state;
		},
		"layoutPresets.rename": async ({ id, name }) => {
			state = {
				...state,
				presets: state.presets.map((preset) => (preset.id === id ? { ...preset, name } : preset)),
			};
			return state;
		},
		"layoutPresets.remove": async ({ id }) => {
			state = {
				presets: state.presets.filter((preset) => preset.id !== id),
				defaultPresetId: state.defaultPresetId === id ? null : state.defaultPresetId,
			};
			return state;
		},
		...options.handlers,
	} satisfies Partial<LayoutPresetsService>;
	const track = vi.fn(async () => {});
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		channels: layoutPresetsContract,
		handlers,
		telemetry: { track },
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const onApply = vi.fn();
	const capture = vi.fn(() => ({ template, omittedTitles: options.omittedTitles ?? [] }));
	const view = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<LayoutPresetsMenu capture={capture} onApply={onApply} />
				<Toaster />
			</QueryClientProvider>
		</SdkProvider>,
	);
	return { screen: page.elementLocator(view.baseElement), onApply, capture, sdk, track };
}

function tracked(track: ReturnType<typeof renderMenu>["track"]) {
	return (
		track.mock.calls as unknown as Array<[{ event: string; data: Record<string, unknown> }]>
	).map(([input]) => {
		const { featureId: _featureId, ...data } = input.data;
		return { event: input.event, data };
	});
}

afterEach(cleanup);

describe("LayoutPresetsMenu", () => {
	it("uses concise copy when no layouts have been saved", async () => {
		const { screen } = renderMenu();
		await screen.getByTestId("chat-layouts-menu").click();
		await expect.element(screen.getByText("No layouts yet")).toBeVisible();
	});

	it("tracks saving, default changes, and removal of layout presets", async () => {
		const { screen, track } = renderMenu();
		await screen.getByTestId("chat-layouts-menu").click();
		await screen.getByTestId("chat-layout-save-current").click();
		await screen.getByTestId("chat-layout-name").fill("Research");
		await screen.getByTestId("chat-layout-save").click();
		await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();

		await screen.getByTestId("chat-layouts-menu").click();
		await screen.getByTestId("chat-layout-manage").click();
		await screen.getByTestId("chat-layout-set-default-saved").click();
		await expect
			.element(screen.getByTestId("chat-layout-set-default-saved"))
			.toHaveAttribute("aria-pressed", "true");
		await screen.getByTestId("chat-layout-delete-saved").click();
		await screen.getByTestId("chat-layout-delete-confirm").click();

		await expect
			.poll(() => tracked(track))
			.toEqual([
				{
					event: "Layout Preset Saved",
					data: { isUpdate: false, makeDefault: false, paneCount: 1 },
				},
				{ event: "Layout Preset Default Changed", data: { cleared: false } },
				{ event: "Layout Preset Removed", data: {} },
			]);
	});

	it("saves the current layout with omissions disclosed, marks it default, and applies it", async () => {
		const { screen, onApply } = renderMenu({ omittedTitles: ["Notebook analysis"] });
		await screen.getByTestId("chat-layouts-menu").click();
		await screen.getByTestId("chat-layout-save-current").click();
		await expect.element(screen.getByText(/Notebook analysis/)).toBeVisible();
		await expect.element(screen.getByTestId("chat-layout-save")).toBeDisabled();
		await screen.getByTestId("chat-layout-name").fill("Research");
		await screen.getByTestId("chat-layout-default").click();
		await screen.getByTestId("chat-layout-save").click();
		await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
		await screen.getByTestId("chat-layouts-menu").click();
		await expect
			.element(screen.getByTestId("chat-layout-apply-saved").getByText("Default"))
			.toBeVisible();
		await screen.getByTestId("chat-layout-apply-saved").click();
		expect(onApply).toHaveBeenCalledWith({ id: "saved", name: "Research", template });
	});

	it("manages the default independently from applying or renaming a saved layout", async () => {
		const { screen, onApply, capture } = renderMenu({
			state: {
				presets: [coding, { ...coding, id: "research", name: "Research" }],
				defaultPresetId: null,
			},
		});
		await screen.getByTestId("chat-layouts-menu").click();
		await screen.getByTestId("chat-layout-manage").click();
		const codingStar = screen.getByTestId("chat-layout-set-default-coding");
		const researchStar = screen.getByTestId("chat-layout-set-default-research");
		await codingStar.click();
		await expect.element(codingStar).toHaveAttribute("aria-pressed", "true");
		await codingStar.click();
		await expect.element(codingStar).toHaveAttribute("aria-pressed", "false");
		await codingStar.click();
		await researchStar.click();
		await expect.element(researchStar).toHaveAttribute("aria-pressed", "true");
		await expect.element(codingStar).toHaveAttribute("aria-pressed", "false");
		await screen.getByRole("button", { name: "Rename Coding" }).click();
		await expect.element(screen.getByRole("dialog", { name: "Manage layouts" })).toBeVisible();
		await screen.getByTestId("chat-layout-name").fill("Review");
		await screen.getByRole("button", { name: "Save name" }).click();
		await expect.element(screen.getByRole("button", { name: "Rename Review" })).toBeVisible();
		await screen.getByRole("button", { name: "Rename Review" }).click();
		await screen.getByTestId("chat-layout-name").fill("Discarded");
		await userEvent.keyboard("{Escape}");
		await expect.element(screen.getByRole("dialog", { name: "Manage layouts" })).toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Rename Review" })).toBeVisible();
		expect(onApply).not.toHaveBeenCalled();
		expect(capture).not.toHaveBeenCalled();
	});

	it("clears the default when the only layout's selected star is clicked", async () => {
		const { screen } = renderMenu({ state: { presets: [coding], defaultPresetId: "coding" } });
		await screen.getByTestId("chat-layouts-menu").click();
		await screen.getByTestId("chat-layout-manage").click();
		await screen.getByRole("button", { name: "Clear default layout" }).click();
		await expect
			.element(screen.getByRole("button", { name: "Set Coding as default" }))
			.toHaveAttribute("aria-pressed", "false");
		await screen.getByRole("button", { name: "Done", exact: true }).click();
		await screen.getByTestId("chat-layouts-menu").click();
		await expect
			.element(screen.getByTestId("chat-layout-apply-coding").getByText("Default"))
			.not.toBeInTheDocument();
	});

	it("updates geometry only after explicit confirmation and confirms deletion", async () => {
		const updatedTemplate: LayoutTemplate = { ...template, arrangement: "carousel" };
		const { screen, capture, onApply } = renderMenu({
			state: { presets: [coding], defaultPresetId: "coding" },
			omittedTitles: ["Scratch notebook"],
		});
		capture.mockReturnValue({ template: updatedTemplate, omittedTitles: ["Scratch notebook"] });
		await screen.getByTestId("chat-layouts-menu").click();
		await screen.getByTestId("chat-layout-manage").click();
		await screen.getByRole("button", { name: "Update Coding from current layout" }).click();
		await expect.element(screen.getByText(/Scratch notebook/)).toBeVisible();
		await screen.getByRole("button", { name: "Update layout", exact: true }).click();
		await screen.getByRole("button", { name: "Done", exact: true }).click();
		await screen.getByTestId("chat-layouts-menu").click();
		await expect
			.element(screen.getByTestId("chat-layout-apply-coding").getByText("Default"))
			.toBeVisible();
		await screen.getByTestId("chat-layout-apply-coding").click();
		expect(onApply).toHaveBeenCalledWith({ ...coding, template: updatedTemplate });
		await screen.getByTestId("chat-layouts-menu").click();
		await screen.getByTestId("chat-layout-manage").click();
		await screen.getByRole("button", { name: "Delete Coding", exact: true }).click();
		await expect.element(screen.getByRole("alertdialog")).toBeVisible();
		await screen.getByRole("button", { name: "Cancel" }).click();
		await expect.element(screen.getByRole("button", { name: "Rename Coding" })).toBeVisible();
		await screen.getByRole("button", { name: "Delete Coding", exact: true }).click();
		await screen.getByRole("button", { name: "Delete layout", exact: true }).click();
		await expect.element(screen.getByText("No layouts yet")).toBeVisible();
	});

	it("shows loading and query failures, then refreshes saved layouts after retry and change events", async () => {
		let rejectLoading!: (reason: Error) => void;
		const loading = new Promise<LayoutPresetsState>((_resolve, reject) => {
			rejectLoading = reject;
		});
		const get = vi
			.fn<LayoutPresetsService["layoutPresets.get"]>()
			.mockReturnValueOnce(loading)
			.mockResolvedValue({ presets: [coding], defaultPresetId: null });
		const { screen, sdk } = renderMenu({ handlers: { "layoutPresets.get": get } });
		await screen.getByTestId("chat-layouts-menu").click();
		await expect.element(screen.getByText("Loading layouts...")).toBeVisible();
		rejectLoading(new FeatureError("Layouts unavailable"));
		await expect.element(screen.getByText("Layouts unavailable")).toBeVisible();
		await screen.getByRole("menuitem", { name: "Retry loading layouts" }).click();
		await screen.getByTestId("chat-layouts-menu").click();
		await expect.element(screen.getByTestId("chat-layout-apply-coding")).toBeVisible();
		get.mockResolvedValue({
			presets: [{ ...coding, name: "Updated elsewhere" }],
			defaultPresetId: "coding",
		});
		sdk.events.emit("layout-presets-changed", undefined);
		await expect
			.element(screen.getByRole("menuitem", { name: "Apply Updated elsewhere" }))
			.toBeVisible();
	});

	it("keeps a failed save editable, blocks duplicate submissions while pending, and allows retry", async () => {
		let rejectSaving!: (reason: Error) => void;
		const saving = new Promise<LayoutPresetsState>((_resolve, reject) => {
			rejectSaving = reject;
		});
		const save = vi
			.fn<LayoutPresetsService["layoutPresets.save"]>()
			.mockReturnValueOnce(saving)
			.mockResolvedValue({ presets: [coding], defaultPresetId: null });
		const { screen } = renderMenu({ handlers: { "layoutPresets.save": save } });
		await screen.getByTestId("chat-layouts-menu").click();
		await screen.getByTestId("chat-layout-save-current").click();
		await screen.getByTestId("chat-layout-name").fill("Coding");
		await screen.getByTestId("chat-layout-save").click();
		await expect.element(screen.getByTestId("chat-layout-save")).toBeDisabled();
		await expect.element(screen.getByTestId("chat-layout-name")).toBeDisabled();
		rejectSaving(new FeatureError("Could not write layouts"));
		await expect.element(screen.getByText("Could not write layouts")).toBeVisible();
		await expect.element(screen.getByTestId("chat-layout-name")).toHaveValue("Coding");
		await screen.getByTestId("chat-layout-save").click();
		await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
		expect(save).toHaveBeenCalledTimes(2);
	});

	it("does not save an empty layout when every current pane is unsupported", async () => {
		const { screen, capture } = renderMenu();
		capture.mockReturnValue({
			template: { ...template, slots: [], groups: [] },
			omittedTitles: ["Notebook"],
		});
		await screen.getByTestId("chat-layouts-menu").click();
		await screen.getByTestId("chat-layout-save-current").click();
		await expect
			.element(
				screen.getByText(
					"No reusable panes to save. Open Chat, Changes, Terminal, or Files first.",
				),
			)
			.toBeVisible();
		await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
	});

	it("reports capture and apply failures without losing the saved layouts", async () => {
		const { screen, capture, onApply } = renderMenu({
			state: { presets: [coding], defaultPresetId: null },
		});
		capture.mockImplementationOnce(() => {
			throw new Error("Layout is unavailable");
		});
		await screen.getByTestId("chat-layouts-menu").click();
		await screen.getByTestId("chat-layout-save-current").click();
		await expect.element(screen.getByText("Layout is unavailable")).toBeVisible();
		onApply.mockImplementationOnce(() => {
			throw new Error("Could not apply layout");
		});
		await screen.getByTestId("chat-layouts-menu").click();
		await screen.getByTestId("chat-layout-apply-coding").click();
		await expect.element(screen.getByText("Could not apply layout")).toBeVisible();
		await screen.getByTestId("chat-layouts-menu").click();
		await screen.getByTestId("chat-layout-apply-coding").click();
		await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
	});
});
