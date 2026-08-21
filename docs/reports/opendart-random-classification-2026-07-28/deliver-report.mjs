import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pluginBase = join(
  homedir(),
  '.codex/plugins/cache/openai-curated-remote/data-analytics',
);

async function resolvePortableBuilderScripts() {
  const configuredRoot = process.env.DATA_ANALYTICS_PLUGIN_ROOT;
  const candidates = configuredRoot
    ? [configuredRoot]
    : (await readdir(pluginBase, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(pluginBase, entry.name))
      .sort()
      .reverse();

  for (const root of candidates) {
    const scripts = join(root, 'skills/build-report/scripts');
    try {
      await import(pathToFileURL(join(scripts, 'build_portable_artifact.mjs')).href);
      return scripts;
    } catch {
      // Try the next installed data-analytics plugin version.
    }
  }

  throw new Error(
    'OpenAI data-analytics portable report builder를 찾지 못했습니다. ' +
      'DATA_ANALYTICS_PLUGIN_ROOT를 지정해 주세요.',
  );
}

function patchClassicScrollbarViewportWidth(html) {
  const marker = 'id="jaroo-portable-scrollbar-compat"';
  if (html.includes(marker)) return html;

  const style = `
<style id="jaroo-portable-scrollbar-compat">
/* The upstream portable shell uses 100vw for its full-bleed top bar. In
   Chromium with classic scrollbars, 100vw includes the scrollbar gutter and
   overflows by half the gutter on each side. Keep the full-bleed layout tied
   to the actual content box without hiding genuine overflow elsewhere. */
.dashboard-shell.report-shell > .analytics-top-bar,
.portable-fallback > .portable-page-header {
  width: 100% !important;
  margin-right: 0 !important;
  margin-left: 0 !important;
}
</style>`;

  if (!html.includes('</head>')) throw new Error('Portable HTML에 </head>가 없습니다.');
  return html.replace('</head>', `${style}\n</head>`);
}

const scripts = await resolvePortableBuilderScripts();
const { buildPortableArtifact } = await import(
  pathToFileURL(join(scripts, 'build_portable_artifact.mjs')).href
);
const { deliverPortableArtifact } = await import(
  pathToFileURL(join(scripts, 'deliver_portable_artifact.mjs')).href
);

const result = await deliverPortableArtifact(
  {
    inputPath: resolve(here, 'artifact.json'),
    outputPath: resolve(here, 'report.html'),
    screenshotPath: resolve(here, 'report-verification-failure.png'),
    timeoutMs: 20_000,
  },
  {
    build: (artifact, options) => patchClassicScrollbarViewportWidth(
      buildPortableArtifact(artifact, options),
    ),
  },
);

if (!result.ok) {
  process.stderr.write(`${JSON.stringify(result)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
