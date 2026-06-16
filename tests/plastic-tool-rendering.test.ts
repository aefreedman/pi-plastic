import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexText = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

assert.match(indexText, /const COLLAPSED_RESULT_LINES = 12;/, "plastic tool results should have a compact collapsed preview limit");
assert.match(indexText, /function renderPlasticCall\(/, "plastic tools should provide custom call rendering");
assert.match(indexText, /function renderPlasticResult\(/, "plastic tools should provide custom result rendering");
assert.match(indexText, /renderCall\(args, theme\) \{/, "registered plastic tools should wire renderCall");
assert.match(indexText, /renderResult\(result, options, theme\) \{/, "registered plastic tools should wire renderResult");
assert.match(indexText, /options\?\.expanded \? lines\.length : COLLAPSED_RESULT_LINES/, "collapsed result rendering should limit visible output until expansion");
assert.match(indexText, /ctrl\+o to expand/, "collapsed result rendering should advertise the Ctrl+O expansion shortcut");
assert.match(indexText, /truncateAnsiLine/, "custom rendering should remain width-safe for long output lines");
assert.match(indexText, /themed\(theme, "toolOutput", line\)/, "tool output lines should use the toolOutput theme color");

console.log("PASS: plastic tool rendering test succeeded");
