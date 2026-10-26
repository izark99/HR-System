// Dev/test only (VITE_FLOW_SOURCE=local, never in production builds): the acceptance flow bundled
// from the fixture. Production reads published versions from Supabase (supabase-flow-source.ts).
import payrollTimesheetFlow from '../../../../../fixtures/payroll-timesheet/flow.json';
import type { FlowSource, FlowSummary, LoadedFlow } from './flow-source';

/** Flow metadata is Admin-authored content (not UI text), so it lives with the flow. */
export const BUNDLED_FLOWS: LoadedFlow[] = [
  {
    summary: {
      code: 'payroll-timesheet',
      name: 'Đối chiếu bảng lương – chấm công',
      description:
        'Upload bảng lương và chấm công các chi nhánh, nhận file Excel 4 sheet chỉ ra sai lệch.',
      category: 'Lương & công',
      instructions:
        'upload đủ file của các chi nhánh trong kỳ. File lương lấy từ sheet "Luong", file chấm công từ sheet "ChamCong".',
      inputCount: payrollTimesheetFlow.inputSlots.length,
    },
    definition: payrollTimesheetFlow,
  },
];

export const localFlowSource: FlowSource = {
  list: () => Promise.resolve(BUNDLED_FLOWS.map((f) => f.summary)),
  get: (code) => Promise.resolve(BUNDLED_FLOWS.find((f) => f.summary.code === code) ?? null),
};

export type { FlowSummary };
