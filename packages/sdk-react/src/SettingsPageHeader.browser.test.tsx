import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
	SettingsPageHeader,
	SettingsSectionProvider,
	type SettingsSectionInfo,
} from "./SettingsPageHeader.js";

function renderInSection(section: SettingsSectionInfo | null, header: ReactNode) {
	return render(<SettingsSectionProvider value={section}>{header}</SettingsSectionProvider>);
}

function heading() {
	return screen.getByRole("heading", { level: 1 });
}

describe("SettingsPageHeader", () => {
	afterEach(cleanup);

	it("defaults to the section's manifest title and description", () => {
		renderInSection(
			{ title: "Appearance", description: "Theme and density." },
			<SettingsPageHeader />,
		);

		expect(heading().textContent).toBe("Appearance");
		expect(heading().getAttribute("data-qa-id")).toBe("settings-section-heading");
		const description = screen.getByText("Theme and density.");
		expect(description.getAttribute("data-qa-id")).toBe("settings-section-description");
		expect(description.getAttribute("title")).toBe("Theme and density.");
	});

	it("lets explicit props override the section defaults", () => {
		renderInSection(
			{ title: "Environments", description: "Manage environments." },
			<SettingsPageHeader title="base" description="Detail view" titleQaId="detail-heading" />,
		);

		expect(heading().textContent).toBe("base");
		expect(heading().getAttribute("data-qa-id")).toBe("detail-heading");
		expect(screen.getByText("Detail view")).toBeTruthy();
		expect(screen.queryByText("Manage environments.")).toBeNull();
	});

	it("hides the default description when description is null", () => {
		renderInSection(
			{ title: "About", description: "Version info." },
			<SettingsPageHeader description={null} />,
		);

		expect(heading().textContent).toBe("About");
		expect(screen.queryByText("Version info.")).toBeNull();
	});

	it("omits the tooltip for non-string descriptions", () => {
		renderInSection(
			{ title: "About" },
			<SettingsPageHeader description={<strong>Rich</strong>} descriptionQaId="desc" />,
		);

		const description = document.querySelector('[data-qa-id="desc"]');
		expect(description?.textContent).toBe("Rich");
		expect(description?.hasAttribute("title")).toBe(false);
	});

	it("renders without a section provider", () => {
		render(<SettingsPageHeader title="Standalone" />);

		expect(heading().textContent).toBe("Standalone");
		expect(document.querySelector('[data-qa-id="settings-section-actions"]')).toBeNull();
	});

	it("renders leading, inline children, and actions slots", () => {
		renderInSection(
			{ title: "Marketplace" },
			<SettingsPageHeader
				leading={<button type="button">Back</button>}
				actions={<button type="button">Refresh</button>}
			>
				<span>Beta</span>
			</SettingsPageHeader>,
		);

		expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
		expect(screen.getByText("Beta")).toBeTruthy();
		const actions = document.querySelector('[data-qa-id="settings-section-actions"]');
		expect(actions?.textContent).toBe("Refresh");
	});
});
