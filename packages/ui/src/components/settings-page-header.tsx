import { createContext, useContext, type ReactNode } from "react";

export type SettingsSectionInfo = {
	title: string;
	description?: ReactNode;
};

const SettingsSectionContext = createContext<SettingsSectionInfo | null>(null);

/** Shell-only: supplies the mounted section's manifest title and description. */
export const SettingsSectionProvider = SettingsSectionContext.Provider;

/**
 * Page header for a settings section. Every section renders one as the first
 * child of its root, so all settings pages share one heading style. Title and
 * description default to the section's manifest entry; pass them to override
 * (a drill-down view), or pass `description={null}` to hide the default.
 * `leading` renders left of the title (a back button), `children` beside it
 * (a badge), and `actions` on the right (page-level buttons).
 */
export function SettingsPageHeader({
	title,
	description,
	titleQaId = "settings-section-heading",
	descriptionQaId = "settings-section-description",
	leading,
	actions,
	children,
}: {
	title?: string | undefined;
	description?: ReactNode;
	titleQaId?: string | undefined;
	descriptionQaId?: string | undefined;
	leading?: ReactNode;
	actions?: ReactNode;
	children?: ReactNode;
}) {
	const section = useContext(SettingsSectionContext);
	const displayedTitle = title ?? section?.title;
	const displayedDescription = description === undefined ? section?.description : description;

	return (
		<header className="flex min-w-0 shrink-0 items-start justify-between gap-3">
			<div className="min-w-0">
				<div className="flex min-w-0 items-center gap-2">
					{leading}
					<h1 className="truncate text-base font-semibold tracking-tight" data-qa-id={titleQaId}>
						{displayedTitle}
					</h1>
					{children}
				</div>
				{displayedDescription ? (
					<p
						className="text-muted-foreground mt-0.5 truncate text-sm leading-snug"
						data-qa-id={descriptionQaId}
						title={typeof displayedDescription === "string" ? displayedDescription : undefined}
					>
						{displayedDescription}
					</p>
				) : null}
			</div>
			{actions ? (
				<div className="flex shrink-0 items-center gap-2" data-qa-id="settings-section-actions">
					{actions}
				</div>
			) : null}
		</header>
	);
}
