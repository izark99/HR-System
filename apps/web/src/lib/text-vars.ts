/**
 * Names of the i18next variables of a text, sorted, without their format (spec §33 AC-TX-11):
 * "{{count, number}} file của {{slot}}" → ["count", "slot"]. Shared by the app entry, the engine
 * worker and the "Văn bản giao diện" tab, so an edited text is only ever used with the variables
 * of its default text.
 */
export function textVars(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(/{{-?\s*([\w.]+)[^}]*}}/g), (m) => m[1]!))].sort();
}

/** Same variable names (formats aside). */
export function sameVars(a: string, b: string): boolean {
  return textVars(a).join() === textVars(b).join();
}
