import type { MarkerInspection } from "./marker-lifecycle";
/** Compact external observation: raw listing output belongs to the standalone
 * inspection tool, not every nested merge/checkin/closeout receipt. */
export type MarkerGate = Pick<MarkerInspection, "state" | "attempt" | "capture">;
export const compactMarkerGate = ({ state, attempt, capture }: MarkerInspection): MarkerGate => ({ state, attempt, capture });
