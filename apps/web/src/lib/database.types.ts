/**
 * Hand-written types of the Supabase schema (supabase/migrations). Keep in sync with the SQL;
 * same shape as `supabase gen types typescript` would produce, limited to what the app uses.
 */

type Timestamps = { created_at: string; updated_at: string };

export type Role = 'admin' | 'user';
export type VersionStatus = 'draft' | 'published' | 'retired';
export type RunLogStatus = 'succeeded' | 'failed' | 'cancelled';

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type ProfileRow = Timestamps & {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  password_changed_at: string | null;
  locale: 'vi' | 'en';
  created_by: string | null;
};

export type GroupRow = Timestamps & {
  id: string;
  name: string;
  description: string;
  created_by: string | null;
};

export type GroupMemberRow = {
  group_id: string;
  user_id: string;
  created_at: string;
  created_by: string | null;
};

export type FlowRow = Timestamps & {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  instructions: string;
  is_archived: boolean;
  created_by: string | null;
};

export type FlowVersionRow = Timestamps & {
  id: string;
  flow_id: string;
  version_no: number;
  status: VersionStatus;
  effective_from: string | null;
  effective_to: string | null;
  definition: Json;
  schema_version: number;
  change_note: string;
  published_by: string | null;
  published_at: string | null;
  created_by: string | null;
};

export type FlowAssignmentRow = {
  id: string;
  flow_id: string;
  user_id: string | null;
  group_id: string | null;
  created_at: string;
  created_by: string | null;
};

/** Metadata only (spec §7.1); see the CHECK constraints in the core migration. */
export type RunLogInsert = {
  flow_version_id: string;
  params: Record<string, string | number | boolean | null>;
  inputs_meta: { slot: string; rows: number; files: { sha256: string; size: number }[] }[];
  status: RunLogStatus;
  duration_ms: number;
  rows_out: number | null;
  error_code: string | null;
  error_node_id: string | null;
  client_info: Record<string, string | number | boolean | null> | null;
};

export type MyFlowRow = {
  flow_id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  instructions: string;
  version_id: string | null;
  version_no: number | null;
  effective_from: string | null;
  effective_to: string | null;
  input_count: number;
};

export type ResolvedVersionRow = {
  version_id: string;
  flow_id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  instructions: string;
  version_no: number;
  effective_from: string;
  effective_to: string | null;
  definition: Json;
  applies: boolean;
};

export type RecentRunRow = {
  id: string;
  created_at: string;
  flow_code: string;
  flow_name: string;
  version_no: number;
  params: Json;
  param_defs: Json;
  status: RunLogStatus;
  duration_ms: number;
  rows_out: number | null;
  error_code: string | null;
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, never, Partial<Pick<ProfileRow, 'full_name' | 'locale'>>>;
      groups: Table<GroupRow, { name: string; description?: string }>;
      group_members: Table<GroupMemberRow, { group_id: string; user_id: string }>;
      flows: Table<FlowRow>;
      flow_versions: Table<FlowVersionRow>;
      flow_assignments: Table<
        FlowAssignmentRow,
        { flow_id: string; user_id?: string | null; group_id?: string | null }
      >;
      run_logs: Table<
        RunLogInsert & { id: string; user_id: string; created_at: string },
        RunLogInsert,
        never
      >;
    };
    Views: Record<never, never>;
    Functions: {
      my_flows: { Args: { p_as_of: string }; Returns: MyFlowRow[] };
      resolve_flow_version: {
        Args: { p_code: string; p_as_of: string };
        Returns: ResolvedVersionRow[];
      };
      my_recent_runs: { Args: { p_limit: number }; Returns: RecentRunRow[] };
      admin_publish_flow_version: {
        Args: {
          p_code: string;
          p_name: string;
          p_description: string;
          p_category: string;
          p_instructions: string;
          p_definition: Json;
          p_effective_from: string;
          p_effective_to: string | null;
          p_change_note: string;
          p_close_previous: boolean;
        };
        Returns: { flow_id: string; version_id: string; version_no: number }[];
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
