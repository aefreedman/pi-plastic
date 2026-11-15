import type { SwitchBranchObservation } from "./switch-contract";
export type WorkspaceIssue = { code: string; path: string | null };
export type WorkspacePendingRow = { status: string; path: string; isDirectory: boolean; revision: string; mergeChangeset: string | null; sourcePath?: string };
export type WorkspacePendingObservation = { cwd: string; changeset: string | null; repository: string | null; server: string | null; rows: WorkspacePendingRow[]; issues: WorkspaceIssue[]; records: number };
export type WorkspaceStandardObservation = { branch: SwitchBranchObservation | null; links: Array<{ changeset: string; branch: string; repository: string | null; server: string | null }>; issues: WorkspaceIssue[] };
