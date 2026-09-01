/**
 * Compute visible page numbers with ellipsis for large page counts.
 * Shows up to 5 numeric buttons with ellipsis where needed.
 */
export function computePageNumbers(current: number, total: number): (number | "ellipsis")[] {
	if (total <= 7) {
		return Array.from({ length: total }, (_, i) => i);
	}

	const pages: (number | "ellipsis")[] = [];

	if (current <= 3) {
		for (let i = 0; i < 5; i++) pages.push(i);
		pages.push("ellipsis");
		pages.push(total - 1);
	} else if (current >= total - 4) {
		pages.push(0);
		pages.push("ellipsis");
		for (let i = total - 5; i < total; i++) pages.push(i);
	} else {
		pages.push(0);
		pages.push("ellipsis");
		pages.push(current - 1);
		pages.push(current);
		pages.push(current + 1);
		pages.push("ellipsis");
		pages.push(total - 1);
	}

	return pages;
}
