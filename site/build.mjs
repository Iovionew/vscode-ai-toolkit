// Builds the static changelog site published to GitHub Pages.
// Source of truth is WHATS_NEW.md at the repository root; this script only
// transforms it, so the markdown file stays the single place releases are edited.

import { mkdir, readFile, readdir, writeFile, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const siteDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(siteDir, '..');
const sourceFile = join(repoRoot, 'WHATS_NEW.md');
const outDir = join(siteDir, 'dist');

const REPO_URL = 'https://github.com/microsoft/foundry-toolkit';
const MARKETPLACE_URL =
  'https://marketplace.visualstudio.com/items?itemName=ms-windows-ai-studio.windows-ai-studio';
const SITE_TITLE = 'Foundry Toolkit for VS Code';
const SITE_DESCRIPTION = 'Release notes and changelog for the Foundry Toolkit for VS Code extension.';

marked.setOptions({ gfm: true, breaks: false });

/** Escapes a string for interpolation into HTML text or a quoted attribute. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Splits WHATS_NEW.md into an intro block plus one entry per `## Version ...`
 * heading, keeping each release body as raw markdown for later rendering.
 */
function parseChangelog(markdown) {
  const lines = markdown.split(/\r?\n/);
  const releases = [];
  let intro = [];
  let current = null;

  for (const line of lines) {
    const versionHeading = /^##\s+(.*\S)\s*$/.exec(line);
    if (versionHeading) {
      if (current) {
        releases.push(current);
      }
      current = { heading: versionHeading[1], body: [] };
      continue;
    }

    if (/^#\s+/.test(line)) {
      continue; // Page title comes from SITE_TITLE, not the markdown H1.
    }

    if (current) {
      current.body.push(line);
    } else {
      intro.push(line);
    }
  }

  if (current) {
    releases.push(current);
  }

  return {
    intro: intro.join('\n').trim(),
    releases: releases.map(toRelease),
  };
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** Parses "22 July, 2026" without relying on locale-dependent Date parsing. */
function parseReleaseDate(text) {
  const match = /^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/.exec(text.trim());
  if (!match) {
    return null;
  }

  const monthIndex = MONTHS.indexOf(match[2].toLowerCase());
  if (monthIndex === -1) {
    return null;
  }

  return new Date(Date.UTC(Number(match[3]), monthIndex, Number(match[1])));
}

function toRelease({ heading, body }) {
  const versionMatch = /^Version\s+(\S+)\s*(?:[-–—]\s*(.+))?$/.exec(heading);
  const version = versionMatch ? versionMatch[1] : heading;
  const dateText = versionMatch && versionMatch[2] ? versionMatch[2].trim() : '';
  const date = dateText ? parseReleaseDate(dateText) : null;
  const markdown = body.join('\n').trim();

  return {
    id: `v-${slugify(version)}`,
    version,
    dateText,
    date,
    year: date ? String(date.getUTCFullYear()) : '',
    markdown,
    html: marked.parse(markdown),
  };
}

function renderRelease(release, isLatest) {
  const latestBadge = isLatest ? '<span class="badge">Latest</span>' : '';
  const date = release.dateText
    ? `<time class="release__date"${
        release.date ? ` datetime="${release.date.toISOString().slice(0, 10)}"` : ''
      }>${escapeHtml(release.dateText)}</time>`
    : '';

  return `
        <article class="release" id="${release.id}" data-version="${escapeHtml(release.version)}">
          <header class="release__header">
            <h2 class="release__title">
              <a class="release__anchor" href="#${release.id}" aria-label="Link to version ${escapeHtml(
                release.version,
              )}">#</a>
              Version ${escapeHtml(release.version)}
              ${latestBadge}
            </h2>
            ${date}
          </header>
          <div class="release__body">
${release.html.trim()}
          </div>
        </article>`;
}

function renderNav(releases) {
  const groups = [];
  for (const release of releases) {
    const label = release.year || 'Earlier releases';
    const last = groups.at(-1);
    if (last && last.label === label) {
      last.releases.push(release);
    } else {
      groups.push({ label, releases: [release] });
    }
  }

  return groups
    .map(
      (group) => `
          <div class="nav__group">
            <h3 class="nav__group-title">${escapeHtml(group.label)}</h3>
            <ul class="nav__list">
${group.releases
  .map(
    (release) => `              <li class="nav__item" data-target="${release.id}">
                <a href="#${release.id}">
                  <span class="nav__version">${escapeHtml(release.version)}</span>
                  ${release.dateText ? `<span class="nav__date">${escapeHtml(release.dateText)}</span>` : ''}
                </a>
              </li>`,
  )
  .join('\n')}
            </ul>
          </div>`,
    )
    .join('\n');
}

function renderPage({ intro, releases }) {
  const introHtml = intro ? marked.parse(intro) : '';

  return `<!DOCTYPE html>
<html lang="en" data-theme="auto">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Changelog · ${escapeHtml(SITE_TITLE)}</title>
    <meta name="description" content="${escapeHtml(SITE_DESCRIPTION)}" />
    <meta property="og:title" content="Changelog · ${escapeHtml(SITE_TITLE)}" />
    <meta property="og:description" content="${escapeHtml(SITE_DESCRIPTION)}" />
    <meta property="og:type" content="website" />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%230078d4'/%3E%3Cpath d='M9 21V11h4.4a3.3 3.3 0 0 1 0 6.6H12V21z' fill='white'/%3E%3C/svg%3E" />
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <a class="skip-link" href="#content">Skip to content</a>
    <header class="masthead">
      <div class="masthead__inner">
        <div class="masthead__brand">
          <p class="masthead__eyebrow">${escapeHtml(SITE_TITLE)}</p>
          <h1 class="masthead__title">Changelog</h1>
        </div>
        <div class="masthead__actions">
          <a class="button button--primary" href="${MARKETPLACE_URL}">Get the extension</a>
          <a class="button" href="${REPO_URL}">GitHub repo</a>
          <button class="button button--icon" type="button" id="theme-toggle" aria-label="Toggle color theme">
            <span aria-hidden="true" data-theme-icon>◐</span>
          </button>
        </div>
      </div>
    </header>

    <div class="layout">
      <nav class="sidebar" aria-label="Releases">
        <label class="search" for="search">
          <span class="visually-hidden">Filter releases</span>
          <input
            id="search"
            type="search"
            placeholder="Filter releases…"
            autocomplete="off"
            spellcheck="false"
          />
        </label>
        <p class="sidebar__empty" id="nav-empty" hidden>No matching releases.</p>
        <div class="nav" id="nav">
${renderNav(releases)}
        </div>
      </nav>

      <main class="content" id="content">
        ${introHtml ? `<section class="intro">${introHtml}</section>` : ''}
        <p class="results" id="results" hidden></p>
${releases.map((release, index) => renderRelease(release, index === 0)).join('\n')}
        <p class="content__empty" id="content-empty" hidden>
          No releases match your filter.
        </p>
      </main>
    </div>

    <footer class="footer">
      <p>
        Generated from
        <a href="${REPO_URL}/blob/main/WHATS_NEW.md">WHATS_NEW.md</a>.
        © Microsoft Corporation.
      </p>
    </footer>

    <script src="./app.js"></script>
  </body>
</html>
`;
}

/**
 * Clears the output directory's contents rather than the directory itself, so a
 * local preview server holding it open doesn't fail the build on Windows.
 */
async function emptyDir(dir) {
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir);
  await Promise.all(entries.map((entry) => rm(join(dir, entry), { recursive: true, force: true })));
}

async function main() {
  if (!existsSync(sourceFile)) {
    throw new Error(`Changelog source not found: ${sourceFile}`);
  }

  const markdown = await readFile(sourceFile, 'utf8');
  const parsed = parseChangelog(markdown);

  if (parsed.releases.length === 0) {
    throw new Error('No "## Version ..." sections found in WHATS_NEW.md');
  }

  await emptyDir(outDir);
  await writeFile(join(outDir, 'index.html'), renderPage(parsed), 'utf8');
  await cp(join(siteDir, 'assets'), outDir, { recursive: true });
  // Pages would otherwise run the output through Jekyll, which drops files
  // and folders that start with an underscore.
  await writeFile(join(outDir, '.nojekyll'), '', 'utf8');

  console.log(`Built ${parsed.releases.length} releases -> ${join(outDir, 'index.html')}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
