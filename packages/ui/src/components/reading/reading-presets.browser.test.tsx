import { useState } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
	EMPTY_READING_PRESETS,
	activeReadingPreset,
	hasUnsavedReadingChanges,
	presetNameTaken,
	type ReadingPreset,
	type ReadingPresetsState,
} from "@kilo-desktop/ui/lib/reading/presets";
import {
	DEFAULT_READING_SETTINGS,
	normalizeReadingSettings,
	type ReadingSettings,
	type ReadingSettingsPatch,
} from "@kilo-desktop/ui/lib/reading/settings";

import { ReadingControl } from "./reading-control";
import type { ReadingPresetsControl } from "./reading-presets";

const LATE_NIGHT: ReadingSettings = {
	themeId: "gruvbox",
	mode: "dark",
	textSizeStep: 2,
	lineSpacing: 2,
	focus: { movesWith: "scroll", dimming: 60 },
};

/** The Aa control over in-memory presets that behave like kilo.shell/reading-presets. */
function Harness({
	initialSettings = DEFAULT_READING_SETTINGS,
	initialPresets = EMPTY_READING_PRESETS,
	saveError,
}: {
	initialSettings?: ReadingSettings;
	initialPresets?: ReadingPresetsState;
	saveError?: string;
}) {
	const [settings, setSettings] = useState(initialSettings);
	const [state, setState] = useState(initialPresets);
	const presets: ReadingPresetsControl = {
		state,
		unsaved: hasUnsavedReadingChanges(settings, state),
		apply: async (id) => {
			const preset = state.presets.find((entry) => entry.id === id);
			setSettings(preset ? preset.settings : DEFAULT_READING_SETTINGS);
			setState({ ...state, activeId: preset ? preset.id : null });
		},
		save: async (name, makeDefault) => {
			if (saveError) throw new Error(saveError);
			if (presetNameTaken(state.presets, name)) throw new Error("Name taken in main.");
			const preset: ReadingPreset = { id: `p${state.presets.length + 1}`, name, settings };
			setState({
				presets: [...state.presets, preset],
				activeId: preset.id,
				defaultId: makeDefault ? preset.id : state.defaultId,
			});
		},
		update: async (id) =>
			setState({
				...state,
				activeId: id,
				presets: state.presets.map((preset) =>
					preset.id === id ? { ...preset, settings } : preset,
				),
			}),
		rename: async (id, name) =>
			setState({
				...state,
				presets: state.presets.map((preset) => (preset.id === id ? { ...preset, name } : preset)),
			}),
		remove: async (id) =>
			setState({
				presets: state.presets.filter((preset) => preset.id !== id),
				activeId: state.activeId === id ? null : state.activeId,
				defaultId: state.defaultId === id ? null : state.defaultId,
			}),
		setDefault: async (id) => setState({ ...state, defaultId: id }),
	};
	const change = (patch: ReadingSettingsPatch) =>
		setSettings(
			normalizeReadingSettings({
				...settings,
				...patch,
				focus: { ...settings.focus, ...patch.focus },
			}),
		);
	const active = activeReadingPreset(state);
	return (
		<div style={{ padding: "460px 0 0 320px" }}>
			<ReadingControl
				settings={settings}
				onChange={change}
				onReset={() => setSettings(active ? active.settings : DEFAULT_READING_SETTINGS)}
				appTheme={{ themeId: "kilo", mode: "dark" }}
				baseSize={14}
				inFocus={false}
				focusOn={false}
				onFocusChange={() => {}}
				footnote=""
				presets={presets}
			/>
		</div>
	);
}

const twoPresets: ReadingPresetsState = {
	presets: [
		{ id: "day", name: "Daytime", settings: DEFAULT_READING_SETTINGS },
		{ id: "night", name: "Late night", settings: LATE_NIGHT },
	],
	activeId: "night",
	defaultId: "night",
};

const openPanel = () => page.getByTestId("reading-trigger").click();
const presetsTrigger = () => page.getByTestId("reading-presets-trigger");

afterEach(cleanup);

describe("ReadingControl presets", () => {
	it("starts with a disabled empty row and no Save… until something changes", async () => {
		render(<Harness />);
		await openPanel();

		await expect.element(presetsTrigger()).toHaveTextContent("Presets");
		await expect.element(page.getByTestId("reading-preset-save")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("reading-presets-unsaved")).not.toBeInTheDocument();
		await presetsTrigger().click();
		await expect
			.element(page.getByRole("menuitem", { name: "No reading presets yet" }))
			.toHaveAttribute("aria-disabled", "true");
		await userEvent.keyboard("{Escape}");

		await page.getByRole("radio", { name: "Gruvbox" }).click();

		await expect.element(page.getByTestId("reading-presets-unsaved")).toBeInTheDocument();
		await expect.element(page.getByTestId("reading-preset-save")).toHaveTextContent("Save…");
	});

	it("saves the current settings under a name, then names the preset in the header", async () => {
		render(<Harness />);
		await openPanel();
		await page.getByRole("radio", { name: "Gruvbox" }).click();
		await page.getByRole("button", { name: "Larger text" }).click();
		await page.getByRole("button", { name: "Larger text" }).click();

		await page.getByTestId("reading-preset-save").click();

		const dialog = page.getByTestId("reading-preset-save-dialog");
		await expect.element(dialog).toBeVisible();
		await expect.element(page.getByTestId("reading-popover")).not.toBeInTheDocument();
		await expect
			.element(page.getByTestId("reading-preset-summary"))
			.toMatchTextContent(/Gruvbox.*16px.*Tight.*Focus: Scrolling/);
		await expect.element(page.getByTestId("reading-preset-default")).not.toBeChecked();
		await expect.element(page.getByTestId("reading-preset-save-confirm")).toBeDisabled();
		await page.getByTestId("reading-preset-name").fill("Late night");
		await userEvent.keyboard("{Enter}");

		await expect.element(dialog).not.toBeInTheDocument();
		await expect.element(page.getByTestId("reading-popover")).toBeVisible();
		await expect.element(presetsTrigger()).toHaveTextContent("Late night");
		await expect.element(page.getByTestId("reading-preset-save")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("reading-presets-unsaved")).not.toBeInTheDocument();
	});

	it("cancels the Save dialog with Escape and refuses a name already used", async () => {
		render(
			<Harness initialSettings={LATE_NIGHT} initialPresets={{ ...twoPresets, activeId: null }} />,
		);
		await openPanel();
		await page.getByTestId("reading-preset-save").click();

		await page.getByTestId("reading-preset-name").fill("late NIGHT");

		await expect.element(page.getByText("A preset with this name already exists.")).toBeVisible();
		await expect.element(page.getByTestId("reading-preset-save-confirm")).toBeDisabled();
		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByTestId("reading-preset-save-dialog")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("reading-popover")).toBeVisible();
	});

	it("lists presets with the active one checked and the default badged, and switches", async () => {
		render(<Harness initialSettings={LATE_NIGHT} initialPresets={twoPresets} />);
		await openPanel();
		await presetsTrigger().click();

		const night = page.getByRole("menuitem", { name: "Apply Late night" });
		await expect.element(night).toHaveAttribute("aria-current", "true");
		await expect.element(night).toMatchTextContent(/Default/);
		await expect.element(page.getByTestId("reading-preset-update")).not.toBeInTheDocument();

		await page.getByRole("menuitem", { name: "Apply Daytime" }).click();

		await expect.element(presetsTrigger()).toHaveTextContent("Daytime");
		await expect.element(page.getByTestId("reading-theme-name")).toHaveTextContent("Kilo");
	});

	it("always offers App appearance, checked while the settings follow Settings → Appearance", async () => {
		render(<Harness />);
		await openPanel();
		await presetsTrigger().click();

		const appearance = page.getByRole("menuitem", { name: "Apply App appearance" });
		await expect.element(appearance).toHaveAttribute("aria-current", "true");
		await expect.element(appearance).toMatchTextContent(/Kilo · Dark/);
		await userEvent.keyboard("{Escape}");

		await page.getByRole("radio", { name: "Gruvbox" }).click();
		await presetsTrigger().click();
		await expect.element(appearance).not.toHaveAttribute("aria-current");
		await appearance.click();

		await expect.element(page.getByTestId("reading-theme-name")).toHaveTextContent("Kilo");
		await expect.element(page.getByTestId("reading-presets-unsaved")).not.toBeInTheDocument();
	});

	it("leaves the active preset for App appearance", async () => {
		render(<Harness initialSettings={LATE_NIGHT} initialPresets={twoPresets} />);
		await openPanel();
		await presetsTrigger().click();
		await expect
			.element(page.getByRole("menuitem", { name: "Apply App appearance" }))
			.not.toHaveAttribute("aria-current");

		await page.getByRole("menuitem", { name: "Apply App appearance" }).click();

		await expect.element(presetsTrigger()).toHaveTextContent("Presets");
		await expect.element(page.getByTestId("reading-size")).toHaveTextContent("14px");
		await expect.element(page.getByTestId("reading-preset-update")).not.toBeInTheDocument();
	});

	it("turns Save… into Update once the active preset is changed, and Reset goes back to it", async () => {
		render(<Harness initialSettings={LATE_NIGHT} initialPresets={twoPresets} />);
		await openPanel();
		await page.getByRole("button", { name: "Larger text" }).click();
		await expect.element(page.getByTestId("reading-size")).toHaveTextContent("17px");
		await expect.element(page.getByTestId("reading-presets-unsaved")).toBeInTheDocument();

		await page.getByTestId("reading-reset").click();
		await expect.element(page.getByTestId("reading-size")).toHaveTextContent("16px");
		await expect.element(page.getByTestId("reading-presets-unsaved")).not.toBeInTheDocument();

		await page.getByRole("button", { name: "Larger text" }).click();
		const update = page.getByTestId("reading-preset-update");
		await expect.element(update).toHaveTextContent("Update");
		await expect.element(update).toHaveAccessibleName("Update “Late night”");
		await expect.element(page.getByTestId("reading-preset-save")).not.toBeInTheDocument();
		await presetsTrigger().click();
		await expect.element(page.getByRole("menuitem", { name: /^Update/ })).not.toBeInTheDocument();
		await expect.element(page.getByTestId("reading-preset-save-current")).toBeVisible();
		await userEvent.keyboard("{Escape}");
		await update.click();

		await expect.element(page.getByTestId("reading-presets-unsaved")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("reading-size")).toHaveTextContent("17px");
	});

	it("manages presets: default, rename, update and delete with a confirmation", async () => {
		render(<Harness initialSettings={LATE_NIGHT} initialPresets={twoPresets} />);
		await openPanel();
		await presetsTrigger().click();
		await page.getByTestId("reading-preset-manage").click();

		const dialog = page.getByTestId("reading-preset-manage-dialog");
		await expect.element(dialog).toBeVisible();
		await expect
			.element(page.getByTestId("reading-preset-row-summary-night"))
			.toHaveTextContent("Gruvbox · Dark · 16px · Loose · Focus: Scrolling");

		await page.getByTestId("reading-preset-set-default-day").click();
		await expect
			.element(page.getByTestId("reading-preset-set-default-day"))
			.toHaveAttribute("aria-pressed", "true");
		await expect
			.element(page.getByTestId("reading-preset-set-default-night"))
			.toHaveAttribute("aria-pressed", "false");

		await page.getByTestId("reading-preset-rename-day").click();
		const input = page.getByTestId("reading-preset-rename-input");
		await input.fill("Late Night");
		await expect.element(page.getByTestId("reading-preset-rename-save")).toBeDisabled();
		await input.fill("Morning");
		await userEvent.keyboard("{Enter}");
		await expect.element(page.getByTestId("reading-preset-row-day")).toMatchTextContent(/^Morning/);

		await page.getByTestId("reading-preset-rename-night").click();
		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByTestId("reading-preset-rename-input")).not.toBeInTheDocument();
		await expect.element(dialog).toBeVisible();

		await page.getByTestId("reading-preset-delete-night").click();
		const confirm = page.getByTestId("reading-preset-delete-dialog");
		await expect.element(confirm).toMatchTextContent(/Delete Late night\?/);
		await page.getByTestId("reading-preset-delete-confirm").click();

		await expect.element(confirm).not.toBeInTheDocument();
		await expect.element(page.getByTestId("reading-preset-row-night")).not.toBeInTheDocument();
		await page.getByTestId("reading-preset-manage-done").click();
		await expect.element(dialog).not.toBeInTheDocument();
		await expect.element(presetsTrigger()).toHaveTextContent("Presets");
	});

	it("keeps the Save dialog open with main's reason when saving fails", async () => {
		render(
			<Harness initialSettings={LATE_NIGHT} saveError="You can save up to 100 reading presets." />,
		);
		await openPanel();
		await page.getByTestId("reading-preset-save").click();
		await page.getByTestId("reading-preset-name").fill("Late night");

		await page.getByTestId("reading-preset-save-confirm").click();

		await expect
			.element(page.getByTestId("reading-preset-save-dialog"))
			.toMatchTextContent(/You can save up to 100 reading presets\./);
	});
});
