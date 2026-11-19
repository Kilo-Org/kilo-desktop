import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	KernelError,
	KernelOs,
	KernelUpdater,
	type DomainObjectProvider,
	type UpdaterState,
} from "@kilo-desktop/kernel";
import type { MainKernel } from "@kilo-desktop/kernel/main";
import { createPluginHost } from "@kilo-desktop/kernel/testing/plugin-host";
import { toast } from "@kilo-desktop/ui/components/sonner";

import manifest from "../../../plugin.json";
import { SHELL_DEFINITIONS, SidebarNotice, UPDATE_TRACK_SWITCHER_FLAG } from "../../contracts";
import type { LegalResources } from "../../main/legal";
import { renderShell } from "../../testing";
import { activateUpdates } from "./index";
import { updateAvailableLabel, updateReadyLabel } from "./updateActions";

type UpdateState = UpdaterState;

const downloadedState: UpdateState = {
	enabled: true,
	status: "downloaded",
	track: "stable",
	installedTrack: "stable",
	currentVersion: "1.2.2",
	availableVersion: "1.2.3",
	downloadedVersion: "1.2.3",
	downloadUrl: null,
	checkedAt: "2026-08-26T12:00:00.000Z",
	message: null,
	releaseNotes: [
		{
			version: "1.2.3",
			title: "Kilo Desktop v1.2.3",
			publishedAt: "2026-08-26T12:00:00.000Z",
			bodyMarkdown: "* Faster startup",
			items: ["Faster startup"],
		},
	],
};

const idleState: UpdateState = {
	...downloadedState,
	status: "idle",
	downloadedVersion: null,
	releaseNotes: [],
};

/** A Linux update: checked and offered, but downloaded and installed by hand. */
const availableState: UpdateState = {
	...downloadedState,
	status: "available",
	downloadedVersion: null,
	downloadUrl:
		"https://updates.example.com/kilo-desktop/latest/linux/x64/kilo-desktop_1.2.3_amd64.deb",
};

/** A Preview installation on the Preview track, before any switch. */
const previewInstallState: UpdateState = {
	...idleState,
	track: "preview",
	installedTrack: "preview",
	currentVersion: "1.2.3-preview-261118-10302",
	availableVersion: null,
};

/** The same installation after switching to Stable, before Stable has caught up. */
const waitingForStableState: UpdateState = {
	...previewInstallState,
	status: "up-to-date",
	track: "stable",
};

type ActionResult = { accepted: boolean; state: UpdateState };

interface UpdaterFake {
	check?: () => ActionResult | Promise<ActionResult>;
	setTrack?: (track: string) => ActionResult | Promise<ActionResult>;
	install?: () => ActionResult | Promise<ActionResult>;
}

interface OsFake {
	openExternal?: (url: string) => boolean | Promise<boolean>;
	showItemInFolder?: (path: string) => void | Promise<void>;
}

/** Files beside app.asar in a packaged build, by name. */
function packagedResources(files: Record<string, string>): LegalResources {
	return {
		locate: (file) => (file in files ? `/Applications/Kilo.app/Contents/Resources/${file}` : null),
		read: async (file) => files[file] ?? null,
	};
}

async function renderApp(
	options: {
		state?: UpdateState | null;
		updater?: UpdaterFake;
		os?: OsFake;
		flag?: boolean;
		path?: string;
		resources?: LegalResources;
	} = {},
) {
	const host = await renderShell([], {
		desktop: true,
		flags: { [UPDATE_TRACK_SWITCHER_FLAG]: options.flag !== false },
		shellMain: { legalResources: () => options.resources ?? packagedResources({}) },
		beforeRender: (main) => {
			main.kernelSdk.domainObjects.provide(KernelOs, {
				initialState: {},
				methods: {
					openExternal: ({ url }) => options.os?.openExternal?.(url) ?? true,
					showItemInFolder: ({ path }) => options.os?.showItemInFolder?.(path),
					showLogs: () => ({ revealed: true }),
					logFilePath: () => "/user-data/logs/main.log",
				},
			});
			if (options.state !== null)
				provideUpdater(main, options.state ?? downloadedState, options.updater ?? {});
		},
	});
	if (options.path) window.location.hash = `#${options.path}`;
	return host;
}

function provideUpdater(main: MainKernel, initialState: UpdateState, fake: UpdaterFake): void {
	const updater: DomainObjectProvider<typeof KernelUpdater> = main.kernelSdk.domainObjects.provide(
		KernelUpdater,
		{
			initialState,
			methods: {
				check: () => settle(fake.check?.() ?? { accepted: true, state: current() }),
				setTrack: ({ track }) =>
					settle(fake.setTrack?.(track) ?? { accepted: false, state: current() }),
				install: () => settle(fake.install?.() ?? { accepted: true, state: current() }),
			},
		},
	);
	const current = () => updater.state;
	const settle = async (result: ActionResult | Promise<ActionResult>) => {
		const settled = await result;
		updater.setState(settled.state);
		return settled;
	};
}

const openAbout = (options: Parameters<typeof renderApp>[0] = {}) =>
	renderApp({ ...options, path: "/settings/about" });

afterEach(() => {
	vi.restoreAllMocks();
	toast.dismiss();
});

describe("update-ready notice", () => {
	it("appears in the sidebar only when an update is downloaded", async () => {
		await renderApp();
		await expect
			.element(page.getByTestId("update-ready-pill"))
			.toHaveAccessibleName(`Restart to update: ${updateReadyLabel(downloadedState)}`);
		await page.getByTestId("update-ready-pill").hover();
		await expect.element(page.getByText("Faster startup", { exact: true })).toBeVisible();
		await expect.element(page.getByText("1.2.3", { exact: true })).not.toBeInTheDocument();

		await renderApp({ state: { ...idleState, status: "downloading" } });
		await expect.element(page.getByTestId("app-sidebar")).toBeInTheDocument();
		await expect.element(page.getByTestId("update-ready-pill")).not.toBeInTheDocument();
	});

	it("labels earlier notes with their version when the update itself has none", async () => {
		await renderApp({
			state: {
				...downloadedState,
				availableVersion: "1.2.4",
				downloadedVersion: "1.2.4",
				releaseNotes: [
					{
						...downloadedState.releaseNotes[0]!,
						version: "1.2.4",
						bodyMarkdown: "**Full Changelog**: https://github.com/acme/app/compare/v1.2.3...v1.2.4",
						items: [],
					},
					downloadedState.releaseNotes[0]!,
				],
			},
		});

		await page.getByTestId("update-ready-pill").hover();
		await expect.element(page.getByText("1.2.3", { exact: true })).toBeVisible();
		await expect.element(page.getByText("Faster startup", { exact: true })).toBeVisible();
	});

	it("installs only after the person confirms", async () => {
		const install = vi.fn(() => ({ accepted: true, state: downloadedState }));
		const confirm = vi.spyOn(globalThis, "confirm").mockReturnValue(false);
		await renderApp({ updater: { install } });

		await page.getByTestId("update-ready-pill").click();
		await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
		expect(install).not.toHaveBeenCalled();

		confirm.mockReturnValue(true);
		await page.getByTestId("update-ready-pill").click();
		await vi.waitFor(() => expect(install).toHaveBeenCalledOnce());
	});

	it("keeps the notice and explains when installing is refused", async () => {
		vi.spyOn(globalThis, "confirm").mockReturnValue(true);
		await renderApp({
			updater: {
				install: () => ({
					accepted: false,
					state: { ...downloadedState, message: "Install unavailable" },
				}),
			},
		});

		await page.getByTestId("update-ready-pill").click();

		await expect.element(page.getByText("Install unavailable")).toBeVisible();
		await expect.element(page.getByTestId("update-ready-pill")).toBeVisible();
	});

	it("explains when installing fails", async () => {
		vi.spyOn(globalThis, "confirm").mockReturnValue(true);
		await renderApp({
			updater: {
				install: () => {
					throw new KernelError("BUSINESS", "Installer missing");
				},
			},
		});

		await page.getByTestId("update-ready-pill").click();

		await expect.element(page.getByText("Installer missing")).toBeVisible();
	});
});

describe("update-available notice", () => {
	it("says an update is available and opens About, which owns the download", async () => {
		const openExternal = vi.fn(() => true);
		await renderApp({ state: availableState, os: { openExternal } });

		const pill = page.getByTestId("update-available-pill");
		await expect
			.element(pill)
			.toHaveAccessibleName(`Update available: ${updateAvailableLabel(availableState)}`);
		await expect.element(page.getByTestId("update-ready-pill")).not.toBeInTheDocument();
		await pill.hover();
		await expect.element(page.getByText("Faster startup", { exact: true })).toBeVisible();

		await pill.click();

		await expect.element(page.getByTestId("update-download")).toBeVisible();
		expect(openExternal).not.toHaveBeenCalled();
	});
});

describe("update-ready notice on its own", () => {
	it("renders through the sidebar-notice point without the shell's window", async () => {
		cleanup();
		const host = await createPluginHost(
			[{ manifest, definitions: SHELL_DEFINITIONS, web: { activate: activateUpdates } }],
			{ host: { desktop: true } },
		);
		try {
			provideUpdater(host.main, downloadedState, {});

			const slot = host.renderSlot(SidebarNotice);

			await expect.element(page.getByTestId("update-ready-pill")).toBeVisible();
			expect(slot.keys()).toEqual(["kilo.shell/update-ready"]);
			expect(document.querySelector('[data-qa-id="app-sidebar"]')).toBeNull();
		} finally {
			await host.dispose();
		}
	});

	it("opens the download itself where there is no settings page to open", async () => {
		cleanup();
		const host = await createPluginHost(
			[{ manifest, definitions: SHELL_DEFINITIONS, web: { activate: activateUpdates } }],
			{ host: { desktop: true } },
		);
		try {
			const openExternal = vi.fn((_url: string) => true);
			host.main.kernelSdk.domainObjects.provide(KernelOs, {
				initialState: {},
				methods: {
					openExternal: ({ url }) => openExternal(url),
					showItemInFolder: () => undefined,
					showLogs: () => ({ revealed: true }),
					logFilePath: () => "/user-data/logs/main.log",
				},
			});
			provideUpdater(host.main, availableState, {});
			host.renderSlot(SidebarNotice);

			await page.getByTestId("update-available-pill").click();

			await vi.waitFor(() => expect(openExternal).toHaveBeenCalledWith(availableState.downloadUrl));
		} finally {
			await host.dispose();
		}
	});
});

describe("About settings", () => {
	it("shows the version, the install action and release notes worth reading", async () => {
		const blank = {
			...downloadedState.releaseNotes[0]!,
			version: "1.2.4-without-notes",
			bodyMarkdown: "",
			items: [],
		};
		const skipped = {
			...downloadedState.releaseNotes[0]!,
			version: "1.2.2-preview-260825-12000",
			items: ["Improved retry behavior"],
		};
		await openAbout({
			state: {
				...downloadedState,
				track: "preview",
				releaseNotes: [blank, downloadedState.releaseNotes[0]!, skipped],
			},
		});

		await expect.element(page.getByTestId("about-settings")).toBeVisible();
		await expect.element(page.getByText("1.2.2", { exact: true })).toBeVisible();
		await expect
			.element(page.getByTestId("update-status-message"))
			.toHaveTextContent("Version 1.2.3 is ready to install.");
		const version = page.getByTestId("about-version");
		await expect.element(version.getByText("Faster startup", { exact: true })).toBeVisible();
		await expect
			.element(version.getByText("1.2.4-without-notes", { exact: true }))
			.not.toBeInTheDocument();
		await expect
			.element(version.getByText("Improved retry behavior", { exact: true }))
			.toBeVisible();
		expect(page.getByTestId("update-release-notes").element().textContent).not.toContain("#");
	});

	it("shows release-note text when there are no bullet items", async () => {
		await openAbout({
			state: {
				...downloadedState,
				releaseNotes: [
					{
						...downloadedState.releaseNotes[0]!,
						bodyMarkdown: "This release improves startup reliability.",
						items: [],
					},
				],
			},
		});

		await expect
			.element(
				page
					.getByTestId("about-version")
					.getByText("This release improves startup reliability.", { exact: true }),
			)
			.toBeVisible();
	});

	it("skips a release whose notes are only the compare link, keeping the target version", async () => {
		const republished = {
			...downloadedState.releaseNotes[0]!,
			version: "1.2.4",
			bodyMarkdown: "**Full Changelog**: https://github.com/acme/app/compare/v1.2.3...v1.2.4",
			items: [],
		};
		await openAbout({
			state: {
				...downloadedState,
				availableVersion: "1.2.4",
				downloadedVersion: "1.2.4",
				releaseNotes: [republished, downloadedState.releaseNotes[0]!],
			},
		});

		const notes = page.getByTestId("update-release-notes");
		await expect.element(notes.getByText("1.2.4", { exact: true })).toBeVisible();
		await expect.element(notes.getByText("1.2.3", { exact: true })).toBeVisible();
		await expect.element(notes.getByText("Faster startup", { exact: true })).toBeVisible();
		expect(notes.element().textContent).not.toContain("Full Changelog");
	});

	it("leaves the target release's own notes unlabeled under the heading", async () => {
		await openAbout();

		const notes = page.getByTestId("update-release-notes");
		await expect.element(notes.getByText("1.2.3", { exact: true })).toBeVisible();
		expect(notes.getByText("1.2.3", { exact: true }).elements()).toHaveLength(1);
	});

	it("confirms installation with an in-app dialog", async () => {
		const install = vi.fn(() => ({ accepted: true, state: downloadedState }));
		const confirm = vi.spyOn(globalThis, "confirm");
		await openAbout({ updater: { install } });

		await page.getByTestId("update-install").click();
		await page.getByTestId("update-install-cancel").click();
		await expect.element(page.getByTestId("update-install-dialog")).not.toBeInTheDocument();
		expect(install).not.toHaveBeenCalled();

		await page.getByTestId("update-install").click();
		await page.getByTestId("update-install-confirm").click();
		await vi.waitFor(() => expect(install).toHaveBeenCalledOnce());
		expect(confirm).not.toHaveBeenCalled();
	});

	it("links the download of an update that must be installed by hand", async () => {
		const openExternal = vi.fn(() => true);
		await openAbout({ state: availableState, os: { openExternal } });

		await expect
			.element(page.getByTestId("update-status-message"))
			.toHaveTextContent("Version 1.2.3 is available to download.");
		await expect
			.element(page.getByTestId("about-version").getByText("Faster startup", { exact: true }))
			.toBeVisible();
		await expect.element(page.getByTestId("update-install")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("update-track")).toBeEnabled();

		await page.getByTestId("update-download").click();

		await vi.waitFor(() => expect(openExternal).toHaveBeenCalledWith(availableState.downloadUrl));
	});

	it("explains when the download link cannot be opened", async () => {
		await openAbout({ state: availableState, os: { openExternal: () => false } });

		await page.getByTestId("update-download").click();

		await expect.element(page.getByText("Could not open the download link")).toBeVisible();
	});

	it("checks again and shows the result", async () => {
		const check = vi.fn(() => ({
			accepted: true,
			state: { ...idleState, status: "up-to-date" as const },
		}));
		await openAbout({
			state: { ...idleState, message: "Last check could not reach the update server." },
			updater: { check },
		});

		await page.getByTestId("update-check").click();

		await expect
			.element(page.getByTestId("update-status-message"))
			.toHaveTextContent("You're up to date.");
		expect(check).toHaveBeenCalledOnce();
	});

	it("says when a check is already running", async () => {
		await openAbout({
			state: idleState,
			updater: { check: () => ({ accepted: false, state: idleState }) },
		});

		await page.getByTestId("update-check").click();

		await expect.element(page.getByText("An update check is already in progress.")).toBeVisible();
	});

	it("explains when the updater fails", async () => {
		const fail = (message: string) => () => {
			throw new KernelError("BUSINESS", message);
		};
		await openAbout({ state: idleState, updater: { check: fail("Feed unreachable") } });

		await page.getByTestId("update-check").click();
		await expect.element(page.getByText("Could not check for updates")).toBeVisible();
		await expect.element(page.getByText("Feed unreachable")).toBeVisible();

		await openAbout({ updater: { install: fail("Installer missing") } });
		await page.getByTestId("update-install").click();
		await page.getByTestId("update-install-confirm").click();
		await expect.element(page.getByText("Could not install update")).toBeVisible();
		await expect.element(page.getByText("Installer missing")).toBeVisible();
	});

	it("locks the check and track controls while a check is pending", async () => {
		let finish: ((result: ActionResult) => void) | undefined;
		await openAbout({
			state: idleState,
			updater: { check: () => new Promise((resolve) => (finish = resolve)) },
		});

		await page.getByTestId("update-check").click();

		await expect.element(page.getByTestId("update-check")).toBeDisabled();
		await expect.element(page.getByTestId("update-track")).toBeDisabled();
		finish?.({ accepted: true, state: idleState });
		await expect.element(page.getByTestId("update-check")).toBeEnabled();
	});

	it("locks the track while an update is in progress or ready", async () => {
		for (const status of ["checking", "downloading", "downloaded"] as const) {
			await openAbout({
				state: status === "downloaded" ? downloadedState : { ...idleState, status },
			});
			await expect.element(page.getByTestId("update-track")).toBeDisabled();
		}
	});

	it("changes the update track", async () => {
		const setTrack = vi.fn((track: string) => ({
			accepted: true,
			state: { ...idleState, track },
		}));
		await openAbout({ state: idleState, updater: { setTrack } });

		await page.getByTestId("update-track").click();
		await page.getByTestId("update-track-preview").click();

		await vi.waitFor(() => expect(setTrack).toHaveBeenCalledWith("preview"));
		await expect
			.element(page.getByTestId("update-track").getByText("Preview", { exact: true }))
			.toBeInTheDocument();
	});

	it("explains a refused track change", async () => {
		await openAbout({
			state: idleState,
			updater: {
				setTrack: () => ({
					accepted: false,
					state: { ...idleState, message: "Switching update tracks is not enabled." },
				}),
			},
		});

		await page.getByTestId("update-track").click();
		await page.getByTestId("update-track-preview").click();

		await expect.element(page.getByText("Switching update tracks is not enabled.")).toBeVisible();
	});

	it("explains that a Preview installation moves to Stable with the next Stable release", async () => {
		const openExternal = vi.fn(() => true);
		await openAbout({
			state: previewInstallState,
			os: { openExternal },
			updater: { setTrack: () => ({ accepted: true, state: waitingForStableState }) },
		});
		await expect.element(page.getByTestId("update-track-awaiting-stable")).not.toBeInTheDocument();

		await page.getByTestId("update-track").click();
		await page.getByTestId("update-track-stable").click();

		await vi.waitFor(() =>
			expect(page.getByTestId("update-track-awaiting-stable").element().textContent).toContain(
				"You'll be offered Stable 1.2.3 or later once it's released.",
			),
		);
		await expect
			.element(page.getByTestId("update-status-message"))
			.toHaveTextContent("Waiting for Stable 1.2.3 or later.");

		await page.getByTestId("update-track-download-stable").click();

		await vi.waitFor(() => expect(openExternal).toHaveBeenCalledWith("https://kilo.ai/install"));
	});

	it("drops the Stable explanation once a Stable update is on its way", async () => {
		await openAbout({
			state: {
				...downloadedState,
				installedTrack: "preview",
				currentVersion: "1.2.3-preview-261118-10302",
			},
		});

		await expect
			.element(page.getByTestId("update-status-message"))
			.toHaveTextContent("Version 1.2.3 is ready to install.");
		await expect.element(page.getByTestId("update-track-awaiting-stable")).not.toBeInTheDocument();
	});

	it("offers the track only while the switcher flag is on", async () => {
		await openAbout({ flag: false });

		await expect.element(page.getByTestId("about-settings")).toBeVisible();
		await expect.element(page.getByTestId("update-track")).not.toBeInTheDocument();
	});

	it("does not guess the track before the updater's state is known", async () => {
		await openAbout({ state: null });

		const track = page.getByTestId("update-track");
		await expect.element(track).toBeDisabled();
		expect(track.element().textContent).not.toMatch(/Stable|Preview/);
	});
});

describe("About blocks", () => {
	it("puts the version above kilo.shell's Support and Legal below it", async () => {
		await openAbout();

		await expect.element(page.getByTestId("about-legal")).toBeVisible();
		const order = [...page.getByTestId("about-settings").element().querySelectorAll("[data-qa-id]")]
			.map((element) => element.getAttribute("data-qa-id"))
			.filter((id) => id === "about-version" || id === "about-support" || id === "about-legal");
		expect(order).toEqual(["about-version", "about-support", "about-legal"]);
	});
});

describe("About → Legal", () => {
	const shipped = packagedResources({
		"THIRD_PARTY_NOTICES.txt": "THIRD-PARTY SOFTWARE NOTICES\n\nreact 19.2.8\nLicense: MIT",
		"LICENSES.chromium.html": "<html></html>",
	});

	it("opens Kilo's terms of service in the browser", async () => {
		const openExternal = vi.fn(() => true);
		await openAbout({ resources: shipped, os: { openExternal } });

		await page.getByTestId("about-view-terms").click();

		await vi.waitFor(() => expect(openExternal).toHaveBeenCalledWith("https://kilo.ai/terms"));
	});

	it("shows the notices of the third-party software the app includes", async () => {
		await openAbout({ resources: shipped });

		await page.getByTestId("about-view-third-party-notices").click();

		const viewer = page.getByTestId("legal-document");
		await expect
			.element(viewer.getByRole("heading", { name: "Third-party notices" }))
			.toBeVisible();
		await expect.element(viewer.getByText(/react 19\.2\.8\s+License: MIT/)).toBeVisible();
	});

	it("reveals Chromium's notices in the file manager", async () => {
		const showItemInFolder = vi.fn();
		await openAbout({ resources: shipped, os: { showItemInFolder } });

		await page.getByTestId("about-show-chromium-notices").click();

		await vi.waitFor(() =>
			expect(showItemInFolder).toHaveBeenCalledWith(
				"/Applications/Kilo.app/Contents/Resources/LICENSES.chromium.html",
			),
		);
	});

	it("explains that the documents come with packaged builds when they are not shipped", async () => {
		await openAbout({ resources: packagedResources({}) });

		await page.getByTestId("about-view-third-party-notices").click();

		await expect
			.element(page.getByTestId("legal-document").getByText(/included in packaged builds/))
			.toBeVisible();
		await expect.element(page.getByTestId("about-show-chromium-notices")).toBeDisabled();
	});

	it("explains when a shipped document cannot be read", async () => {
		await openAbout({
			resources: {
				...shipped,
				read: async () => {
					throw new KernelError("UNAVAILABLE", "Permission denied");
				},
			},
		});

		await page.getByTestId("about-view-third-party-notices").click();

		await expect
			.element(page.getByTestId("legal-document").getByText(/Could not read this document/))
			.toBeVisible();
	});

	it("reports when Chromium's notices cannot be revealed", async () => {
		await openAbout({
			resources: shipped,
			os: {
				showItemInFolder: () => {
					throw new KernelError("UNAVAILABLE", "No file manager");
				},
			},
		});

		await page.getByTestId("about-show-chromium-notices").click();

		await expect.element(page.getByText("Could not show Chromium's notices")).toBeVisible();
	});
});
