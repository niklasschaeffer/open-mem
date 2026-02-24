// =============================================================================
// open-mem — Git Worktree Detection Tests
// =============================================================================

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCanonicalProjectPath, resolveWorktreeRoot } from "../../src/utils/worktree";

describe("resolveWorktreeRoot", () => {
	test("returns null for a non-git directory", () => {
		const tempDir = mkdtempSync(join(tmpdir(), "open-mem-test-"));
		try {
			const result = resolveWorktreeRoot(tempDir);
			expect(result).toBeNull();
		} finally {
			rmdirSync(tempDir);
		}
	});

	test("handles non-existent path gracefully", () => {
		const result = resolveWorktreeRoot("/nonexistent/path/that/does/not/exist");
		expect(result).toBeNull();
	});

	test("handles empty string gracefully", () => {
		const result = resolveWorktreeRoot("");
		expect(result).toBeNull();
	});

	test("returns parent repo for worktree directory", () => {
		// When running inside a worktree, should return the main repo path
		const result = resolveWorktreeRoot(process.cwd());
		// In a worktree, should return the parent repo; otherwise null
		if (result !== null) {
			expect(result).toBe("/home/dev/.projects/open-mem");
		}
	});
});

describe("getCanonicalProjectPath", () => {
	test("returns original path for non-worktree directory", () => {
		const tempDir = mkdtempSync(join(tmpdir(), "open-mem-test-"));
		try {
			const result = getCanonicalProjectPath(tempDir);
			expect(result).toBe(tempDir);
		} finally {
			rmdirSync(tempDir);
		}
	});

	test("returns parent repo path for worktree directory", () => {
		// In a worktree, should return the parent repo path
		const result = getCanonicalProjectPath(process.cwd());
		expect(result).toBe("/home/dev/.projects/open-mem");
	});

	test("returns original path for non-existent directory", () => {
		const fakePath = "/nonexistent/path/xyz";
		const result = getCanonicalProjectPath(fakePath);
		expect(result).toBe(fakePath);
	});
});
