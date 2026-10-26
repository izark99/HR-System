/**
 * Where the User's flows come from: Supabase (published `flow_versions` assigned to the user,
 * chosen by effective date — `SupabaseFlowSource`) or, in dev/tests, flows bundled with the app
 * (`localFlowSource`). The definition is returned as raw JSON on purpose — it is validated by the
 * engine worker, which keeps Zod out of the main bundle and treats the server copy as untrusted.
 */
export interface FlowSummary {
  /** URL-safe identifier used in `/run/:flowCode`. */
  code: string;
  name: string;
  description: string;
  category: string;
  /** Short guidance written by the Admin, shown on the run page. */
  instructions?: string;
  inputCount: number;
  /** Version label shown to the User (e.g. "v3"); absent for bundled flows. */
  versionLabel?: string;
}

/** The published version picked for an as-of date (spec §14.2). */
export interface FlowVersionInfo {
  id: string;
  versionNo: number;
  /** ISO dates; `effectiveTo` is exclusive, null = open-ended. */
  effectiveFrom: string;
  effectiveTo: string | null;
  /**
   * false = no version is effective on the requested date; this is the latest published version,
   * returned so the run page can still render the params (the User may pick another period).
   */
  applies: boolean;
}

export interface LoadedFlow {
  summary: FlowSummary;
  definition: unknown;
  /** Absent for bundled flows (no versioning, nothing logged). */
  version?: FlowVersionInfo;
}

export interface RecentRun {
  id: string;
  createdAt: string;
  flowName: string;
  versionNo: number;
  /** Logged params with the labels/types from the version that ran. */
  params: { key: string; label: string; type: string; value: string }[];
  status: 'succeeded' | 'failed' | 'cancelled';
}

export interface FlowSource {
  /** Flows the User may run; versions resolved for `asOf` (YYYY-MM-DD). */
  list(asOf: string): Promise<FlowSummary[]>;
  /** null = unknown flow or not assigned to the User. */
  get(code: string, asOf: string): Promise<LoadedFlow | null>;
  /** The User's own recent runs (metadata only); absent when runs are not logged. */
  recentRuns?(limit: number): Promise<RecentRun[]>;
}
