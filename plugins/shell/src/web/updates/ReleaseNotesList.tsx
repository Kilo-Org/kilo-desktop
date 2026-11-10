import type { ReleaseNotes as DesktopReleaseNotes } from "@kilo-desktop/kernel";
import { MarkdownContent } from "@kilo-desktop/ui/components/markdown-content";
import { Separator } from "@kilo-desktop/ui/components/separator";

/**
 * Lists release notes newest first. The block for `targetVersion` (the update being installed)
 * sits unlabeled under the heading; every other block names its version, so when the target
 * release has no notes of its own, the earlier items are not mistaken for its changes.
 */
export function ReleaseNotesList({
	notes,
	targetVersion,
	showHeading = true,
}: {
	readonly notes: readonly DesktopReleaseNotes[];
	readonly targetVersion: string | null | undefined;
	readonly showHeading?: boolean;
}) {
	const visibleNotes = notes.filter(hasVisibleReleaseNotes);

	return (
		<section aria-label="Release notes">
			{showHeading ? (
				<h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
					What's changed
				</h3>
			) : null}
			{visibleNotes.map((release, releaseIndex) => {
				const labeled = releaseIndex > 0 || release.version !== targetVersion;
				return (
					<div key={release.version} className={showHeading && releaseIndex === 0 ? "mt-2" : ""}>
						{releaseIndex > 0 ? <Separator className="my-3" /> : null}
						{labeled ? (
							<code className="text-muted-foreground text-2xs font-medium">{release.version}</code>
						) : null}
						{release.items.length > 0 ? (
							<ul className={`${labeled ? "mt-2" : ""} space-y-1.5 pl-4 text-xs leading-5`}>
								{release.items.map((item, itemIndex) => (
									<li className="list-disc break-words" key={`${itemIndex}:${item}`}>
										{item}
									</li>
								))}
							</ul>
						) : (
							<MarkdownContent
								text={bodyWithoutChangelogLink(release)}
								className={`${labeled ? "mt-2" : ""} text-xs leading-5 break-words`}
							/>
						)}
					</div>
				);
			})}
		</section>
	);
}

export function hasVisibleReleaseNotes(release: DesktopReleaseNotes): boolean {
	return release.items.length > 0 || bodyWithoutChangelogLink(release).length > 0;
}

// GitHub's generated notes always end with a "**Full Changelog**: <compare URL>" line, so a
// re-published build with no new commits has nothing else; that link alone is not worth showing.
function bodyWithoutChangelogLink(release: DesktopReleaseNotes): string {
	return release.bodyMarkdown.replace(/^\s*\*\*full changelog\*\*:.*$/gim, "").trim();
}
