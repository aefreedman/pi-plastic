import { posix, win32 } from "node:path";

// Select by operand syntax, not host OS: fixtures and CLI evidence can be
// inspected on another host. Never apply Windows case folding to POSIX paths.
export const receiptPathApi = (path: string) => /^(?:[A-Za-z]:[\\/]|\\\\)/.test(path) ? win32 : posix;
export const receiptAbsolutePath = (path: string) => receiptPathApi(path).isAbsolute(path);
export const receiptPathKey = (path: string) => {
    const api = receiptPathApi(path), normalized = api.normalize(path);
    return api === win32 ? normalized.replace(/\\/g, "/").toLowerCase() : normalized;
};
export const receiptRelativePath = (cwd: string, path: string) => receiptPathApi(cwd).relative(cwd, path);
export const receiptJoinPath = (cwd: string, path: string) => receiptPathApi(cwd).join(cwd, path);
export const receiptPathWithin = (cwd: string, path: string) => {
    if (!receiptAbsolutePath(cwd) || !receiptAbsolutePath(path) || receiptPathApi(cwd) !== receiptPathApi(path)) return false;
    const rel = receiptRelativePath(cwd, path);
    return !!rel && rel !== ".." && !rel.startsWith(".." + receiptPathApi(cwd).sep) && !receiptAbsolutePath(rel);
};
