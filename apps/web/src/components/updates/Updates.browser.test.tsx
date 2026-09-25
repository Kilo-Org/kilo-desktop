import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { DesktopUpdateState, LocalApi } from "@kilo-desktop/contracts";

import { AboutSettings } from "@/components/settings/AboutSettings";
import { LocalApiProvider } from "@/platform/LocalApiProvider";
import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { UpdateProvider, useDesktopUpdates } from "@/platform/updates/UpdateProvider";

import { SidebarUpdatePill } from "./SidebarUpdatePill";
import { getInstallConfirmationMessage, updateReadyLabel } from "./updateActions";

const downloadedState: DesktopUpdateState = {
	enabled: true,
	status: "downloaded",
	track: "stable",
	currentVersion: "1.2.2",
	availableVersion: "1.2.3",
	downloadedVersion: "1.2.3",
	checkedAt: "2026-08-26T12:00:00.000Z",
	message: null,
	releaseNotes: [
		{
			schemaVersion: 1,
			track: "stable",
			version: "1.2.3",
			title: "Kilo Desktop v1.2.3",
			publishedAt: "2026-08-26T12:00:00.000Z",
			bodyMarkdown: "* Faster startup",
			items: ["Faster startup"],
		},
	],
};

function updateApi(
	state: DesktopUpdateState,
	overrides: Partial<LocalApi["updates"]> = {},
): LocalApi {
	const base = createBrowserLocalApi();
	return {
		...base,
		updates: {
			getState: async () => state,
			check: async () => ({ accepted: true, state }),
			setTrack: async () => ({ accepted: false, state }),
			install: async () => ({ accepted: true, state }),
			onChanged: () => () => {},
			...overrides,
		},
	};
}

function renderUpdates(api: LocalApi, child: React.ReactNode) {
	return render(
		<LocalApiProvider api={api}>
			<UpdateProvider>{child}</UpdateProvider>
		</LocalApiProvider>,
	);
}

function UpdateStateProbe() {
	const updates = useDesktopUpdates();
	return <div data-qa-id="update-state-probe">{updates?.state?.status ?? "loading"}</div>;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("update UI", () => {
	it("shows the sidebar pill only when an update is downloaded", async () => {
		renderUpdates(updateApi(downloadedState), <SidebarUpdatePill />);
		await expect
			.element(page.getByTestId("update-ready-pill"))
			.toHaveAccessibleName(`Restart to update: ${updateReadyLabel(downloadedState)}`);
		await page.getByTestId("update-ready-pill").hover();
		await vi.waitFor(() => {
			const tooltip = document.querySelector<HTMLElement>('[data-slot="tooltip-content"]');
			const arrow = document.querySelector<HTMLElement>('[data-slot="tooltip-arrow"]');
			expect(tooltip).not.toBeNull();
			expect(arrow).not.toBeNull();
			expect(getComputedStyle(arrow!).display).toBe("none");
		});

		cleanup();
		renderUpdates(
			updateApi({ ...downloadedState, status: "downloading", downloadedVersion: null }),
			<SidebarUpdatePill />,
		);
		await expect.element(page.getByTestId("update-ready-pill")).not.toBeInTheDocument();
	});

	it("confirms and invokes installation from the ready pill", async () => {
		const install = vi.fn(async () => ({ accepted: true, state: downloadedState }));
		const confirm = vi.spyOn(globalThis, "confirm").mockImplementation(() => {
			expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
			return true;
		});
		renderUpdates(updateApi(downloadedState, { install }), <SidebarUpdatePill />);

		const pill = page.getByTestId("update-ready-pill");
		await expect.element(pill).toBeVisible();
		pill.element().focus();
		await vi.waitFor(
			() => {
				expect(document.querySelector('[data-slot="tooltip-content"]')).not.toBeNull();
			},
			{ timeout: 3_000 },
		);
		await pill.click();
		await vi.waitFor(() => {
			expect(confirm).toHaveBeenCalledOnce();
			expect(install).toHaveBeenCalledOnce();
		});
	});

	it("keeps the ready pill when installation is cancelled or rejected", async () => {
		const install = vi.fn(async () => ({
			accepted: false,
			state: { ...downloadedState, message: "Install unavailable" },
		}));
		const confirm = vi.spyOn(globalThis, "confirm").mockReturnValue(false);
		renderUpdates(updateApi(downloadedState, { install }), <SidebarUpdatePill />);

		await page.getByTestId("update-ready-pill").click();
		// The click handler is async (flushSync + waitForPaint before confirm),
		// so wait until the cancelled confirmation has actually been observed.
		await vi.waitFor(() => {
			expect(confirm).toHaveBeenCalledOnce();
		});
		expect(install).not.toHaveBeenCalled();

		confirm.mockReturnValue(true);
		await page.getByTestId("update-ready-pill").click();
		await vi.waitFor(() => {
			expect(install).toHaveBeenCalledOnce();
		});
		await expect.element(page.getByTestId("update-ready-pill")).toBeVisible();
	});

	it("renders the compact version action and sanitized release notes in About", async () => {
		const stateWithSkippedPreview = {
			...downloadedState,
			track: "preview" as const,
			releaseNotes: [
				{
					...downloadedState.releaseNotes[0]!,
					version: "1.2.4-without-notes",
					bodyMarkdown: "",
					items: [],
				},
				downloadedState.releaseNotes[0]!,
				{
					...downloadedState.releaseNotes[0]!,
					track: "preview" as const,
					version: "1.2.2-preview-260825-12000",
					items: ["Improved retry behavior"],
				},
			],
		};
		renderUpdates(updateApi(stateWithSkippedPreview), <AboutSettings />);

		await expect.element(page.getByTestId("about-settings")).toBeVisible();
		await expect.element(page.getByText("1.2.2", { exact: true })).toBeVisible();
		await expect.element(page.getByTestId("update-install")).toBeVisible();
		await expect.element(page.getByText("Version 1.2.3 is ready to install.")).toBeVisible();
		await expect.element(page.getByText("Faster startup", { exact: true })).toBeVisible();
		await expect
			.element(page.getByText("1.2.4-without-notes", { exact: true }))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByText("1.2.2-preview-260825-12000", { exact: true }))
			.toBeVisible();
		await expect.element(page.getByText("Improved retry behavior", { exact: true })).toBeVisible();
		await expect.element(page.getByText("Update track", { exact: true })).toBeVisible();
		await expect.element(page.getByText("Update status")).not.toBeInTheDocument();
		await expect.element(page.getByText("Last checked")).not.toBeInTheDocument();
		expect(page.getByTestId("update-release-notes").element().textContent).not.toContain("#");
	});

	it("confirms installation from About with an in-app dialog", async () => {
		const install = vi.fn(async () => ({ accepted: true, state: downloadedState }));
		const confirm = vi.spyOn(globalThis, "confirm");
		renderUpdates(updateApi(downloadedState, { install }), <AboutSettings />);

		await page.getByTestId("update-install").click();
		await expect.element(page.getByTestId("update-install-dialog")).toBeVisible();
		await page.getByTestId("update-install-cancel").click();
		await expect.element(page.getByTestId("update-install-dialog")).not.toBeInTheDocument();
		expect(install).not.toHaveBeenCalled();

		await page.getByTestId("update-install").click();
		await page.getByTestId("update-install-confirm").click();
		await vi.waitFor(() => {
			expect(install).toHaveBeenCalledOnce();
		});
		expect(confirm).not.toHaveBeenCalled();
	});

	it("renders published release-note text when there are no bullet items", async () => {
		const state = {
			...downloadedState,
			releaseNotes: [
				{
					...downloadedState.releaseNotes[0]!,
					bodyMarkdown: "This release improves startup reliability.",
					items: [],
				},
			],
		};
		renderUpdates(updateApi(state), <AboutSettings />);

		await expect
			.element(page.getByText("This release improves startup reliability.", { exact: true }))
			.toBeVisible();
	});

	it("disables the track selector while an update is in progress or ready", async () => {
		for (const status of ["checking", "downloading", "downloaded"] as const) {
			cleanup();
			const state = {
				...downloadedState,
				status,
				...(status === "downloaded"
					? {}
					: { downloadedVersion: null, releaseNotes: [] as typeof downloadedState.releaseNotes }),
			};
			renderUpdates(updateApi(state), <AboutSettings />);
			await expect.element(page.getByTestId("update-track")).toBeDisabled();
			if (status !== "downloaded") {
				await expect.element(page.getByTestId("update-check")).toBeDisabled();
			}
		}
	});

	it("disables check and track controls while a check is pending", async () => {
		const idleState = {
			...downloadedState,
			status: "idle" as const,
			downloadedVersion: null,
			releaseNotes: [],
		};
		let resolveCheck: ((value: { accepted: true; state: typeof idleState }) => void) | undefined;
		const check = vi.fn(
			() =>
				new Promise<{ accepted: true; state: typeof idleState }>((resolve) => {
					resolveCheck = resolve;
				}),
		);
		renderUpdates(updateApi(idleState, { check }), <AboutSettings />);

		await page.getByTestId("update-check").click();
		await expect.element(page.getByTestId("update-check")).toBeDisabled();
		await expect.element(page.getByTestId("update-track")).toBeDisabled();

		await act(async () => {
			resolveCheck?.({ accepted: true, state: idleState });
		});
	});

	it("changes the update track from About settings", async () => {
		const idleState = {
			...downloadedState,
			status: "idle" as const,
			downloadedVersion: null,
			releaseNotes: [],
		};
		const stableState = { ...idleState, track: "stable" as const };
		const previewState = { ...idleState, track: "preview" as const };
		const setTrack = vi.fn(async () => ({ accepted: true, state: previewState }));
		renderUpdates(updateApi(stableState, { setTrack }), <AboutSettings />);

		await page.getByTestId("update-track").click();
		await page.getByTestId("update-track-preview").click();

		await vi.waitFor(() => expect(setTrack).toHaveBeenCalledWith("preview"));
		expect(page.getByTestId("update-track").element().textContent).toContain("Preview");
	});

	it("checks again and renders updater status details", async () => {
		const idleState = {
			...downloadedState,
			status: "idle" as const,
			downloadedVersion: null,
			releaseNotes: [],
			message: "Last check could not reach the update server.",
		};
		const currentState = { ...idleState, status: "up-to-date" as const, message: null };
		const check = vi.fn(async () => ({ accepted: true, state: currentState }));
		renderUpdates(updateApi(idleState, { check }), <AboutSettings />);

		await expect.element(page.getByTestId("update-status-message")).toBeVisible();
		await page.getByTestId("update-check").click();
		expect(check).toHaveBeenCalledOnce();
		await expect.element(page.getByText("You're up to date.", { exact: true })).toBeVisible();
	});

	it("does not let the initial state read overwrite a newer update event", async () => {
		let emit: ((state: DesktopUpdateState) => void) | undefined;
		let resolveInitial: ((state: DesktopUpdateState) => void) | undefined;
		const unsubscribe = vi.fn();
		const initialState = { ...downloadedState, status: "idle" as const, downloadedVersion: null };
		const api = updateApi(initialState, {
			getState: () =>
				new Promise((resolve) => {
					resolveInitial = resolve;
				}),
			onChanged: (listener) => {
				emit = listener;
				return unsubscribe;
			},
		});
		const rendered = renderUpdates(api, <UpdateStateProbe />);

		await vi.waitFor(() => expect(emit).toBeTypeOf("function"));
		await act(async () => {
			emit?.(downloadedState);
			resolveInitial?.(initialState);
		});
		await expect.element(page.getByTestId("update-state-probe")).toHaveTextContent("downloaded");

		rendered.unmount();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it("does not show a guessed update track before the update state loads", async () => {
		const api = updateApi(downloadedState, { getState: () => new Promise(() => {}) });
		renderUpdates(api, <AboutSettings />);

		const track = page.getByTestId("update-track");
		await expect.element(track).toBeDisabled();
		expect(track.element().textContent).not.toMatch(/Stable|Preview/);
	});

	it("formats restart confirmation details for Windows and unknown versions", () => {
		expect(getInstallConfirmationMessage(downloadedState, "Win32")).toContain(
			"no installer window may appear",
		);
		expect(
			getInstallConfirmationMessage(
				{ ...downloadedState, downloadedVersion: null, availableVersion: null },
				"MacIntel",
			),
		).not.toContain("undefined");
		expect(updateReadyLabel({ ...downloadedState, downloadedVersion: null })).toBe(
			"Update ready to install",
		);
	});
});
