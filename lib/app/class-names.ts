/** Joins class names, dropping the falsy ones a conditional expression yields. */
export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
