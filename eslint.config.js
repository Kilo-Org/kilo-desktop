import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: [
			"**/.svelte-kit/**",
			"**/.vite/**",
			"**/build/**",
			"**/dist/**",
			"**/node_modules/**",
			"**/out/**",
			"**/release/**",
		],
	},
	eslint.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	...svelte.configs["flat/recommended"],
	{
		languageOptions: {
			globals: globals.node,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
			"@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
		},
	},
	{
		files: ["app/src/renderer/**/*.svelte"],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
			parserOptions: {
				extraFileExtensions: [".svelte"],
				parser: tseslint.parser,
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ["app/src/renderer/**/*.svelte.ts"],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ["app/src/renderer/**/*.ts"],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
	},
	{
		files: ["app/src/renderer/lib/components/ui/**/*.svelte"],
		rules: {
			"@typescript-eslint/no-unsafe-assignment": "off",
			"svelte/no-navigation-without-resolve": "off",
		},
	},
	{
		files: ["app/src/main/features/*/*Service.ts"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "electron",
							message:
								"Services must stay Electron-free. Put Electron usage in handlers or platform/.",
						},
					],
				},
			],
		},
	},
	{
		files: ["**/*.{js,mjs,cjs}"],
		...tseslint.configs.disableTypeChecked,
	},
	{
		files: ["**/e2e/**/*.ts"],
		rules: {
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-return": "off",
		},
	},
	{
		files: ["**/*.test.ts", "**/*.browser.test.ts", "**/e2e/**/*.ts"],
		languageOptions: {
			globals: globals.node,
		},
	},
	{
		files: ["**/*.browser.test.ts"],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
	},
	prettier,
);
