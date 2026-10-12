// Next.js 16.4 references these global names, but TypeScript 5.9 and
// @types/node 26.1 expose them only through node:url. Remove this bridge
// when the compiler or Node types provide the corresponding globals.
export {};

declare global {
  type URLPatternInput = import("node:url").URLPatternInput;
  type URLPatternOptions = import("node:url").URLPatternOptions;
}
