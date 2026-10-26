import { InputSlotSchema, type InputSlotInput } from '@hrflow/flow-schema';
import * as XLSX from 'xlsx';
import type { SourceFile } from '../io/excel-reader';

type Cell = string | number | boolean | null;

/** Build an in-memory .xlsx file from rows (array of arrays). */
export function xlsxFile(
  name: string,
  sheets: Record<string, Cell[][]>,
  merges: Record<string, XLSX.Range[]> = {},
): SourceFile {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (merges[sheetName]) ws['!merges'] = merges[sheetName];
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return { name, data };
}

export function csvFile(name: string, text: string): SourceFile {
  return { name, data: new TextEncoder().encode(text) };
}

export function slot(input: Partial<InputSlotInput> & Pick<InputSlotInput, 'columns'>) {
  return InputSlotSchema.parse({ key: 'test', label: 'Test', ...input });
}
