import { useEffect, type ReactNode } from "react";
import { Outlet, useNavigate } from "@tanstack/react-router";

import { HOME_PLUGIN_SPLAT } from "@/features/home-route";

// Esc belongs to these first: closing a dialog or menu, or editing a field.
const OWNS_ESCAPE =
	'select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
const OPEN_OVERLAY =
	'[data-slot="dialog-content"][data-open], [data-slot="alert-dialog-content"][data-open], [role="menu"], [role="listbox"]';

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
			if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
				if (field.value !== "") return;
			}
			if (document.querySelector(OPEN_OVERLAY)) return;
			void navigate({ to: "/plugins/$", params: { _splat: HOME_PLUGIN_SPLAT } });
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [navigate]);
}

/**
 * Settings content pane. Section navigation lives in the app siderail
 * (`SettingsSidebar`) so settings takes over the rail instead of nesting a
 * second nav inside this page.
 */
export function SettingsLayout({ children }: { children?: ReactNode }) {
	useEscapeLeavesSettings();
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col" data-qa-id="settings-page">
			<div className="flex min-h-0 flex-1 [scrollbar-gutter:stable] flex-col overflow-x-hidden overflow-y-auto p-6">
				{children ?? <Outlet />}
			</div>
		</div>
	);
}
