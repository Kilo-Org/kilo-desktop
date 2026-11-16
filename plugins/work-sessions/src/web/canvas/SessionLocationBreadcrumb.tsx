import { FolderIcon } from "lucide-react";
import type { FC } from "react";

import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@kilo-desktop/ui/components/breadcrumb";
import { workspaceGlyphColor } from "@kilo-desktop/ui/components/workspace-picker";

/** Workspace › title; sessions outside a workspace show only their title. */
export const SessionLocationBreadcrumb: FC<{
	locationLabel?: string | null | undefined;
	locationColor?: string | undefined;
	title: string;
	qaId: string;
}> = ({ locationLabel, locationColor, title, qaId }) => {
	const glyph = workspaceGlyphColor(locationColor);
	return (
		<Breadcrumb
			data-qa-id={qaId}
			className="min-w-0 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] starting:opacity-0"
		>
			<BreadcrumbList className="flex-nowrap text-sm">
				{locationLabel ? (
					<>
						<BreadcrumbItem className="min-w-0">
							<span className="inline-flex min-w-0 items-center gap-1.5">
								<FolderIcon
									aria-hidden
									className="text-muted-foreground size-3.5 shrink-0"
									{...(glyph ? { color: glyph } : {})}
								/>
								<span className="truncate">{locationLabel}</span>
							</span>
						</BreadcrumbItem>
						<BreadcrumbSeparator className="[&>svg]:size-3" />
					</>
				) : null}
				<BreadcrumbItem className="min-w-0">
					<BreadcrumbPage className="truncate font-medium">{title}</BreadcrumbPage>
				</BreadcrumbItem>
			</BreadcrumbList>
		</Breadcrumb>
	);
};
