/**
 * Where the User's flows come from. Today: flows bundled with the app (`localFlowSource`).
 * Later: Supabase (published `flow_versions` assigned to the user, chosen by effective date).
 * The definition is returned as raw JSON on purpose — it is validated by the engine worker,
 * which keeps Zod out of the main bundle and treats the server copy as untrusted input.
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

export interface LoadedFlow {
  summary: FlowSummary;
  definition: unknown;
}

export interface FlowSource {
  list(): Promise<FlowSummary[]>;
  get(code: string): Promise<LoadedFlow | null>;
}
