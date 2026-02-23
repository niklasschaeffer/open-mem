#!/usr/bin/env node

// open-mem — Plugin Installer for OpenCode
// Usage: npx open-mem [--global] [--force] [--uninstall] [--dry-run] [--help] [--version]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

// ── colour helpers (disabled when piped) ────────────────────────────
const isTTY = process.stdout.isTTY;
const RED = isTTY ? "\x1b[0;31m" : "";
const GREEN = isTTY ? "\x1b[0;32m" : "";
const YELLOW = isTTY ? "\x1b[0;33m" : "";
const BLUE = isTTY ? "\x1b[0;34m" : "";
const DIM = isTTY ? "\x1b[2m" : "";
const BOLD = isTTY ? "\x1b[1m" : "";
const RESET = isTTY ? "\x1b[0m" : "";

const info = (msg) => process.stdout.write(`${BLUE}[info]${RESET}  ${msg}\n`);
const ok = (msg) => process.stdout.write(`${GREEN}[ok]${RESET}    ${msg}\n`);
const warn = (msg) => process.stdout.write(`${YELLOW}[warn]${RESET}  ${msg}\n`);
const err = (msg) => process.stderr.write(`${RED}[error]${RESET} ${msg}\n`);

// ── constants ───────────────────────────────────────────────────────
const PLUGIN_ENTRY = "open-mem@latest";
const PKG_NAME = "open-mem";
const DOCS_URL = "https://github.com/clopca/open-mem";

// ── CLI flags ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flagGlobal = args.includes("--global");
const flagUninstall = args.includes("--uninstall");
const flagDryRun = args.includes("--dry-run");
const flagForce = args.includes("--force");
const flagHelp = args.includes("--help") || args.includes("-h");
const flagVersion = args.includes("--version") || args.includes("-v");

// ── unknown flag validation ─────────────────────────────────────────
const KNOWN_FLAGS = new Set([
	"--global",
	"--uninstall",
	"--dry-run",
	"--force",
	"--help",
	"-h",
	"--version",
	"-v",
]);
const unknown = args.filter((a) => a.startsWith("-") && !KNOWN_FLAGS.has(a));
if (unknown.length > 0) {
	err(`Unknown flag${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
	info(`Run ${BOLD}npx open-mem --help${RESET} for usage.`);
	process.exit(1);
}

// ── version helper ──────────────────────────────────────────────────

function getVersion() {
	try {
		const pkgPath = path.join(
			path.dirname(new URL(import.meta.url).pathname),
			"..",
			"package.json",
		);
		return JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
	} catch {
		return null;
	}
}

// ── --version flag ──────────────────────────────────────────────────
if (flagVersion) {
	const pkgPath = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "package.json");
	try {
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
		process.stdout.write(`${pkg.name} v${pkg.version}\n`);
	} catch {
		process.stdout.write(`open-mem (version unknown)\n`);
	}
	process.exit(0);
}

// ── help ────────────────────────────────────────────────────────────
if (flagHelp) {
	process.stdout.write(`
${BOLD}open-mem${RESET} — Persistent memory plugin for OpenCode

${BOLD}USAGE${RESET}
  npx open-mem [flags]

${BOLD}FLAGS${RESET}
  ${DIM}(none)${RESET}        Add open-mem to local .opencode/opencode.json
  --global      Target ~/.config/opencode/opencode.json instead
  --uninstall   Remove open-mem from all discovered config files
  --dry-run     Preview changes without writing anything
  --force       Skip confirmation prompts
  --help, -h    Show this help
  --version, -v Show version

${BOLD}EXAMPLES${RESET}
  npx open-mem                 ${DIM}# install locally${RESET}
  npx open-mem --global        ${DIM}# install globally${RESET}
  npx open-mem --uninstall     ${DIM}# remove from all configs${RESET}

${BOLD}DOCS${RESET}
  ${DOCS_URL}
`);
	process.exit(0);
}

// ── JSONC helpers ───────────────────────────────────────────────────

/** Strip line and block comments from JSONC so JSON.parse can handle it. */
function stripJsonComments(text) {
	let result = "";
	let i = 0;
	let inString = false;
	let stringChar = "";

	while (i < text.length) {
		// inside a JSON string — pass through, handling escapes
		if (inString) {
			if (text[i] === "\\") {
				result += text[i] + (text[i + 1] ?? "");
				i += 2;
				continue;
			}
			if (text[i] === stringChar) inString = false;
			result += text[i];
			i++;
			continue;
		}

		// string start
		if (text[i] === '"' || text[i] === "'") {
			inString = true;
			stringChar = text[i];
			result += text[i];
			i++;
			continue;
		}

		// line comment
		if (text[i] === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i++;
			continue;
		}

		// block comment
		if (text[i] === "/" && text[i + 1] === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
			i += 2; // skip closing */
			continue;
		}

		result += text[i];
		i++;
	}
	return result;
}

// ── config discovery ────────────────────────────────────────────────

/** Walk up from `start` looking for an OpenCode config file. */
function findUp(start) {
	const candidates = [
		".opencode/opencode.jsonc",
		".opencode/opencode.json",
		"opencode.jsonc",
		"opencode.json",
	];

	let dir = path.resolve(start);
	const root = path.parse(dir).root;

	while (true) {
		for (const c of candidates) {
			const full = path.join(dir, c);
			if (fs.existsSync(full)) return full;
		}
		const parent = path.dirname(dir);
		if (parent === dir || dir === root) break;
		dir = parent;
	}
	return null;
}

/** Determine the target config path for install. */
function getTargetPath() {
	if (flagGlobal) {
		const globalDir = path.join(os.homedir(), ".config", "opencode");
		// prefer existing file
		for (const name of ["opencode.jsonc", "opencode.json"]) {
			const p = path.join(globalDir, name);
			if (fs.existsSync(p)) return p;
		}
		return path.join(globalDir, "opencode.json");
	}

	// local: walk up from cwd
	const found = findUp(process.cwd());
	if (found) return found;

	// fallback: create in .opencode/
	return path.join(process.cwd(), ".opencode", "opencode.json");
}

/** Find ALL config files that contain open-mem (for uninstall). */
function findAllConfigsWithPlugin() {
	const configs = [];
	const seen = new Set();

	const candidates = [
		".opencode/opencode.jsonc",
		".opencode/opencode.json",
		"opencode.jsonc",
		"opencode.json",
	];

	const tryAdd = (p) => {
		const resolved = path.resolve(p);
		if (seen.has(resolved)) return;
		seen.add(resolved);
		if (!fs.existsSync(resolved)) return;
		try {
			const config = readConfig(resolved);
			if (config && config.data && findPluginEntry(config.data) !== -1) {
				configs.push(resolved);
			}
		} catch {
			/* skip */
		}
	};

	// Walk up from cwd, checking all candidates at each level
	let dir = path.resolve(process.cwd());
	const root = path.parse(dir).root;
	while (true) {
		for (const c of candidates) tryAdd(path.join(dir, c));
		const parent = path.dirname(dir);
		if (parent === dir || dir === root) break;
		dir = parent;
	}

	// Global locations
	const globalDir = path.join(os.homedir(), ".config", "opencode");
	tryAdd(path.join(globalDir, "opencode.jsonc"));
	tryAdd(path.join(globalDir, "opencode.json"));

	return configs;
}

// ── read / write helpers ────────────────────────────────────────────

function readConfig(filePath) {
	if (!fs.existsSync(filePath)) return null;
	const raw = fs.readFileSync(filePath, "utf8");
	try {
		return { raw, data: JSON.parse(stripJsonComments(raw)) };
	} catch {
		return { raw, data: null };
	}
}

/**
 * Write a brand-new minimal config with the plugin entry.
 * Used when no config file exists at all.
 */
function writeNewConfig(filePath) {
	const content = JSON.stringify({ plugin: [PLUGIN_ENTRY] }, null, 2) + "\n";
	if (flagDryRun) {
		info(`Would create ${BOLD}${filePath}${RESET} with:`);
		process.stdout.write(DIM + content + RESET);
		return true;
	}
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf8");
	ok(`Created ${BOLD}${filePath}${RESET}`);
	return true;
}

/**
 * Add the plugin entry to an existing config, preserving JSONC comments.
 * Strategy: regex-based insertion so comments survive.
 */
function addPluginEntry(filePath, raw, data) {
	// already present? (handles any version suffix)
	if (data && findPluginEntry(data) !== -1) {
		ok(`${BOLD}${PKG_NAME}${RESET} already in ${filePath}`);
		return false;
	}

	let updated;

	// case 1: "plugin": [...] exists — append our entry
	const pluginArrayRe = /("plugin"\s*:\s*\[)([\s\S]*?)(\])/;
	const m = raw.match(pluginArrayRe);
	if (m) {
		const inside = m[2].trim();
		if (inside.length === 0) {
			// empty array
			updated = raw.replace(pluginArrayRe, `$1"${PLUGIN_ENTRY}"$3`);
		} else {
			// non-empty — add after last entry
			updated = raw.replace(pluginArrayRe, (_, open, entries, close) => {
				const trimmed = entries.trimEnd();
				const needsComma = trimmed.length > 0 && !trimmed.endsWith(",");
				return `${open}${entries.trimEnd()}${needsComma ? "," : ""} "${PLUGIN_ENTRY}"${close}`;
			});
		}
	} else {
		// case 2: no plugin key — inject after the opening {
		const idx = raw.indexOf("{");
		if (idx === -1) {
			err(`Cannot parse ${filePath} — not a JSON object`);
			return false;
		}
		const before = raw.slice(0, idx + 1);
		const after = raw.slice(idx + 1);
		// detect indent
		const indentMatch = after.match(/\n(\s+)/);
		const indent = indentMatch ? indentMatch[1] : "  ";
		updated = `${before}\n${indent}"plugin": ["${PLUGIN_ENTRY}"],${after}`;
	}

	if (flagDryRun) {
		info(`Would update ${BOLD}${filePath}${RESET}`);
		process.stdout.write(DIM + updated + RESET);
		return true;
	}

	fs.writeFileSync(filePath, updated, "utf8");
	ok(`Added ${BOLD}${PLUGIN_ENTRY}${RESET} to ${filePath}`);
	return true;
}

/** Remove the plugin entry from a config file, preserving JSONC comments. */
function removePluginEntry(filePath, raw) {
	if (!raw.includes(PKG_NAME)) return false;

	// Remove the entry (with or without @latest, quotes, surrounding commas)
	let updated = raw;

	// Pattern: "open-mem" or "open-mem@latest" or "open-mem@<version>" as array element
	// Handle trailing comma, leading comma, or standalone
	// NOTE: no 'g' flag — avoids lastIndex issues with test() + replace()
	const patterns = [
		// entry with trailing comma and optional whitespace
		new RegExp(`\\s*"${PKG_NAME}(?:@[^"]*)?"\\s*,`),
		// entry with leading comma — also trim trailing whitespace after comma removal
		new RegExp(`,\\s*"${PKG_NAME}(?:@[^"]*)?"\\s*`),
		// standalone entry (only element)
		new RegExp(`"${PKG_NAME}(?:@[^"]*)?"`),
	];

	for (const pat of patterns) {
		if (pat.test(updated)) {
			updated = updated.replace(pat, "");
			break;
		}
	}

	if (updated === raw) return false;

	if (flagDryRun) {
		info(`Would update ${BOLD}${filePath}${RESET}`);
		return true;
	}

	fs.writeFileSync(filePath, updated, "utf8");
	ok(`Removed ${BOLD}${PKG_NAME}${RESET} from ${filePath}`);
	return true;
}

/** Find plugin entry in parsed config data. */
function findPluginEntry(data) {
	if (!data || !Array.isArray(data.plugin)) return -1;
	return data.plugin.findIndex(
		(e) => typeof e === "string" && (e === PKG_NAME || e.startsWith(PKG_NAME + "@")),
	);
}

// ── node_modules cleanup ────────────────────────────────────────────

function findStaleNodeModules(start) {
	const results = [];
	let dir = path.resolve(start);
	const root = path.parse(dir).root;

	while (true) {
		const candidate = path.join(dir, "node_modules", PKG_NAME);
		if (fs.existsSync(candidate)) results.push(candidate);
		const parent = path.dirname(dir);
		if (parent === dir || dir === root) break;
		dir = parent;
	}
	return results;
}

function cleanupNodeModules() {
	const stale = findStaleNodeModules(process.cwd());
	if (stale.length === 0) return;

	for (const p of stale) {
		if (flagDryRun) {
			info(`Would remove ${BOLD}${p}${RESET}`);
			continue;
		}
		try {
			fs.rmSync(p, { recursive: true, force: true });
			ok(`Removed ${BOLD}${p}${RESET}`);
		} catch (e) {
			warn(`Could not remove ${p}: ${e.message}`);
		}
	}

	// also remove from package.json dependencies if present
	const pkgPath = path.join(process.cwd(), "package.json");
	if (fs.existsSync(pkgPath)) {
		try {
			const raw = fs.readFileSync(pkgPath, "utf8");
			if (raw.includes(`"${PKG_NAME}"`)) {
				const pkg = JSON.parse(raw);
				let changed = false;
				for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
					if (pkg[key] && pkg[key][PKG_NAME]) {
						delete pkg[key][PKG_NAME];
						changed = true;
					}
				}
				if (changed) {
					if (flagDryRun) {
						info(`Would remove ${BOLD}${PKG_NAME}${RESET} from ${pkgPath}`);
					} else {
						fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
						ok(`Removed ${BOLD}${PKG_NAME}${RESET} from ${pkgPath}`);
					}
				}
			}
		} catch {
			/* skip */
		}
	}
}

// ── confirmation prompt ─────────────────────────────────────────────

async function confirm(question) {
	if (flagForce) return true;
	if (!isTTY) return true; // non-interactive — assume yes

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	try {
		const answer = await rl.question(`${question} ${DIM}[Y/n]${RESET} `);
		return !answer || answer.toLowerCase().startsWith("y");
	} finally {
		rl.close();
	}
}

// ── install flow ────────────────────────────────────────────────────

async function install() {
	const target = getTargetPath();
	info(`Target: ${BOLD}${target}${RESET}`);

	const config = readConfig(target);

	// no file yet — create one
	if (!config) {
		if (!(await confirm(`Create ${target}?`))) {
			info("Aborted.");
			return;
		}
		writeNewConfig(target);
		printNextSteps();
		return;
	}

	// file exists but can't be parsed
	if (!config.data) {
		err(`Could not parse ${target} — fix the JSON/JSONC syntax first.`);
		process.exit(1);
	}

	// already has the entry?
	if (findPluginEntry(config.data) !== -1) {
		ok(`${BOLD}${PLUGIN_ENTRY}${RESET} is already in ${target}`);
		printNextSteps();
		return;
	}

	if (!(await confirm(`Add ${PLUGIN_ENTRY} to ${target}?`))) {
		info("Aborted.");
		return;
	}

	addPluginEntry(target, config.raw, config.data);
	printNextSteps();
}

// ── uninstall flow ──────────────────────────────────────────────────

async function uninstall() {
	const configs = findAllConfigsWithPlugin();

	if (configs.length === 0) {
		info(`No config files found containing ${BOLD}${PKG_NAME}${RESET}.`);
	} else {
		info(`Found ${configs.length} config(s) with ${BOLD}${PKG_NAME}${RESET}:`);
		for (const c of configs) info(`  ${c}`);

		if (await confirm("Remove open-mem from these configs?")) {
			for (const c of configs) {
				const raw = fs.readFileSync(c, "utf8");
				removePluginEntry(c, raw);
			}
		}
	}

	// cleanup node_modules
	const stale = findStaleNodeModules(process.cwd());
	if (stale.length > 0) {
		info(`Found ${stale.length} node_modules installation(s):`);
		for (const s of stale) info(`  ${s}`);

		if (await confirm("Remove these?")) {
			cleanupNodeModules();
		}
	}

	// cleanup OpenCode cache
	const cacheDir = path.join(os.homedir(), ".cache", "opencode", "node_modules", PKG_NAME);
	if (fs.existsSync(cacheDir)) {
		info(`Found cached plugin at ${BOLD}${cacheDir}${RESET}`);
		if (await confirm("Remove cached plugin?")) {
			if (flagDryRun) {
				info(`Would remove ${BOLD}${cacheDir}${RESET}`);
			} else {
				try {
					fs.rmSync(cacheDir, { recursive: true, force: true });
					ok(`Removed ${BOLD}${cacheDir}${RESET}`);
				} catch (e) {
					warn(`Could not remove cache: ${e.message}`);
				}
			}
		}
	}

	// cleanup OpenCode cache package.json dependency
	const cachePkgPath = path.join(os.homedir(), ".cache", "opencode", "package.json");
	if (fs.existsSync(cachePkgPath)) {
		try {
			const raw = fs.readFileSync(cachePkgPath, "utf8");
			if (raw.includes(`"${PKG_NAME}"`)) {
				const pkg = JSON.parse(raw);
				let changed = false;
				for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
					if (pkg[key] && pkg[key][PKG_NAME]) {
						delete pkg[key][PKG_NAME];
						changed = true;
					}
				}
				if (changed) {
					if (flagDryRun) {
						info(`Would remove ${BOLD}${PKG_NAME}${RESET} from ${cachePkgPath}`);
					} else {
						fs.writeFileSync(cachePkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
						ok(`Removed ${BOLD}${PKG_NAME}${RESET} from ${cachePkgPath}`);
					}
				}
			}
		} catch {
			/* skip */
		}
	}

	ok("Uninstall complete.");
}

// ── AI provider detection ───────────────────────────────────────────

function detectAIProviders() {
	const providers = [
		{ key: "GOOGLE_GENERATIVE_AI_API_KEY", name: "Google Gemini" },
		{ key: "ANTHROPIC_API_KEY", name: "Anthropic" },
		{ key: "AWS_ACCESS_KEY_ID", name: "AWS Bedrock" },
		{ key: "OPENAI_API_KEY", name: "OpenAI" },
		{ key: "OPENROUTER_API_KEY", name: "OpenRouter" },
	];
	return providers.filter((p) => process.env[p.key]);
}

// ── next steps ──────────────────────────────────────────────────────

function printNextSteps() {
	const detected = detectAIProviders();

	process.stdout.write(`
${GREEN}✓${RESET} ${BOLD}open-mem${RESET} is configured!

${BOLD}Next steps:${RESET}
  1. Start OpenCode — open-mem loads automatically
  2. Use ${BOLD}mem-find${RESET}, ${BOLD}mem-create${RESET}, ${BOLD}mem-history${RESET} tools in your sessions
  3. Observations are captured and compressed automatically

`);

	if (detected.length > 0) {
		const names = detected.map((p) => p.name).join(", ");
		process.stdout.write(`${BOLD}AI compression:${RESET} ${GREEN}✓${RESET} ${names} detected\n`);
	} else {
		process.stdout.write(
			`${BOLD}Optional — enable AI compression:${RESET}\n` +
				`  ${DIM}export GOOGLE_GENERATIVE_AI_API_KEY=...${RESET}\n` +
				`  ${DIM}# Also supports: Anthropic, AWS Bedrock, OpenAI, OpenRouter${RESET}\n`,
		);
	}

	process.stdout.write(`\n${BOLD}Docs:${RESET} ${DOCS_URL}\n`);
}

// ── main ────────────────────────────────────────────────────────────

async function main() {
	const version = getVersion();
	process.stdout.write(
		`\n${BOLD}open-mem${RESET}${version ? ` ${DIM}v${version}${RESET}` : ""} ${DIM}— Persistent memory plugin for OpenCode${RESET}\n\n`,
	);

	if (flagDryRun) info(`${YELLOW}Dry-run mode${RESET} — no files will be modified.\n`);

	if (flagUninstall) {
		await uninstall();
	} else {
		await install();
	}
}

main().catch((e) => {
	err(e.message);
	process.exit(1);
});
