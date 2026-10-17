// The display-preference store moved into scopeDisplay.ts - one source of
// truth for TopBar's Quick SET menu, the on-scope DCB, the command line,
// and the named preference sets - so everything reads and writes the same
// localStorage keys through the same cache. This module stays as the
// alias TopBar already imports from.
export * from "./scopeDisplay";