import * as fsPromises from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

interface FileStats {
  isSymbolicLink(): boolean;
}

interface SafeFsPromises {
  appendFile(path: string, data: string, encoding: string): Promise<void>;
  lstat(path: string): Promise<FileStats>;
  mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
  writeFile(path: string, data: string, encoding: string): Promise<void>;
}

const safeFs = fsPromises as unknown as SafeFsPromises;

/**
 * Create a directory only when every existing component below `root` is a real
 * directory rather than a symbolic link. This is a best-effort containment
 * guard for FirstRung-owned output paths.
 */
export async function ensureSafeOutputDirectory(root: string, directory: string): Promise<void> {
  assertLexicallyContained(root, directory);
  await assertNoSymlinkComponents(root, directory);
  await safeFs.mkdir(directory, { recursive: true });
  await assertNoSymlinkComponents(root, directory);
}

export async function assertSafeOwnedFilePath(root: string, filePath: string): Promise<void> {
  await ensureSafeOutputDirectory(root, dirname(filePath));

  try {
    const stats = await safeFs.lstat(filePath);

    if (stats.isSymbolicLink()) {
      throw new Error("FirstRung Coach refused an output file that is a symbolic link.");
    }
  } catch (error) {
    if (isMissingPathError(error)) {
      return;
    }

    throw error;
  }
}

export async function writeSafeOwnedFile(root: string, filePath: string, data: string): Promise<void> {
  await assertSafeOwnedFilePath(root, filePath);
  await safeFs.writeFile(filePath, data, "utf8");
}

export async function appendSafeOwnedFile(root: string, filePath: string, data: string): Promise<void> {
  await assertSafeOwnedFilePath(root, filePath);
  await safeFs.appendFile(filePath, data, "utf8");
}

export async function assertNoSymlinkComponents(root: string, candidate: string): Promise<void> {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const relativePath = assertLexicallyContained(resolvedRoot, resolvedCandidate);
  let current = resolvedRoot;

  for (const segment of relativePath.split(sep).filter(Boolean)) {
    current = resolve(current, segment);

    try {
      const stats = await safeFs.lstat(current);

      if (stats.isSymbolicLink()) {
        throw new Error("FirstRung Coach refused an output path containing a symbolic link.");
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }

      throw error;
    }
  }
}

function assertLexicallyContained(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const relativePath = relative(resolvedRoot, resolvedCandidate);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("FirstRung Coach output paths must remain inside the repository.");
  }

  return relativePath;
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
