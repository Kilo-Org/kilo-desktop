import { useEffect, type ReactNode } from "react";
import { Navigate, Outlet, useNavigate, useParams } from "@tanstack/react-router";

import { RenderContribution } from "@kilo-desktop/kernel/web";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import {
	SettingsPageHeader,
	SettingsSectionProvider,
} from "@kilo-desktop/ui/components/settings-page-header";

import type { SettingsSectionImplementation } from "../../contracts";
import {
	readLastSettingsSection,
	resolveLandingSection,
	useSettingsGroups,
	useSettingsSections,
	writeLastSettingsSection,
} from "./sections";

// Esc belongs to these first: closing a dialog or menu, or editing a field.
const OWNS_ESCAPE =
	'select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
const OPEN_OVERLAY =
	'[data-slot="dialog-content"][data-open], [data-slot="alert-dialog-content"][data-open], [role="menu"], [role="listbox"]';

const selectComponent = (implementation: SettingsSectionImplementation) => implementation.component;

/** Esc leaves Settings, like "Back to app", unless something on screen owns it. */
function useEscapeLeavesSettings() {
	const navigate = useNavigate();
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
			const target = event.target;
			if (target instanceof Element && target.closest(OWNS_ESCAPE)) return;
			// An empty field has nothing to lose, so Esc still leaves.
			const field = target instanceof Element ? target.closest("input, textarea") : null;
			if (
				(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) &&
				field.value !== ""
			) {
				return;
			}
			if (document.querySelector(OPEN_OVERLAY)) return;
			void navigate({ to: "/" });
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [navigate]);
}

/** The Settings content pane; section navigation lives in the sidebar. */
export function SettingsLayout() {
	useEscapeLeavesSettings();
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col" data-qa-id="settings-page">
			<div className="flex min-h-0 flex-1 [scrollbar-gutter:stable] flex-col overflow-x-hidden overflow-y-auto p-6">
				<Outlet />
			</div>
		</div>
	);
}

/** `/settings`: lands on the last visited section, or the first. */
export function SettingsLanding() {
	const sections = useSettingsSections();
	const inSidebarOrder = useSettingsGroups(sections).flatMap((group) => group.sections);
	const landing = resolveLandingSection(inSidebarOrder, readLastSettingsSection());
	if (landing) return <Navigate to={`/settings/${landing.id}`} replace />;
	return (
		<Empty data-qa-id="settings-empty">
			<EmptyHeader>
				<EmptyTitle>No settings yet</EmptyTitle>
				<EmptyDescription>Plugins that have settings will list them here.</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

function SectionFrame({ children }: { readonly children: ReactNode }) {
	// Sections that manage their own scrolling mark their root `data-settings-fill`.
	return (
		<div className="mx-auto flex w-full max-w-3xl min-w-0 flex-1 flex-col has-[[data-settings-fill]]:min-h-0">
			{children}
		</div>
	);
}

/** `/settings/<id>`: the contributed section, with its title and description as header defaults. */
export function SettingsSectionRoute() {
	const { section: sectionId = "" } = useParams({ strict: false }) as { section?: string };
	const section = useSettingsSections().find((candidate) => candidate.id === sectionId);
	useEffect(() => {
		if (section) writeLastSettingsSection(section.id);
	}, [section]);

	if (!section) {
		return (
			<SectionFrame>
				<SettingsPageHeader
					title="Section not found"
					titleQaId="settings-section-not-found"
					description={
						<>
							No plugin provides a settings section named{" "}
							<code className="bg-muted rounded-sm px-1">{sectionId}</code>.
						</>
					}
				/>
			</SectionFrame>
		);
	}
	return (
		<SectionFrame>
			<SettingsSectionProvider
				value={{
					title: section.metadata.title,
					...(section.metadata.description ? { description: section.metadata.description } : {}),
				}}
			>
				<RenderContribution contribution={section} select={selectComponent} />
			</SettingsSectionProvider>
		</SectionFrame>
	);
}
