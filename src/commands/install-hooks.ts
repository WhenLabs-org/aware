import * as path from "node:path";
import * as fs from "node:fs/promises";
import { fileExists, writeFile, ensureDir } from "../utils/fs.js";
import { log } from "../utils/logger.js";

export type CiProvider = "github-actions" | "gitlab-ci" | "circleci";

interface InstallHooksOptions {
  /** Emit a CI workflow snippet instead of (or in addition to) a git hook. */
  ci?: CiProvider;
  /** Overwrite an existing hook instead of skipping. */
  force?: boolean;
}

const PRE_COMMIT_SCRIPT = `#!/usr/bin/env sh
# Installed by \`aware install-hooks\`. Blocks commits that would drift
# the AI context files from .aware.json. Run \`aware sync\` to reconcile.
exec aware diff --check --quiet
`;

const HUSKY_SCRIPT = `aware diff --check --quiet
`;

const GITHUB_ACTIONS_SNIPPET = `# .github/workflows/aware.yml
name: aware drift check
on:
  pull_request:
  push:
    branches: [main]
jobs:
  aware:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm aware diff --check
`;

const GITLAB_CI_SNIPPET = `# .gitlab-ci.yml fragment
aware-drift:
  image: node:20
  script:
    - corepack enable
    - pnpm install --frozen-lockfile
    - pnpm aware diff --check
`;

const CIRCLECI_SNIPPET = `# .circleci/config.yml fragment
version: 2.1
jobs:
  aware-drift:
    docker:
      - image: cimg/node:20.0
    steps:
      - checkout
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm aware diff --check
`;

export async function installHooksCommand(
  options: InstallHooksOptions = {},
): Promise<void> {
  const projectRoot = process.cwd();

  if (options.ci) {
    renderCiSnippet(options.ci);
    // CI mode doesn't also install the git hook by default — rendering the
    // snippet is the only side effect. Run without `--ci` to install a hook.
    return;
  }

  const huskyDir = path.join(projectRoot, ".husky");
  const gitDir = path.join(projectRoot, ".git");

  if (await fileExists(huskyDir)) {
    await installHuskyHook(huskyDir, options.force ?? false);
    return;
  }

  if (await fileExists(gitDir)) {
    await installGitHook(gitDir, options.force ?? false);
    return;
  }

  log.error(
    "No .git or .husky directory found. Run `aware install-hooks` from a " +
      "git repository, or use `--ci <provider>` to print a CI workflow snippet.",
  );
  process.exit(1);
}

async function installGitHook(gitDir: string, force: boolean): Promise<void> {
  const hooksDir = path.join(gitDir, "hooks");
  await ensureDir(hooksDir);
  const hookPath = path.join(hooksDir, "pre-commit");

  if ((await fileExists(hookPath)) && !force) {
    log.warn(`${hookPath} already exists. Re-run with --force to overwrite.`);
    return;
  }

  await writeFile(hookPath, PRE_COMMIT_SCRIPT);
  await fs.chmod(hookPath, 0o755);
  log.success(`Installed pre-commit hook at ${hookPath}`);
  log.dim("The hook runs `aware diff --check`. A nonzero exit blocks the commit.");
}

async function installHuskyHook(huskyDir: string, force: boolean): Promise<void> {
  const hookPath = path.join(huskyDir, "pre-commit");
  const existing = await readIfExists(hookPath);

  if (existing !== null && existing.includes("aware diff --check")) {
    log.info("Husky pre-commit already runs `aware diff --check` — no changes.");
    return;
  }

  if (existing === null) {
    await writeFile(hookPath, HUSKY_SCRIPT);
    await fs.chmod(hookPath, 0o755);
    log.success(`Installed Husky pre-commit hook at ${hookPath}`);
    return;
  }

  if (!force) {
    log.warn(
      `${hookPath} exists. Append the following line, or re-run with --force ` +
        `to overwrite:\n  aware diff --check --quiet`,
    );
    return;
  }

  await writeFile(hookPath, existing.trimEnd() + "\n" + HUSKY_SCRIPT);
  log.success(`Appended drift check to ${hookPath}`);
}

function renderCiSnippet(provider: CiProvider): void {
  const snippet = snippetFor(provider);
  log.header(`\naware CI snippet (${provider}):\n`);
  console.log(snippet);
  log.dim(
    "Copy the snippet into your CI config. `aware diff --check` exits 0 on " +
      "clean, 1 on drift, 2 on tampering — use as a required status check.",
  );
}

function snippetFor(provider: CiProvider): string {
  switch (provider) {
    case "github-actions":
      return GITHUB_ACTIONS_SNIPPET;
    case "gitlab-ci":
      return GITLAB_CI_SNIPPET;
    case "circleci":
      return CIRCLECI_SNIPPET;
  }
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}
