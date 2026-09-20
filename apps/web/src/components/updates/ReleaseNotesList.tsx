import type { DesktopReleaseNotes } from "@kilo-desktop/contracts";
import { MarkdownContent } from "@kilo-desktop/ui/components/markdown-content";
import { Separator } from "@kilo-desktop/ui/components/separator";

export function ReleaseNotesList({
	notes,
	showHeading = true,
}: {
	readonly notes: readonly DesktopReleaseNotes[];
	readonly showHeading?: boolean;
}) {
	const visibleNotes = notes.filter(hasVisibleReleaseNotes);

	return (
		<section aria-label="Release notes">
			{visibleNotes.map((release, releaseIndex) => (
				<div key={release.version}>
					{releaseIndex > 0 ? <Separator className="my-3" /> : null}
					{releaseIndex === 0 && showHeading ? (
						<h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
							What's changed
						</h3>
					) : releaseIndex > 0 ? (
						<code className="text-muted-foreground text-[11px] font-medium">{release.version}</code>
					) : null}
					{release.items.length > 0 ? (
						<ul
							className={`${showHeading || releaseIndex > 0 ? "mt-2" : ""} space-y-1.5 pl-4 text-xs leading-5`}
						>
							{release.items.map((item, itemIndex) => (
								<li className="list-disc break-words" key={`${itemIndex}:${item}`}>
									{item}
								</li>
							))}
						</ul>
					) : (
						<MarkdownContent
							text={release.bodyMarkdown}
							className={`${showHeading || releaseIndex > 0 ? "mt-2" : ""} text-xs leading-5 break-words`}
						/>
					)}
				</div>
			))}
		</section>
	);
}

export function hasVisibleReleaseNotes(release: DesktopReleaseNotes): boolean {
	return release.items.length > 0 || release.bodyMarkdown.trim().length > 0;
}
