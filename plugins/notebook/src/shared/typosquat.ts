/**
 * Typosquat detection for notebook dependency specs, ported from nteract's
 * `crates/notebook/src/typosquat.rs` (39da360cb1cfd8eedaabb072dffdeba090f0661c).
 * nteract ships this check in its Tauri app rather than the daemon, so every
 * host must provide `deps.checkTyposquats` itself. Keep matching semantics,
 * thresholds, and the popular-package list in sync with upstream; the list is
 * shared across uv, conda, and pixi specs.
 */

/** Wire shape of nteract's `TyposquatWarning` (`@nteract/notebook-host`). */
export interface TyposquatWarning {
	readonly package: string;
	readonly similar_to: string;
	readonly distance: number;
}

/** Top PyPI packages (https://hugovk.github.io/top-pypi-packages/) plus commonly targeted names. */
const UPSTREAM_POPULAR_PACKAGES = [
	"boto3",
	"botocore",
	"urllib3",
	"requests",
	"setuptools",
	"charset-normalizer",
	"certifi",
	"idna",
	"typing-extensions",
	"python-dateutil",
	"s3transfer",
	"packaging",
	"aiobotocore",
	"pyyaml",
	"numpy",
	"six",
	"cryptography",
	"pip",
	"jmespath",
	"s3fs",
	"fsspec",
	"cffi",
	"attrs",
	"pycparser",
	"wheel",
	"zipp",
	"importlib-metadata",
	"aiohttp",
	"pyasn1",
	"multidict",
	"pandas",
	"platformdirs",
	"yarl",
	"rsa",
	"pytz",
	"google-api-core",
	"async-timeout",
	"awscli",
	"protobuf",
	"googleapis-common-protos",
	"filelock",
	"wrapt",
	"markupsafe",
	"frozenlist",
	"colorama",
	"aiosignal",
	"click",
	"jinja2",
	"jsonschema",
	"tomli",
	"pyparsing",
	"pydantic",
	"grpcio",
	"pyarrow",
	"sqlalchemy",
	"tqdm",
	"docutils",
	"google-auth",
	"werkzeug",
	"pillow",
	"scipy",
	"decorator",
	"pluggy",
	"greenlet",
	"cachetools",
	"exceptiongroup",
	"tzdata",
	"pytest",
	"iniconfig",
	"flask",
	"pyjwt",
	"google-cloud-storage",
	"lxml",
	"pyopenssl",
	"psutil",
	"oauthlib",
	"soupsieve",
	"beautifulsoup4",
	"google-cloud-core",
	"requests-oauthlib",
	"httplib2",
	"pygments",
	"isodate",
	"openpyxl",
	"networkx",
	"et-xmlfile",
	"httpx",
	"sniffio",
	"anyio",
	"httpcore",
	"h11",
	"distlib",
	"virtualenv",
	"matplotlib",
	"scikit-learn",
	"joblib",
	"threadpoolctl",
	"pynacl",
	"bcrypt",
	"paramiko",
	"tensorflow",
	"torch",
	"keras",
	"opencv-python",
	"opencv-contrib-python",
	"selenium",
	"scrapy",
	"django",
	"fastapi",
	"uvicorn",
	"gunicorn",
	"celery",
	"redis",
	"pymongo",
	"psycopg2",
	"mysqlclient",
	"elasticsearch",
	"boto",
	"aws-cdk-lib",
	"black",
	"flake8",
	"mypy",
	"isort",
	"pylint",
	"coverage",
	"nose",
	"mock",
	"faker",
	"factory-boy",
	"hypothesis",
	"httpretty",
	"responses",
	"moto",
	"python",
	"ipython",
	"jupyter",
	"notebook",
	"jupyterlab",
	"ipykernel",
	"ipywidgets",
	"anywidget",
	"nbformat",
	"nbconvert",
	"traitlets",
	"rich",
	"typer",
	"pydantic-settings",
	"python-dotenv",
	"python-multipart",
	"starlette",
	"aiofiles",
	"orjson",
	"ujson",
	"msgpack",
	"cloudpickle",
	"dill",
	"transformers",
	"tokenizers",
	"huggingface-hub",
	"accelerate",
	"safetensors",
	"datasets",
	"evaluate",
	"timm",
	"torchvision",
	"torchaudio",
	"lightning",
	"wandb",
	"mlflow",
	"ray",
	"dask",
	"xarray",
	"zarr",
	"numba",
	"cython",
	"sympy",
	"mpmath",
	"astropy",
	"biopython",
	"statsmodels",
	"h5py",
	"netcdf4",
	"scikit-image",
	"seaborn",
	"plotly",
	"bokeh",
	"graphviz",
	"polars",
	"duckdb",
	"sqlparse",
	"alembic",
	"peewee",
	"dataset",
	"spacy",
	"nltk",
	"gensim",
	"regex",
	"poetry",
	"ruff",
	"pre-commit",
	"tox",
	"nox",
	"bandit",
	"hatch",
	"flit",
	"maturin",
	"pdm",
	"pycodestyle",
	"autopep8",
	"pyflakes",
	"yapf",
	"rope",
	"twisted",
	"tornado",
	"sanic",
	"falcon",
	"bottle",
	"websockets",
	"uvloop",
	"httptools",
	"grpcio-tools",
	"trio",
	"ansible",
	"fabric",
	"invoke",
	"prefect",
	"dagster",
	"luigi",
	"airflow",
	"marshmallow",
	"pydantic-core",
	"cattrs",
	"toml",
	"tomli-w",
	"arrow",
	"pendulum",
	"chardet",
	"tenacity",
	"loguru",
	"structlog",
	"watchdog",
	"tabulate",
	"fire",
	"more-itertools",
	"toolz",
	"boltons",
	"colorlog",
	"jedi",
	"pika",
	"pyright",
	"beartype",
	"pyqt5",
	"pyside6",
	"kivy",
	"pygame",
	"imageio",
	"librosa",
	"sphinx",
	"mkdocs",
	"kombu",
	"dramatiq",
	"scapy",
] as const;

/**
 * Conda package names that differ from their PyPI counterparts. Conda is the
 * default manager here, so these must not warn as near-misses of PyPI names.
 */
const CONDA_POPULAR_PACKAGES = [
	"pytorch",
	"pytorch-cuda",
	"py-opencv",
	"r-base",
	"nodejs",
] as const;

const POPULAR_PACKAGES: readonly string[] = [
	...UPSTREAM_POPULAR_PACKAGES,
	...CONDA_POPULAR_PACKAGES,
];

/** PyPI treats `_`, `-`, and `.` as equivalent and is case-insensitive. */
export function normalizeName(name: string): string {
	return name.toLowerCase().replace(/[_.]/g, "-");
}

const NORMALIZED_POPULAR = POPULAR_PACKAGES.map((name) => ({
	name,
	normalized: normalizeName(name),
}));
const NORMALIZED_POPULAR_SET = new Set(NORMALIZED_POPULAR.map(({ normalized }) => normalized));

/** Mirrors nteract's `notebook_doc::metadata::extract_package_name`. */
export function extractPackageName(spec: string): string {
	const trimmed = spec.trim();
	const channelSeparator = trimmed.lastIndexOf("::");
	const unqualified = channelSeparator === -1 ? trimmed : trimmed.slice(channelSeparator + 2);
	return (unqualified.split(/[><=!~[;@ ]/)[0] ?? unqualified).toLowerCase();
}

function levenshtein(a: string, b: string): number {
	const left = Array.from(a);
	const right = Array.from(b);
	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let i = 1; i <= left.length; i++) {
		const current = [i];
		for (let j = 1; j <= right.length; j++) {
			const substitution = previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1);
			current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution);
		}
		previous = current;
	}
	return previous[right.length]!;
}

function distanceThreshold(length: number): number {
	if (length <= 3) return 1;
	if (length <= 6) return 2;
	return 3;
}

/** Returns a warning when `spec` names a near-miss (not an exact match) of a popular package. */
export function checkTyposquat(spec: string): TyposquatWarning | undefined {
	const packageName = extractPackageName(spec);
	const normalized = normalizeName(packageName);
	if (!normalized || NORMALIZED_POPULAR_SET.has(normalized)) return undefined;

	const threshold = distanceThreshold(normalized.length);
	let best: { name: string; distance: number } | undefined;
	for (const popular of NORMALIZED_POPULAR) {
		const distance = levenshtein(normalized, popular.normalized);
		if (distance <= threshold && (!best || distance < best.distance)) {
			best = { name: popular.name, distance };
		}
	}
	return best && { package: packageName, similar_to: best.name, distance: best.distance };
}

export function checkTyposquats(specs: readonly string[]): TyposquatWarning[] {
	return specs.flatMap((spec) => checkTyposquat(spec) ?? []);
}
