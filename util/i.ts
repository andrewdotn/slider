import { inspect } from "util";

/** A template tag that automatically applies inspect to arguments */
export function i(strings: TemplateStringsArray, ...keys: unknown[]): string {
  let ret = strings[0];
  for (let i = 0; i < keys.length; i++) {
    ret += inspect(keys[i]);
    ret += strings[i + 1];
  }
  return ret;
}
