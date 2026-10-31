import path from 'path';

// Directories the agent must never write to or delete from
const PROTECTED_DIRS = new Set(['.git', '.meta-agent', 'node_modules']);

/**
 * Resolves a model-supplied path against the project root and guarantees
 * the result stays inside that root (blocks "../" traversal and absolute paths).
 */
export function resolveInside(rootAbsolute, relativePath) {
    if (typeof relativePath !== 'string' || relativePath.trim() === '') {
        throw new Error('Empty or invalid file path');
    }
    if (relativePath.includes('\0')) {
        throw new Error('File path contains a null byte');
    }

    const root = path.resolve(rootAbsolute);
    const resolved = path.resolve(root, relativePath);
    const rel = path.relative(root, resolved);

    if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
        throw new Error(`Path escapes the project root: ${relativePath}`);
    }
    return resolved;
}

/** Secrets: must never be sent to a cloud LLM. */
export function isSecretPath(relPath) {
    const base = relPath.split(/[\\/]/).filter(Boolean).pop() || '';
    const lower = base.toLowerCase();
    if (!/^\.env(\..+)?$/.test(lower)) return false;
    return !/\.(example|sample|template)$/.test(lower);
}

/** Paths the agent may neither modify nor delete. */
export function isProtectedPath(relPath) {
    const parts = relPath.split(/[\\/]/).filter(Boolean);
    if (parts.length === 0) return true;
    if (parts.some(p => PROTECTED_DIRS.has(p))) return true;
    return isSecretPath(relPath);
}

/**
 * Resolve + protect: returns both absolute and POSIX-style relative path,
 * or throws if the path is unsafe to write.
 */
export function resolveProjectFile(rootAbsolute, filePath) {
    const absolutePath = resolveInside(rootAbsolute, filePath);
    const relativePath = path
        .relative(path.resolve(rootAbsolute), absolutePath)
        .split(path.sep)
        .join('/');

    if (isProtectedPath(relativePath)) {
        throw new Error(`Path is protected and cannot be modified: ${relativePath}`);
    }
    return { absolutePath, relativePath };
}
