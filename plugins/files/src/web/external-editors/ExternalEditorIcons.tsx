import { type FC, type SVGProps, useId } from "react";

import { cn } from "@kilo-desktop/ui/lib/utils";

import type { ExternalEditorId } from "../../contracts/models.js";

export type ExternalEditorIcon = FC<SVGProps<SVGSVGElement>>;

const useSvgGradientIds = (prefix: string, count: number) => {
	const id = useId();
	return Array.from(
		{ length: count },
		(_, index) => `${id}-${prefix}-${String.fromCharCode(97 + index)}`,
	);
};

export const CursorIcon: ExternalEditorIcon = ({ className, ...props }) => (
	<svg
		{...props}
		viewBox="0 0 466.73 532.09"
		className={cn("fill-[#26251E] dark:fill-[#EDECEC]", className)}
	>
		<path d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z" />
	</svg>
);

export const TraeIcon: ExternalEditorIcon = (props) => (
	<svg {...props} viewBox="0 0 24 24" fill="currentColor">
		{/* Back rectangle: left strip + bottom strip drawn separately — empty bottom-left corner is the gap between them */}
		<rect x="1" y="4" width="3" height="14" />
		<rect x="4" y="18" width="18" height="3" />
		{/* Front frame: top bar + right bar only — left and bottom are replaced by the back strips above */}
		<rect x="4" y="4" width="18" height="3" />
		<rect x="19" y="7" width="3" height="11" />
		{/* Two diamonds, offset slightly to the right within the open area */}
		<path d="M11 10L13 12L11 14L9 12Z" />
		<path d="M16 10L18 12L16 14L14 12Z" />
	</svg>
);

export const KiroIcon: ExternalEditorIcon = (props) => (
	<svg {...props} viewBox="0 0 1200 1200" fill="none">
		<rect width="1200" height="1200" rx="260" fill="#9046FF" />
		<path
			d="M398.554 818.914C316.315 1001.03 491.477 1046.74 620.672 940.156C658.687 1059.66 801.052 970.473 852.234 877.795C964.787 673.567 919.318 465.357 907.64 422.374C827.637 129.443 427.623 128.946 358.8 423.865C342.651 475.544 342.402 534.18 333.458 595.051C328.986 625.86 325.507 645.488 313.83 677.785C306.873 696.424 297.68 712.819 282.773 740.645C259.915 783.881 269.604 867.113 387.87 823.883L399.051 818.914H398.554Z"
			fill="#fff"
		/>
		<path
			d="M636.123 549.353C603.328 549.353 598.359 510.097 598.359 486.742C598.359 465.623 602.086 448.977 609.293 438.293C615.504 428.852 624.697 424.131 636.123 424.131C647.555 424.131 657.492 428.852 664.447 438.541C672.398 449.474 676.623 466.12 676.623 486.742C676.623 525.998 661.471 549.353 636.375 549.353H636.123Z"
			fill="#000"
		/>
		<path
			d="M771.24 549.353C738.445 549.353 733.477 510.097 733.477 486.742C733.477 465.623 737.203 448.977 744.41 438.293C750.621 428.852 759.814 424.131 771.24 424.131C782.672 424.131 792.609 428.852 799.564 438.541C807.516 449.474 811.74 466.12 811.74 486.742C811.74 525.998 796.588 549.353 771.492 549.353H771.24Z"
			fill="#000"
		/>
	</svg>
);

export const VisualStudioCode: ExternalEditorIcon = (props) => {
	const id = useId();
	const maskId = `${id}-vscode-a`;
	const topShadowFilterId = `${id}-vscode-b`;
	const sideShadowFilterId = `${id}-vscode-c`;
	const overlayGradientId = `${id}-vscode-d`;

	return (
		<svg {...props} fill="none" viewBox="0 0 100 100">
			<mask id={maskId} width="100" height="100" x="0" y="0" maskUnits="userSpaceOnUse">
				<path
					fill="#fff"
					fillRule="evenodd"
					d="M70.912 99.317a6.223 6.223 0 0 0 4.96-.19l20.589-9.907A6.25 6.25 0 0 0 100 83.587V16.413a6.25 6.25 0 0 0-3.54-5.632L75.874.874a6.226 6.226 0 0 0-7.104 1.21L29.355 38.04 12.187 25.01a4.162 4.162 0 0 0-5.318.236l-5.506 5.009a4.168 4.168 0 0 0-.004 6.162L16.247 50 1.36 63.583a4.168 4.168 0 0 0 .004 6.162l5.506 5.01a4.162 4.162 0 0 0 5.318.236l17.168-13.032L68.77 97.917a6.217 6.217 0 0 0 2.143 1.4ZM75.015 27.3 45.11 50l29.906 22.701V27.3Z"
					clipRule="evenodd"
				/>
			</mask>
			<g mask={`url(#${maskId})`}>
				<path
					fill="#0065A9"
					d="M96.461 10.796 75.857.876a6.23 6.23 0 0 0-7.107 1.207l-67.451 61.5a4.167 4.167 0 0 0 .004 6.162l5.51 5.009a4.167 4.167 0 0 0 5.32.236l81.228-61.62c2.725-2.067 6.639-.124 6.639 3.297v-.24a6.25 6.25 0 0 0-3.539-5.63Z"
				/>
				<g filter={`url(#${topShadowFilterId})`}>
					<path
						fill="#007ACC"
						d="m96.461 89.204-20.604 9.92a6.229 6.229 0 0 1-7.107-1.207l-67.451-61.5a4.167 4.167 0 0 1 .004-6.162l5.51-5.009a4.167 4.167 0 0 1 5.32-.236l81.228 61.62c2.725 2.067 6.639.124 6.639-3.297v.24a6.25 6.25 0 0 1-3.539 5.63Z"
					/>
				</g>
				<g filter={`url(#${sideShadowFilterId})`}>
					<path
						fill="#1F9CF0"
						d="M75.858 99.126a6.232 6.232 0 0 1-7.108-1.21c2.306 2.307 6.25.674 6.25-2.588V4.672c0-3.262-3.944-4.895-6.25-2.589a6.232 6.232 0 0 1 7.108-1.21l20.6 9.908A6.25 6.25 0 0 1 100 16.413v67.174a6.25 6.25 0 0 1-3.541 5.633l-20.601 9.906Z"
					/>
				</g>
				<path
					fill={`url(#${overlayGradientId})`}
					fillRule="evenodd"
					d="M70.851 99.317a6.224 6.224 0 0 0 4.96-.19L96.4 89.22a6.25 6.25 0 0 0 3.54-5.633V16.413a6.25 6.25 0 0 0-3.54-5.632L75.812.874a6.226 6.226 0 0 0-7.104 1.21L29.294 38.04 12.126 25.01a4.162 4.162 0 0 0-5.317.236l-5.507 5.009a4.168 4.168 0 0 0-.004 6.162L16.186 50 1.298 63.583a4.168 4.168 0 0 0 .004 6.162l5.507 5.009a4.162 4.162 0 0 0 5.317.236L29.294 61.96l39.414 35.958a6.218 6.218 0 0 0 2.143 1.4ZM74.954 27.3 45.048 50l29.906 22.701V27.3Z"
					clipRule="evenodd"
					opacity=".25"
					style={{ mixBlendMode: "overlay" }}
				/>
			</g>
			<defs>
				<filter
					id={topShadowFilterId}
					width="116.727"
					height="92.246"
					x="-8.394"
					y="15.829"
					colorInterpolationFilters="sRGB"
					filterUnits="userSpaceOnUse"
				>
					<feFlood floodOpacity="0" result="BackgroundImageFix" />
					<feColorMatrix in="SourceAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
					<feOffset />
					<feGaussianBlur stdDeviation="4.167" />
					<feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
					<feBlend in2="BackgroundImageFix" mode="overlay" result="effect1_dropShadow" />
					<feBlend in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
				</filter>
				<filter
					id={sideShadowFilterId}
					width="47.917"
					height="116.151"
					x="60.417"
					y="-8.076"
					colorInterpolationFilters="sRGB"
					filterUnits="userSpaceOnUse"
				>
					<feFlood floodOpacity="0" result="BackgroundImageFix" />
					<feColorMatrix in="SourceAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
					<feOffset />
					<feGaussianBlur stdDeviation="4.167" />
					<feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
					<feBlend in2="BackgroundImageFix" mode="overlay" result="effect1_dropShadow" />
					<feBlend in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
				</filter>
				<linearGradient
					id={overlayGradientId}
					x1="49.939"
					x2="49.939"
					y1=".258"
					y2="99.742"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor="#fff" />
					<stop offset="1" stopColor="#fff" stopOpacity="0" />
				</linearGradient>
			</defs>
		</svg>
	);
};

export const VisualStudioCodeInsiders: ExternalEditorIcon = (props) => {
	const id = useId();
	const maskId = `${id}-vscode-insiders-a`;
	const topShadowFilterId = `${id}-vscode-insiders-b`;
	const sideShadowFilterId = `${id}-vscode-insiders-c`;
	const overlayGradientId = `${id}-vscode-insiders-d`;

	return (
		<svg {...props} fill="none" viewBox="0 0 100 100">
			<mask id={maskId} width="100" height="100" x="0" y="0" maskUnits="userSpaceOnUse">
				<path
					fill="#fff"
					fillRule="evenodd"
					d="M70.912 99.317a6.223 6.223 0 0 0 4.96-.19l20.589-9.907A6.25 6.25 0 0 0 100 83.587V16.413a6.25 6.25 0 0 0-3.54-5.632L75.874.874a6.226 6.226 0 0 0-7.104 1.21L29.355 38.04 12.187 25.01a4.162 4.162 0 0 0-5.318.236l-5.506 5.009a4.168 4.168 0 0 0-.004 6.162L16.247 50 1.36 63.583a4.168 4.168 0 0 0 .004 6.162l5.506 5.01a4.162 4.162 0 0 0 5.318.236l17.168-13.032L68.77 97.917a6.217 6.217 0 0 0 2.143 1.4ZM75.015 27.3 45.11 50l29.906 22.701V27.3Z"
					clipRule="evenodd"
				/>
			</mask>
			<g mask={`url(#${maskId})`}>
				<path
					fill="#009a7c"
					d="M96.461 10.796 75.857.876a6.23 6.23 0 0 0-7.107 1.207l-67.451 61.5a4.167 4.167 0 0 0 .004 6.162l5.51 5.009a4.167 4.167 0 0 0 5.32.236l81.228-61.62c2.725-2.067 6.639-.124 6.639 3.297v-.24a6.25 6.25 0 0 0-3.539-5.63Z"
				/>
				<g filter={`url(#${topShadowFilterId})`}>
					<path
						fill="#00b294"
						d="m96.461 89.204-20.604 9.92a6.229 6.229 0 0 1-7.107-1.207l-67.451-61.5a4.167 4.167 0 0 1 .004-6.162l5.51-5.009a4.167 4.167 0 0 1 5.32-.236l81.228 61.62c2.725 2.067 6.639.124 6.639-3.297v.24a6.25 6.25 0 0 1-3.539 5.63Z"
					/>
				</g>
				<g filter={`url(#${sideShadowFilterId})`}>
					<path
						fill="#24bfa5"
						d="M75.858 99.126a6.232 6.232 0 0 1-7.108-1.21c2.306 2.307 6.25.674 6.25-2.588V4.672c0-3.262-3.944-4.895-6.25-2.589a6.232 6.232 0 0 1 7.108-1.21l20.6 9.908A6.25 6.25 0 0 1 100 16.413v67.174a6.25 6.25 0 0 1-3.541 5.633l-20.601 9.906Z"
					/>
				</g>
				<path
					fill={`url(#${overlayGradientId})`}
					fillRule="evenodd"
					d="M70.851 99.317a6.224 6.224 0 0 0 4.96-.19L96.4 89.22a6.25 6.25 0 0 0 3.54-5.633V16.413a6.25 6.25 0 0 0-3.54-5.632L75.812.874a6.226 6.226 0 0 0-7.104 1.21L29.294 38.04 12.126 25.01a4.162 4.162 0 0 0-5.317.236l-5.507 5.009a4.168 4.168 0 0 0-.004 6.162L16.186 50 1.298 63.583a4.168 4.168 0 0 0 .004 6.162l5.507 5.009a4.162 4.162 0 0 0 5.317.236L29.294 61.96l39.414 35.958a6.218 6.218 0 0 0 2.143 1.4ZM74.954 27.3 45.048 50l29.906 22.701V27.3Z"
					clipRule="evenodd"
					opacity=".25"
					style={{ mixBlendMode: "overlay" }}
				/>
			</g>
			<defs>
				<filter
					id={topShadowFilterId}
					width="116.727"
					height="92.246"
					x="-8.394"
					y="15.829"
					colorInterpolationFilters="sRGB"
					filterUnits="userSpaceOnUse"
				>
					<feFlood floodOpacity="0" result="BackgroundImageFix" />
					<feColorMatrix in="SourceAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
					<feOffset />
					<feGaussianBlur stdDeviation="4.167" />
					<feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
					<feBlend in2="BackgroundImageFix" mode="overlay" result="effect1_dropShadow" />
					<feBlend in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
				</filter>
				<filter
					id={sideShadowFilterId}
					width="47.917"
					height="116.151"
					x="60.417"
					y="-8.076"
					colorInterpolationFilters="sRGB"
					filterUnits="userSpaceOnUse"
				>
					<feFlood floodOpacity="0" result="BackgroundImageFix" />
					<feColorMatrix in="SourceAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
					<feOffset />
					<feGaussianBlur stdDeviation="4.167" />
					<feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
					<feBlend in2="BackgroundImageFix" mode="overlay" result="effect1_dropShadow" />
					<feBlend in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
				</filter>
				<linearGradient
					id={overlayGradientId}
					x1="49.939"
					x2="49.939"
					y1=".258"
					y2="99.742"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor="#fff" />
					<stop offset="1" stopColor="#fff" stopOpacity="0" />
				</linearGradient>
			</defs>
		</svg>
	);
};

export const VSCodium: ExternalEditorIcon = (props) => {
	const id = useId();
	const gradientId = `${id}-vscodium-gradient`;

	return (
		<svg {...props} viewBox="0 0 100 100">
			<defs>
				<linearGradient
					id={gradientId}
					x1="0"
					x2="100"
					y1="0"
					y2="100"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset="0" stopColor="#62A0EA" />
					<stop offset="1" stopColor="#1A5FB4" />
				</linearGradient>
			</defs>
			<path
				fill={`url(#${gradientId})`}
				d="M48.26 2.274C45.406 4.105 44.583 7.898 46.422 10.742C56.531 26.397 58.917 38.205 57.882 48.553C53.698 68.369 44.603 72.389 36.655 72.389C28.895 72.389 30.973 59.618 36.806 55.88C40.288 53.706 44.748 52.293 48.171 52.293C51.563 52.293 54.313 49.552 54.313 46.17C54.313 42.787 51.563 40.046 48.171 40.046C44.173 40.046 40.251 40.886 36.59 42.316C37.338 38.787 37.614 34.973 36.647 30.919C35.179 24.763 30.953 18.883 23.615 13.183C22.33 12.183 20.7 11.734 19.083 11.934C17.466 12.134 15.995 12.966 14.994 14.248C12.912 16.918 13.394 20.766 16.072 22.843C22.05 27.486 24.024 30.923 24.699 33.752C25.374 36.581 24.831 39.616 23.475 43.786C21.742 49.406 19.73 54.423 18.848 59.234C18.414 61.602 18.377 64.179 18.265 66.238C13.96 62.042 12.275 56.502 12.275 48.407C12.274 45.025 9.524 42.283 6.133 42.284C2.744 42.287-0.002 45.027-0.003 48.407C-0.003 59.463 3.23 69.983 11.895 77.001C19.739 84.474 39.686 81.712 39.686 93.709C39.686 97.095 44.642 98.743 48.033 98.743C51.511 98.743 55.888 96.418 55.888 93.709C55.888 80.097 70.233 71.824 93.848 71.86C97.24 71.865 99.992 69.126 99.997 65.744C100.003 62.361 97.259 59.614 93.867 59.608C92.252 59.606 90.678 59.661 89.126 59.753C91.766 53.544 92.937 46.708 92.695 39.324C92.583 35.943 89.745 33.293 86.356 33.403C82.963 33.513 80.305 36.346 80.416 39.729C80.736 49.397 80.374 58.03 73.171 62.581C71.123 63.874 68.742 64.996 66.484 64.996C68.237 60.228 69.561 55.195 70.103 49.77C70.449 46.308 70.486 42.195 70.091 39C69.478 34.05 68.738 28.436 70.617 24.207C72.305 20.565 76.087 19.04 81.64 19.04C85.029 19.037 87.775 16.296 87.776 12.917C87.778 9.534 85.031 6.79 81.64 6.787C73.388 6.787 67.133 11.13 63.587 16.377C61.733 12.417 59.475 8.336 56.747 4.112C55.866 2.747 54.478 1.788 52.887 1.443C52.099 1.272 51.285 1.257 50.491 1.399C49.697 1.542 48.939 1.839 48.26 2.274z"
			/>
		</svg>
	);
};

export const Zed: ExternalEditorIcon = (props) => {
	const id = useId();
	const clipPathId = `${id}-zed-logo-a`;

	return (
		<svg {...props} fill="none" viewBox="0 0 96 96">
			<g clipPath={`url(#${clipPathId})`}>
				<path
					fill="currentColor"
					fillRule="evenodd"
					d="M9 6a3 3 0 0 0-3 3v66H0V9a9 9 0 0 1 9-9h80.379c4.009 0 6.016 4.847 3.182 7.682L43.055 57.187H57V51h6v7.688a4.5 4.5 0 0 1-4.5 4.5H37.055L26.743 73.5H73.5V36h6v37.5a6 6 0 0 1-6 6H20.743L10.243 90H87a3 3 0 0 0 3-3V21h6v66a9 9 0 0 1-9 9H6.621c-4.009 0-6.016-4.847-3.182-7.682L52.757 39H39v6h-6v-7.5a4.5 4.5 0 0 1 4.5-4.5h21.257l10.5-10.5H22.5V60h-6V22.5a6 6 0 0 1 6-6h52.757L85.757 6H9Z"
					clipRule="evenodd"
				/>
			</g>
			<defs>
				<clipPath id={clipPathId}>
					<path fill="#fff" d="M0 0h96v96H0z" />
				</clipPath>
			</defs>
		</svg>
	);
};

const ANTIGRAVITY_ICON_DATA_URL =
	"data:image/png;base64,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";

export const AntigravityIcon: ExternalEditorIcon = (props) => (
	<svg {...props} viewBox="0 0 128 128" fill="none">
		<image href={ANTIGRAVITY_ICON_DATA_URL} width="128" height="128" />
	</svg>
);

export const AquaIcon: ExternalEditorIcon = (props) => {
	const [gradientAId, gradientBId] = useSvgGradientIds("aqua", 2);

	return (
		<svg {...props} viewBox="0 0 64 64" fill="none">
			<defs>
				<linearGradient
					id={gradientAId}
					x1="59.932"
					x2="1.336"
					y1="59.676"
					y2="1.079"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".25" stopColor="#7256FF" />
					<stop offset=".73" stopColor="#007DFE" />
				</linearGradient>
				<linearGradient
					id={gradientBId}
					x1="7.671"
					x2="61.125"
					y1="64.392"
					y2="39.609"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".3" stopColor="#00D886" />
					<stop offset=".54" stopColor="#7256FF" />
				</linearGradient>
			</defs>
			<path
				fill={`url(#${gradientAId})`}
				d="M0 4.125v34.128c0 1.658.993 3.154 2.52 3.8L39.943 57.85c.518.219 1.075.33 1.638.324l18.329-.15A4.125 4.125 0 0 0 64 53.9V36.234c0-.806-.236-1.593-.678-2.267L42.213 1.86A4.13 4.13 0 0 0 38.766 0H4.125A4.125 4.125 0 0 0 0 4.125"
			/>
			<path
				fill={`url(#${gradientBId})`}
				d="M6 49.015v10.862a4.125 4.125 0 0 0 4.125 4.125h12.566q.3 0 .598-.044l37.185-5.448A4.125 4.125 0 0 0 64 54.429V39.03a4.125 4.125 0 0 0-4.127-4.125l-18.504.005c-.426 0-.849.066-1.254.195L8.871 45.085A4.13 4.13 0 0 0 6 49.015z"
			/>
			<path
				fill="#00D886"
				d="M6 47.55v12.259a4.125 4.125 0 0 0 4.19 4.124L21 64c1.181-.019 2.531-.786 3.3-1.683l32.707-38.158c.64-.748.993-1.7.993-2.685V10.125A4.125 4.125 0 0 0 53.875 6H42.872c-1.19 0-2.321.514-3.105 1.409L7.021 44.834A4.12 4.12 0 0 0 6 47.55"
			/>
			<path fill="#000" d="M52 12H12v40h40z" />
			<path
				fill="#fff"
				d="M33 44H17v3h16zM20.746 31.243a7.3 7.3 0 0 1-2.755-2.787q-1.002-1.774-1.003-3.961c0-2.187.334-2.778 1.003-3.96a7.3 7.3 0 0 1 2.755-2.787q1.752-1.013 3.917-1.014c1.443 0 2.739.338 3.907 1.013a7.3 7.3 0 0 1 2.75 2.787q.996 1.774.996 3.961c0 2.187-.332 2.778-.997 3.96a7.3 7.3 0 0 1-2.749 2.788q-1.752 1.013-3.907 1.013c-1.436 0-2.75-.338-3.917-1.013m6.308-2.23q1.06-.67 1.661-1.854.6-1.185.6-2.664t-.6-2.664a4.6 4.6 0 0 0-1.661-1.854q-1.061-.67-2.39-.67t-2.396.67a4.6 4.6 0 0 0-1.672 1.854q-.605 1.185-.605 2.664t.605 2.664 1.672 1.854q1.067.67 2.396.67 1.33 0 2.39-.67m-2.16 6.034a2.67 2.67 0 0 1-1.126-1.077q-.391-.696-.391-1.64l-.01-1.94h2.743v1.811q0 .332.129.573.128.242.37.365.24.123.574.123h1.833v2.165h-2.412q-.975 0-1.71-.38M38.233 16.992h3.173l5.563 15.006h-2.947l-1.212-3.483h-5.842l-1.136 3.483H32.82zm3.805 9.261-2.025-5.723-.225-.954-.215.954-1.908 5.723z"
			/>
		</svg>
	);
};

export const CLionIcon: ExternalEditorIcon = (props) => {
	const [gradientAId, gradientBId] = useSvgGradientIds("clion", 2);

	return (
		<svg {...props} viewBox="0 0 64 64" fill="none">
			<defs>
				<linearGradient
					id={gradientAId}
					x1="4.067"
					x2="62.664"
					y1="4.327"
					y2="62.923"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".29" stopColor="#009AE5" />
					<stop offset=".7" stopColor="#00D980" />
				</linearGradient>
				<linearGradient
					id={gradientBId}
					x1="56.329"
					x2="2.874"
					y1="-.391"
					y2="24.393"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".3" stopColor="#FF2D90" />
					<stop offset=".54" stopColor="#009AE5" />
				</linearGradient>
			</defs>
			<path
				fill={`url(#${gradientAId})`}
				d="M64 59.878V25.75a4.13 4.13 0 0 0-2.52-3.8L24.057 6.153a4.1 4.1 0 0 0-1.638-.325l-18.329.15A4.124 4.124 0 0 0 0 10.103v17.665c0 .806.236 1.593.678 2.267l21.109 32.109a4.12 4.12 0 0 0 3.447 1.859h34.641A4.125 4.125 0 0 0 64 59.878"
			/>
			<path
				fill={`url(#${gradientBId})`}
				d="M58 14.988V4.125A4.125 4.125 0 0 0 53.875 0H41.309q-.3 0-.598.044L3.527 5.492A4.125 4.125 0 0 0 0 9.573v15.398a4.125 4.125 0 0 0 4.126 4.125l18.505-.005c.425 0 .848-.066 1.253-.195l31.246-9.98A4.13 4.13 0 0 0 58 14.988"
			/>
			<path
				fill="#FF2D90"
				d="M58 16.453V4.194A4.125 4.125 0 0 0 53.81.07L43.003.008c-1.18.019-2.535.781-3.304 1.678L6.993 39.844c-.64.748-.993 1.7-.993 2.684v11.35a4.125 4.125 0 0 0 4.125 4.125h11.003c1.19 0 2.321-.514 3.105-1.409L56.979 19.17A4.12 4.12 0 0 0 58 16.453"
			/>
			<path fill="#000" d="M52 12H12v40h40z" />
			<path
				fill="#fff"
				d="M33 44H17v3h16zM20.747 31.243a7.3 7.3 0 0 1-2.744-2.787q-.997-1.774-.997-3.961c0-2.187.332-2.778.997-3.96a7.3 7.3 0 0 1 2.744-2.787q1.747-1.013 3.901-1.014 1.823 0 3.345.675a6.86 6.86 0 0 1 2.535 1.892 6.44 6.44 0 0 1 1.355 2.793h-3.065a4.05 4.05 0 0 0-.895-1.431 4 4 0 0 0-1.431-.95 4.9 4.9 0 0 0-1.822-.332q-1.33 0-2.402.665a4.6 4.6 0 0 0-1.677 1.827q-.606 1.164-.606 2.62 0 1.459.606 2.621a4.6 4.6 0 0 0 1.677 1.828q1.072.664 2.402.664a4.9 4.9 0 0 0 1.822-.332 4.02 4.02 0 0 0 2.326-2.38h3.065a6.44 6.44 0 0 1-1.355 2.792 6.86 6.86 0 0 1-2.535 1.892q-1.522.675-3.345.675-2.154 0-3.901-1.013zM37.33 16.992v12.37h7.117v2.636H34.414V16.992z"
			/>
		</svg>
	);
};

export const DataGripIcon: ExternalEditorIcon = (props) => {
	const [gradientAId, gradientBId] = useSvgGradientIds("datagrip", 2);

	return (
		<svg {...props} viewBox="0 0 64 64" fill="none">
			<defs>
				<linearGradient
					id={gradientAId}
					x1="59.676"
					x2="1.08"
					y1="4.067"
					y2="62.663"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".28" stopColor="#7256FF" />
					<stop offset=".66" stopColor="#00D980" />
				</linearGradient>
				<linearGradient
					id={gradientBId}
					x1="64.391"
					x2="39.607"
					y1="56.329"
					y2="2.874"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".3" stopColor="#FF43F2" />
					<stop offset=".54" stopColor="#7256FF" />
				</linearGradient>
			</defs>
			<path
				fill={`url(#${gradientAId})`}
				d="M4.125 64h34.128a4.13 4.13 0 0 0 3.8-2.52L57.85 24.057c.219-.518.33-1.076.324-1.638l-.15-18.329A4.125 4.125 0 0 0 53.9 0H36.234c-.806 0-1.593.236-2.267.678L1.86 21.787A4.13 4.13 0 0 0 0 25.234v34.641A4.125 4.125 0 0 0 4.125 64"
			/>
			<path
				fill={`url(#${gradientBId})`}
				d="M49.013 58h10.862A4.125 4.125 0 0 0 64 53.875V41.309q0-.3-.044-.598L58.508 3.527A4.125 4.125 0 0 0 54.427 0H39.029a4.125 4.125 0 0 0-4.125 4.126l.005 18.505c0 .425.066.848.195 1.253l9.979 31.246a4.13 4.13 0 0 0 3.93 2.87"
			/>
			<path
				fill="#FF43F2"
				d="M47.55 58h12.259a4.125 4.125 0 0 0 4.124-4.19L64 43c-.018-1.181-.785-2.531-1.682-3.3L24.159 6.993A4.13 4.13 0 0 0 21.474 6H10.125A4.125 4.125 0 0 0 6 10.125v11.003c0 1.19.514 2.321 1.409 3.105l37.425 32.746A4.12 4.12 0 0 0 47.55 58"
			/>
			<path fill="#000" d="M52 12H12v40h40z" />
			<path
				fill="#fff"
				d="M33 44H17v3h16zM17.012 16.992h5.713q2.133 0 3.821.965a6.9 6.9 0 0 1 2.642 2.674q.954 1.71.954 3.864t-.954 3.865a6.9 6.9 0 0 1-2.642 2.674q-1.688.964-3.821.964h-5.713zm8.028 11.876q1.008-.6 1.554-1.72.547-1.12.547-2.653 0-1.534-.547-2.653-.546-1.12-1.554-1.721-1.008-.6-2.348-.6h-2.755v9.947h2.755q1.34 0 2.348-.6M35.426 31.243a7.3 7.3 0 0 1-2.744-2.787q-.997-1.774-.997-3.961c0-2.187.333-2.778.997-3.96s1.58-2.112 2.744-2.787q1.747-1.013 3.902-1.014 1.746 0 3.221.622a6.9 6.9 0 0 1 2.487 1.747 6.36 6.36 0 0 1 1.42 2.594h-3.13a3.9 3.9 0 0 0-.927-1.228q-.585-.52-1.367-.803c-.782-.283-1.082-.284-1.683-.284q-1.329 0-2.401.664a4.6 4.6 0 0 0-1.678 1.828q-.605 1.163-.605 2.62c0 1.457.202 1.846.605 2.621a4.6 4.6 0 0 0 1.678 1.828q1.072.664 2.401.664 1.233 0 2.235-.461t1.592-1.276a3.3 3.3 0 0 0 .633-1.833l.01.31h-3.526v-2.304h6.356v1.18q0 1.982-.96 3.585a6.9 6.9 0 0 1-2.625 2.525q-1.668.921-3.736.921c-1.38 0-2.737-.337-3.902-1.013z"
			/>
		</svg>
	);
};

export const DataSpellIcon: ExternalEditorIcon = (props) => {
	const [gradientAId, gradientBId] = useSvgGradientIds("dataspell", 2);

	return (
		<svg {...props} viewBox="0 0 64 64" fill="none">
			<defs>
				<linearGradient
					id={gradientAId}
					x1="4.067"
					x2="62.664"
					y1="4.327"
					y2="62.923"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".28" stopColor="#007DFE" />
					<stop offset=".73" stopColor="#00D980" />
				</linearGradient>
				<linearGradient
					id={gradientBId}
					x1="56.329"
					x2="2.875"
					y1="-.391"
					y2="24.392"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".32" stopColor="#F0EB18" />
					<stop offset=".55" stopColor="#007DFE" />
				</linearGradient>
			</defs>
			<path
				fill={`url(#${gradientAId})`}
				d="M64 59.878V25.75a4.13 4.13 0 0 0-2.52-3.8L24.057 6.153a4.1 4.1 0 0 0-1.638-.325l-18.329.15A4.124 4.124 0 0 0 0 10.103v17.665c0 .806.236 1.593.678 2.267l21.109 32.109a4.12 4.12 0 0 0 3.447 1.859h34.641A4.125 4.125 0 0 0 64 59.878"
			/>
			<path
				fill={`url(#${gradientBId})`}
				d="M58 14.988V4.125A4.125 4.125 0 0 0 53.875 0H41.309q-.3 0-.598.044L3.527 5.492A4.125 4.125 0 0 0 0 9.573v15.398a4.125 4.125 0 0 0 4.126 4.125l18.505-.005c.425 0 .848-.066 1.253-.195l31.246-9.98A4.13 4.13 0 0 0 58 14.988"
			/>
			<path
				fill="#F0EB18"
				d="M58 16.45V4.191A4.125 4.125 0 0 0 53.81.067L43 0c-1.181.019-2.531.786-3.3 1.683L6.993 39.84c-.64.748-.993 1.7-.993 2.685v11.349A4.125 4.125 0 0 0 10.125 58h11.003c1.19 0 2.321-.514 3.105-1.409l32.746-37.425A4.12 4.12 0 0 0 58 16.45"
			/>
			<path fill="#000" d="M52 12H12v40h40z" />
			<path
				fill="#fff"
				d="M33 44H17v3h16zM17.012 16.992h5.713q2.133 0 3.821.965a6.9 6.9 0 0 1 2.642 2.674q.954 1.71.954 3.864t-.954 3.865a6.9 6.9 0 0 1-2.642 2.674q-1.688.964-3.821.964h-5.713zm8.028 11.876q1.008-.6 1.554-1.72.547-1.12.547-2.653 0-1.534-.547-2.653-.546-1.12-1.554-1.721-1.008-.6-2.348-.6h-2.755v9.947h2.755q1.34 0 2.348-.6M34.713 31.664q-1.26-.59-1.973-1.65t-.734-2.444h2.937q0 .654.343 1.147t.954.772q.61.278 1.404.278c.53 0 .952-.083 1.334-.251q.574-.252.89-.702t.316-1.029q0-.718-.434-1.19-.435-.471-1.195-.654l-2.648-.59q-1.071-.234-1.865-.809a4 4 0 0 1-1.232-1.42q-.44-.846-.44-1.908 0-1.286.665-2.31.664-1.023 1.854-1.597 1.19-.573 2.701-.573c1.511 0 1.933.186 2.733.558s1.424.888 1.871 1.549q.67.99.68 2.277h-2.926q0-.546-.289-.98c-.289-.435-.466-.515-.82-.676a2.9 2.9 0 0 0-1.217-.24q-.686 0-1.205.23a1.9 1.9 0 0 0-.81.643q-.29.412-.29.96 0 .621.403 1.028.402.407 1.098.579l2.552.557q1.103.226 1.967.852a4.45 4.45 0 0 1 1.345 1.544q.481.917.482 1.999 0 1.329-.702 2.385-.702 1.054-1.967 1.656-1.265.6-2.894.6t-2.889-.59"
			/>
		</svg>
	);
};

export const GoLandIcon: ExternalEditorIcon = (props) => {
	const [gradientAId, gradientBId] = useSvgGradientIds("goland", 2);

	return (
		<svg {...props} viewBox="0 0 64 64" fill="none">
			<defs>
				<linearGradient
					id={gradientAId}
					x1="64.391"
					x2="39.607"
					y1="56.329"
					y2="2.874"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".24" stopColor="#00D886" />
					<stop offset=".51" stopColor="#007DFE" />
				</linearGradient>
				<linearGradient
					id={gradientBId}
					x1="59.676"
					x2="1.08"
					y1="4.067"
					y2="62.663"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".27" stopColor="#007DFE" />
					<stop offset=".7" stopColor="#D249FC" />
				</linearGradient>
			</defs>
			<path
				fill="#00D886"
				d="M47.55 58h12.259a4.125 4.125 0 0 0 4.124-4.19l-.176-11.044a4.13 4.13 0 0 0-1.44-3.066L24.159 6.993A4.13 4.13 0 0 0 21.474 6H10.125A4.125 4.125 0 0 0 6 10.125v11.003c0 1.19.514 2.321 1.409 3.105l37.425 32.746A4.12 4.12 0 0 0 47.55 58"
			/>
			<path
				fill={`url(#${gradientAId})`}
				d="M49.013 58h10.862A4.125 4.125 0 0 0 64 53.875V41.309q0-.3-.044-.598L58.508 3.527A4.124 4.124 0 0 0 54.427 0H39.029a4.125 4.125 0 0 0-4.125 4.126l.005 18.505c0 .425.066.848.195 1.253l9.979 31.246a4.13 4.13 0 0 0 3.93 2.87"
			/>
			<path
				fill={`url(#${gradientBId})`}
				d="M4.125 64h34.128a4.13 4.13 0 0 0 3.8-2.52L57.85 24.057c.219-.518.33-1.076.324-1.638l-.15-18.329A4.124 4.124 0 0 0 53.9 0H36.234c-.805 0-1.593.236-2.266.678L1.86 21.787A4.13 4.13 0 0 0 0 25.234v34.641A4.125 4.125 0 0 0 4.125 64"
			/>
			<path fill="#000" d="M52 12H12v40h40z" />
			<path
				fill="#fff"
				d="M19.748 31.243a7.3 7.3 0 0 1-2.743-2.787q-.997-1.774-.997-3.961c0-2.187.332-2.778.997-3.96s1.58-2.112 2.743-2.787q1.747-1.013 3.902-1.014 1.747 0 3.222.622a6.9 6.9 0 0 1 2.486 1.747 6.4 6.4 0 0 1 1.42 2.594h-3.13a3.9 3.9 0 0 0-.926-1.228q-.584-.52-1.367-.803c-.783-.283-1.083-.284-1.683-.284q-1.33 0-2.402.664a4.6 4.6 0 0 0-1.677 1.828q-.606 1.163-.606 2.62c0 1.457.202 1.846.606 2.621a4.6 4.6 0 0 0 1.677 1.828q1.072.664 2.402.664 1.232 0 2.235-.461t1.591-1.276a3.3 3.3 0 0 0 .633-1.833l.01.31h-3.526v-2.304h6.357v1.18q0 1.982-.96 3.585a6.9 6.9 0 0 1-2.626 2.525q-1.666.921-3.736.921c-2.07 0-2.737-.337-3.902-1.013zM36.271 31.243a7.3 7.3 0 0 1-2.755-2.787q-1.002-1.774-1.002-3.961c0-2.187.333-2.778 1.002-3.96a7.3 7.3 0 0 1 2.755-2.787q1.752-1.013 3.918-1.014c1.443 0 2.738.338 3.907 1.013a7.3 7.3 0 0 1 2.749 2.787q.996 1.774.997 3.961c0 2.187-.333 2.778-.997 3.96s-1.581 2.113-2.75 2.788q-1.752 1.013-3.906 1.013c-1.437 0-2.75-.338-3.918-1.013m6.308-2.23q1.062-.67 1.662-1.854t.6-2.664-.6-2.664-1.662-1.854-2.39-.67-2.395.67a4.6 4.6 0 0 0-1.672 1.854q-.606 1.185-.606 2.664t.606 2.664 1.672 1.854 2.395.67q1.33 0 2.39-.67M33 44H17v3h16z"
			/>
		</svg>
	);
};

export const IntelliJIdeaIcon: ExternalEditorIcon = (props) => {
	const [gradientAId, gradientBId] = useSvgGradientIds("intellij-idea", 2);

	return (
		<svg {...props} viewBox="0 0 64 64" fill="none">
			<defs>
				<linearGradient
					id={gradientAId}
					x1="-.391"
					x2="24.392"
					y1="7.671"
					y2="61.126"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".1" stopColor="#FC801D" />
					<stop offset=".59" stopColor="#FE2857" />
				</linearGradient>
				<linearGradient
					id={gradientBId}
					x1="4.325"
					x2="62.921"
					y1="59.932"
					y2="1.336"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".21" stopColor="#FE2857" />
					<stop offset=".7" stopColor="#007EFF" />
				</linearGradient>
			</defs>
			<path
				fill="#FF8100"
				d="M16.45 6H4.191a4.125 4.125 0 0 0-4.124 4.19l.176 11.044a4.13 4.13 0 0 0 1.44 3.066l38.159 32.707c.747.64 1.7.993 2.684.993h11.35A4.125 4.125 0 0 0 58 53.875V42.872c0-1.19-.514-2.321-1.41-3.105L19.167 7.021A4.12 4.12 0 0 0 16.45 6"
			/>
			<path
				fill={`url(#${gradientAId})`}
				d="M14.988 6H4.125A4.125 4.125 0 0 0 0 10.125v12.566q0 .3.044.598l5.448 37.185A4.125 4.125 0 0 0 9.573 64h15.398a4.125 4.125 0 0 0 4.125-4.127L29.09 41.37c0-.426-.066-.849-.195-1.254l-9.98-31.245A4.13 4.13 0 0 0 14.988 6z"
			/>
			<path
				fill={`url(#${gradientBId})`}
				d="M59.876 0H25.748a4.13 4.13 0 0 0-3.8 2.52L6.151 39.943a4.1 4.1 0 0 0-.325 1.638l.15 18.329A4.125 4.125 0 0 0 10.101 64h17.666c.806 0 1.593-.236 2.266-.678l32.11-21.109A4.12 4.12 0 0 0 64 38.766V4.125A4.125 4.125 0 0 0 59.876 0"
			/>
			<path fill="#000" d="M52 12H12v40h40z" />
			<path
				fill="#fff"
				d="M33 44H17v3h16zM17 29.383h2.98v-9.775H17v-2.616h8.843v2.616h-2.98v9.775h2.98V32H17zM27.643 29.298h2.154a2.4 2.4 0 0 0 1.163-.279q.51-.279.788-.788.279-.51.279-1.163V16.992h2.926v10.28q0 1.35-.622 2.427a4.45 4.45 0 0 1-1.715 1.688q-1.092.612-2.454.611h-2.519z"
			/>
		</svg>
	);
};

export const PhpStormIcon: ExternalEditorIcon = (props) => {
	const [gradientAId, gradientBId] = useSvgGradientIds("phpstorm", 2);

	return (
		<svg {...props} viewBox="0 0 64 64" fill="none">
			<defs>
				<linearGradient
					id={gradientAId}
					x1="56.329"
					x2="2.874"
					y1="-.391"
					y2="24.392"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".16" stopColor="#D249FC" />
					<stop offset=".55" stopColor="#FF2D90" />
				</linearGradient>
				<linearGradient
					id={gradientBId}
					x1="4.067"
					x2="62.664"
					y1="4.326"
					y2="62.923"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".3" stopColor="#FF2D90" />
					<stop offset=".7" stopColor="#7256FF" />
				</linearGradient>
			</defs>
			<path
				fill="#D249FC"
				d="M58 16.446V4.187A4.125 4.125 0 0 0 53.81.063L42.765.239A4.13 4.13 0 0 0 39.7 1.68L6.993 39.837c-.64.748-.993 1.7-.993 2.685v11.35a4.125 4.125 0 0 0 4.125 4.124h11.003c1.19 0 2.321-.514 3.105-1.409l32.746-37.425A4.12 4.12 0 0 0 58 16.446"
			/>
			<path
				fill={`url(#${gradientAId})`}
				d="M58 14.988V4.125A4.125 4.125 0 0 0 53.875 0H41.309q-.3 0-.598.044L3.527 5.492A4.125 4.125 0 0 0 0 9.573v15.398a4.125 4.125 0 0 0 4.126 4.125l18.505-.005c.425 0 .848-.066 1.253-.195l31.246-9.98A4.13 4.13 0 0 0 58 14.988"
			/>
			<path
				fill={`url(#${gradientBId})`}
				d="M64 59.878V25.75a4.13 4.13 0 0 0-2.52-3.8L24.057 6.153a4.1 4.1 0 0 0-1.638-.325l-18.329.15A4.124 4.124 0 0 0 0 10.103v17.665c0 .806.236 1.593.678 2.267l21.109 32.109a4.12 4.12 0 0 0 3.447 1.859h34.641A4.125 4.125 0 0 0 64 59.878"
			/>
			<path fill="#000" d="M52 12H12v40h40z" />
			<path
				fill="#fff"
				d="M33 44H17v3h16zM16.993 16.992h6.442q1.586 0 2.78.579 1.196.579 1.845 1.63.648 1.05.648 2.432c0 .922-.22 1.759-.659 2.466q-.66 1.062-1.87 1.646-1.212.584-2.83.584h-3.43V32h-2.927zm7.54 6.63q.553-.273.852-.782.3-.51.3-1.195c0-.685-.1-.842-.3-1.174q-.3-.5-.852-.772-.552-.273-1.291-.273h-3.323v4.47h3.323q.74 0 1.291-.273M32.572 31.664q-1.26-.59-1.972-1.65t-.735-2.444h2.937q0 .654.343 1.147t.954.772q.611.278 1.404.278c.53 0 .952-.083 1.335-.251q.572-.252.89-.702c.317-.45.315-.643.315-1.029q0-.718-.434-1.19-.435-.471-1.195-.654l-2.647-.59q-1.073-.234-1.866-.809a4 4 0 0 1-1.232-1.42q-.44-.846-.44-1.908 0-1.286.665-2.31.665-1.023 1.854-1.597 1.19-.573 2.702-.573c1.512 0 1.933.186 2.733.558q1.2.558 1.87 1.549t.681 2.277h-2.926q0-.546-.29-.98a1.9 1.9 0 0 0-.82-.676 2.9 2.9 0 0 0-1.216-.24q-.687 0-1.206.23a1.9 1.9 0 0 0-.81.643q-.29.412-.289.96 0 .621.402 1.028t1.099.579l2.551.557q1.104.226 1.967.852a4.45 4.45 0 0 1 1.345 1.544q.482.917.482 1.999 0 1.329-.701 2.385-.703 1.054-1.967 1.656-1.264.6-2.895.6-1.63 0-2.888-.59"
			/>
		</svg>
	);
};

export const PyCharmIcon: ExternalEditorIcon = (props) => {
	const [gradientAId, gradientBId] = useSvgGradientIds("pycharm", 2);

	return (
		<svg {...props} viewBox="0 0 64 64" fill="none">
			<defs>
				<linearGradient
					id={gradientAId}
					x1="7.671"
					x2="61.126"
					y1="64.393"
					y2="39.609"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".1" stopColor="#00D886" />
					<stop offset=".59" stopColor="#F0EB18" />
				</linearGradient>
				<linearGradient
					id={gradientBId}
					x1="59.933"
					x2="1.337"
					y1="59.676"
					y2="1.08"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".3" stopColor="#F0EB18" />
					<stop offset=".7" stopColor="#00C4F4" />
				</linearGradient>
			</defs>
			<path
				fill="#00D886"
				d="M6 47.55v12.259a4.125 4.125 0 0 0 4.19 4.124l11.044-.176a4.13 4.13 0 0 0 3.066-1.44l32.707-38.158c.64-.748.993-1.7.993-2.685V10.125A4.125 4.125 0 0 0 53.875 6H42.872c-1.19 0-2.321.514-3.105 1.409L7.021 44.834A4.12 4.12 0 0 0 6 47.55"
			/>
			<path
				fill={`url(#${gradientAId})`}
				d="M6 49.015v10.862a4.125 4.125 0 0 0 4.125 4.125h12.566q.3 0 .598-.044l37.185-5.448A4.125 4.125 0 0 0 64 54.429V39.03a4.125 4.125 0 0 0-4.127-4.125l-18.504.005c-.426 0-.849.066-1.254.195L8.871 45.085A4.13 4.13 0 0 0 6 49.015z"
			/>
			<path
				fill={`url(#${gradientBId})`}
				d="M0 4.125v34.128c0 1.658.993 3.154 2.52 3.8L39.943 57.85c.518.219 1.075.33 1.638.324l18.329-.15A4.125 4.125 0 0 0 64 53.9V36.234c0-.806-.236-1.593-.678-2.267L42.213 1.86A4.13 4.13 0 0 0 38.766 0H4.125A4.125 4.125 0 0 0 0 4.125"
			/>
			<path fill="#000" d="M52 12H12v40h40z" />
			<path
				fill="#fff"
				d="M33 44H17v3h16zM16.993 16.992h6.442q1.586 0 2.78.579 1.196.579 1.845 1.63.648 1.05.648 2.432c0 .922-.22 1.759-.659 2.466q-.66 1.062-1.87 1.646-1.212.584-2.83.584h-3.43V32h-2.927zm7.54 6.63q.553-.273.852-.782.3-.51.3-1.195c0-.685-.1-.842-.3-1.174q-.3-.5-.852-.772-.552-.273-1.291-.273h-3.324v4.47h3.324q.74 0 1.291-.273M33.713 31.243a7.3 7.3 0 0 1-2.744-2.787q-.996-1.774-.996-3.961c0-2.187.332-2.778.996-3.96a7.3 7.3 0 0 1 2.744-2.787q1.748-1.013 3.902-1.014 1.823 0 3.344.675a6.86 6.86 0 0 1 2.535 1.892 6.44 6.44 0 0 1 1.356 2.793h-3.066a4.05 4.05 0 0 0-.895-1.431 4 4 0 0 0-1.43-.95 4.9 4.9 0 0 0-1.823-.332q-1.33 0-2.402.665a4.6 4.6 0 0 0-1.677 1.827q-.606 1.164-.606 2.62 0 1.459.606 2.621a4.6 4.6 0 0 0 1.677 1.828q1.072.664 2.402.664.986 0 1.822-.332a4.02 4.02 0 0 0 2.326-2.38h3.066a6.44 6.44 0 0 1-1.356 2.792 6.86 6.86 0 0 1-2.535 1.892q-1.522.675-3.344.675-2.154 0-3.902-1.013z"
			/>
		</svg>
	);
};

export const RiderIcon: ExternalEditorIcon = (props) => {
	const [gradientAId, gradientBId] = useSvgGradientIds("rider", 2);

	return (
		<svg {...props} viewBox="0 0 64 64" fill="none">
			<defs>
				<linearGradient
					id={gradientAId}
					x1="64.391"
					x2="39.607"
					y1="56.329"
					y2="2.874"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".21" stopColor="#007DFE" />
					<stop offset=".55" stopColor="#FFB700" />
				</linearGradient>
				<linearGradient
					id={gradientBId}
					x1="59.676"
					x2="1.08"
					y1="4.067"
					y2="62.663"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".23" stopColor="#FFB700" />
					<stop offset=".73" stopColor="#FF0A67" />
				</linearGradient>
			</defs>
			<path
				fill="#007DFE"
				d="M47.55 58h12.258a4.125 4.125 0 0 0 4.124-4.19l-.176-11.044a4.12 4.12 0 0 0-1.44-3.066L24.158 6.993A4.13 4.13 0 0 0 21.474 6H10.125A4.125 4.125 0 0 0 6 10.125v11.003c0 1.19.514 2.321 1.409 3.105l37.425 32.746A4.12 4.12 0 0 0 47.55 58"
			/>
			<path
				fill={`url(#${gradientAId})`}
				d="M49.013 58h10.862A4.125 4.125 0 0 0 64 53.875V41.309q0-.3-.044-.598L58.508 3.527A4.125 4.125 0 0 0 54.427 0H39.029a4.125 4.125 0 0 0-4.125 4.126l.005 18.505c0 .425.066.848.195 1.253l9.979 31.246a4.13 4.13 0 0 0 3.93 2.87"
			/>
			<path
				fill={`url(#${gradientBId})`}
				d="M4.125 64h34.128a4.13 4.13 0 0 0 3.8-2.52L57.85 24.057c.219-.518.33-1.076.324-1.638l-.15-18.329A4.124 4.124 0 0 0 53.9 0H36.234c-.805 0-1.593.236-2.266.678L1.86 21.787A4.13 4.13 0 0 0 0 25.234v34.641A4.125 4.125 0 0 0 4.125 64"
			/>
			<path fill="#000" d="M52 12H12v40h40z" />
			<path
				fill="#fff"
				d="M33 44H17v3h16zM16.992 16.992h6.442q1.576 0 2.776.579t1.85 1.63.648 2.432c0 .922-.22 1.75-.66 2.46q-.66 1.068-1.875 1.651-1.217.584-2.825.584h-3.43v5.67h-2.926zm7.54 6.63q.553-.274.853-.783.3-.51.3-1.184c0-.45-.1-.852-.3-1.185q-.3-.498-.852-.772-.552-.273-1.292-.273h-3.323v4.47h3.323q.74 0 1.292-.273m-2.63 1.763h3.194L29.03 32h-3.355zM31.613 16.992h5.713q2.133 0 3.822.965a6.9 6.9 0 0 1 2.641 2.674q.954 1.71.954 3.864t-.953 3.865a6.9 6.9 0 0 1-2.642 2.674q-1.688.964-3.822.964h-5.713zm8.028 11.876q1.008-.6 1.555-1.72t.547-2.653q0-1.534-.547-2.653-.547-1.12-1.555-1.721-1.008-.6-2.347-.6h-2.755v9.947h2.755q1.34 0 2.347-.6"
			/>
		</svg>
	);
};

export const RubyMineIcon: ExternalEditorIcon = (props) => {
	const [gradientAId, gradientBId] = useSvgGradientIds("rubymine", 2);

	return (
		<svg {...props} viewBox="0 0 64 64" fill="none">
			<defs>
				<linearGradient
					id={gradientAId}
					x1="4.325"
					x2="62.921"
					y1="59.932"
					y2="1.337"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".29" stopColor="#FF2358" />
					<stop offset=".75" stopColor="#7256FF" />
				</linearGradient>
				<linearGradient
					id={gradientBId}
					x1="-.391"
					x2="24.393"
					y1="7.671"
					y2="61.125"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".29" stopColor="#FF8100" />
					<stop offset=".56" stopColor="#FF2358" />
				</linearGradient>
			</defs>
			<path
				fill={`url(#${gradientAId})`}
				d="M59.875 0H25.748a4.13 4.13 0 0 0-3.8 2.52L6.151 39.942a4.1 4.1 0 0 0-.325 1.639l.15 18.328A4.125 4.125 0 0 0 10.101 64h17.666c.805 0 1.593-.235 2.266-.678l32.109-21.108A4.12 4.12 0 0 0 64 38.766V4.125A4.125 4.125 0 0 0 59.875 0"
			/>
			<path
				fill={`url(#${gradientBId})`}
				d="M14.987 6H4.126A4.125 4.125 0 0 0 0 10.125v12.566q0 .3.044.598l5.448 37.184A4.125 4.125 0 0 0 9.572 64H24.97a4.125 4.125 0 0 0 4.125-4.126l-.004-18.504c0-.426-.067-.85-.196-1.254L18.917 8.87A4.13 4.13 0 0 0 14.987 6z"
			/>
			<path
				fill="#FF8100"
				d="M16.45 6H4.19a4.125 4.125 0 0 0-4.124 4.19L0 21c.019 1.181.786 2.531 1.683 3.3l38.158 32.706c.748.641 1.7.993 2.684.993h11.35A4.125 4.125 0 0 0 58 53.875V42.872c0-1.189-.514-2.32-1.41-3.104L19.167 7.021A4.12 4.12 0 0 0 16.45 6"
			/>
			<path fill="#000" d="M52 12H12v40h40z" />
			<path
				fill="#fff"
				d="M33 44H17v3h16zM17.012 16.992h6.442q1.575 0 2.776.579t1.849 1.63.648 2.432c0 .922-.22 1.75-.66 2.46q-.658 1.068-1.875 1.651-1.216.584-2.824.584h-3.43v5.67h-2.926zm7.54 6.63q.552-.274.852-.783.3-.51.3-1.184c0-.45-.1-.852-.3-1.185q-.3-.498-.852-.772-.552-.273-1.292-.273h-3.323v4.47h3.323q.74 0 1.292-.273m-2.631 1.763h3.194L29.05 32h-3.355zM31.633 16.992h4.073l3.087 9.85.257 1.287.225-1.286 2.98-9.85h4.138v15.005h-2.894V21.29l.043-.782-3.494 11.49h-2.123l-3.451-11.415.043.707v10.708h-2.883V16.992z"
			/>
		</svg>
	);
};

export const RustRoverIcon: ExternalEditorIcon = (props) => {
	const [gradientAId, gradientBId] = useSvgGradientIds("rustrover", 2);

	return (
		<svg {...props} viewBox="0 0 64 64" fill="none">
			<defs>
				<linearGradient
					id={gradientAId}
					x1="7.671"
					x2="61.125"
					y1="64.393"
					y2="39.609"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".08" stopColor="#00D886" />
					<stop offset=".46" stopColor="#FFAB00" />
				</linearGradient>
				<linearGradient
					id={gradientBId}
					x1="59.932"
					x2="1.336"
					y1="59.676"
					y2="1.08"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".19" stopColor="#FFAB00" />
					<stop offset=".83" stopColor="#FF004C" />
				</linearGradient>
			</defs>
			<path
				fill="#00D886"
				d="M6 47.55v12.258a4.125 4.125 0 0 0 4.19 4.124l11.044-.176a4.12 4.12 0 0 0 3.066-1.44l32.707-38.158c.64-.747.993-1.7.993-2.684V10.125A4.125 4.125 0 0 0 53.875 6H42.872c-1.19 0-2.321.514-3.105 1.409L7.021 44.833A4.12 4.12 0 0 0 6 47.55"
			/>
			<path
				fill={`url(#${gradientAId})`}
				d="M6 49.015v10.862a4.125 4.125 0 0 0 4.125 4.125h12.566q.3 0 .598-.044l37.185-5.448A4.125 4.125 0 0 0 64 54.429V39.03a4.125 4.125 0 0 0-4.127-4.125l-18.504.005c-.426 0-.849.066-1.254.195L8.871 45.085A4.13 4.13 0 0 0 6 49.015z"
			/>
			<path
				fill={`url(#${gradientBId})`}
				d="M0 4.125v34.128c0 1.658.993 3.154 2.52 3.8L39.943 57.85c.518.219 1.075.33 1.638.324l18.329-.15A4.125 4.125 0 0 0 64 53.9V36.234c0-.806-.236-1.593-.678-2.267L42.213 1.86A4.13 4.13 0 0 0 38.766 0H4.125A4.125 4.125 0 0 0 0 4.125"
			/>
			<path fill="#000" d="M52 12H12v40h40z" />
			<path
				fill="#fff"
				d="M33 44H17v3h16zM16.992 16.992h6.442q1.576 0 2.776.579t1.85 1.63.648 2.432c0 .922-.22 1.75-.66 2.46q-.66 1.068-1.875 1.651-1.217.584-2.825.584h-3.43v5.67h-2.926zm7.54 6.63q.553-.274.853-.783.3-.51.3-1.184c0-.45-.1-.852-.3-1.185q-.3-.498-.852-.772-.552-.273-1.292-.273h-3.323v4.47h3.323q.74 0 1.292-.273m-2.63 1.763h3.194L29.03 32h-3.355zM31.613 16.992h6.442q1.575 0 2.776.579t1.85 1.63.648 2.432c0 .922-.22 1.75-.66 2.46q-.659 1.068-1.875 1.651-1.217.584-2.824.584h-3.43v5.67h-2.927zm7.54 6.63q.553-.274.853-.783.3-.51.3-1.184c0-.45-.1-.852-.3-1.185q-.3-.498-.852-.772-.552-.273-1.292-.273h-3.323v4.47h3.323q.74 0 1.292-.273m-2.63 1.763h3.194L43.651 32h-3.355z"
			/>
		</svg>
	);
};

export const WebStormIcon: ExternalEditorIcon = (props) => {
	const [gradientAId, gradientBId] = useSvgGradientIds("webstorm", 2);

	return (
		<svg {...props} viewBox="0 0 64 64" fill="none">
			<defs>
				<linearGradient
					id={gradientAId}
					x1="7.671"
					x2="61.126"
					y1="64.392"
					y2="39.609"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".22" stopColor="#F0EB18" />
					<stop offset=".59" stopColor="#00C4F4" />
				</linearGradient>
				<linearGradient
					id={gradientBId}
					x1="59.932"
					x2="1.337"
					y1="59.676"
					y2="1.079"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".19" stopColor="#00C4F4" />
					<stop offset=".83" stopColor="#007DFE" />
				</linearGradient>
			</defs>
			<path
				fill="#F0EB18"
				d="M6 47.55v12.258a4.125 4.125 0 0 0 4.19 4.124l11.044-.176a4.12 4.12 0 0 0 3.066-1.44l32.707-38.158c.64-.747.993-1.7.993-2.684V10.125A4.125 4.125 0 0 0 53.875 6H42.872c-1.19 0-2.321.514-3.105 1.409L7.021 44.833A4.12 4.12 0 0 0 6 47.55"
			/>
			<path
				fill={`url(#${gradientAId})`}
				d="M6 49.015v10.862a4.125 4.125 0 0 0 4.125 4.125h12.566q.3 0 .598-.044l37.185-5.448A4.125 4.125 0 0 0 64 54.429V39.03a4.125 4.125 0 0 0-4.127-4.125l-18.504.005c-.426 0-.849.066-1.254.195L8.871 45.085A4.13 4.13 0 0 0 6 49.015z"
			/>
			<path
				fill={`url(#${gradientBId})`}
				d="M0 4.125v34.128c0 1.658.993 3.154 2.52 3.8L39.943 57.85c.518.219 1.075.33 1.638.324l18.329-.15A4.125 4.125 0 0 0 64 53.9V36.234c0-.806-.236-1.593-.678-2.267L42.213 1.86A4.13 4.13 0 0 0 38.766 0H4.125A4.125 4.125 0 0 0 0 4.125"
			/>
			<path fill="#000" d="M52 12H12v40h40z" />
			<path
				fill="#fff"
				d="M33 44H17v3h16zM19.051 16.992l2.423 10.955 2.583-10.955h2.958l2.701 10.955 2.348-10.955h2.97l-3.645 15.006h-3.334l-2.53-10.9-2.561 10.9H19.64l-3.623-15.006zM38.662 31.664q-1.26-.59-1.972-1.65t-.735-2.444h2.937q0 .654.343 1.147t.954.772q.61.278 1.404.278c.53 0 .952-.083 1.335-.251q.573-.252.889-.702t.316-1.029q0-.718-.434-1.19-.435-.471-1.195-.654l-2.648-.59q-1.071-.234-1.865-.809a4 4 0 0 1-1.232-1.42q-.44-.846-.44-1.908 0-1.286.665-2.31.664-1.023 1.854-1.597 1.19-.573 2.701-.573c1.008 0 1.934.186 2.734.558q1.2.558 1.87 1.549t.68 2.277h-2.925q0-.546-.29-.98c-.29-.435-.466-.515-.82-.676a2.9 2.9 0 0 0-1.217-.24q-.686 0-1.205.23a1.9 1.9 0 0 0-.81.643q-.29.412-.289.96 0 .621.402 1.028t1.099.579l2.55.557q1.105.226 1.968.852a4.45 4.45 0 0 1 1.345 1.544 4.2 4.2 0 0 1 .482 1.999q0 1.329-.702 2.385-.702 1.054-1.966 1.656-1.266.6-2.894.6-1.63 0-2.889-.59"
			/>
		</svg>
	);
};

export const EXTERNAL_EDITOR_ICONS: Record<ExternalEditorId, ExternalEditorIcon> = {
	cursor: CursorIcon,
	trae: TraeIcon,
	kiro: KiroIcon,
	vscode: VisualStudioCode,
	"vscode-insiders": VisualStudioCodeInsiders,
	vscodium: VSCodium,
	zed: Zed,
	antigravity: AntigravityIcon,
	idea: IntelliJIdeaIcon,
	aqua: AquaIcon,
	clion: CLionIcon,
	datagrip: DataGripIcon,
	dataspell: DataSpellIcon,
	goland: GoLandIcon,
	phpstorm: PhpStormIcon,
	pycharm: PyCharmIcon,
	rider: RiderIcon,
	rubymine: RubyMineIcon,
	rustrover: RustRoverIcon,
	webstorm: WebStormIcon,
};
