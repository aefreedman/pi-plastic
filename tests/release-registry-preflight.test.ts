import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import assert from "node:assert/strict";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const gateMatch = workflow.match(
  /- name: Publish to npm with trusted publishing\n        shell: bash\n        run: \|\n([\s\S]*?)\n      - name: Verify npm release identity/,
);
assert.ok(gateMatch, "release workflow must contain the npm publication gate");
const gate = gateMatch[1].replace(/^ {10}/gm, "");
const expectedHead = "__EXPECTED_HEAD__";
const bashPath = process.platform === "win32" && existsSync("C:\\Program Files\\Git\\bin\\bash.exe")
  ? "C:\\Program Files\\Git\\bin\\bash.exe"
  : "bash";

type Scenario = {
  name: string;
  stdout?: string;
  stderr?: string;
  status: number;
  expectedStatus: number;
  published: boolean;
  output?: string;
  diagnostic?: string;
};

const runScenario = (scenario: Scenario): void => {
  const directory = mkdtempSync(join(tmpdir(), "pi-plastic-registry-gate-"));
  try {
    const bin = join(directory, "bin");
    const outputFile = join(directory, "github-output");
    const publishMarker = join(directory, "published");
    writeFileSync(join(directory, "package.json"), '{"name":"@aefree/pi-plastic","version":"0.6.0"}\n');
    assert.equal(spawnSync("git", ["init", "--quiet"], { cwd: directory }).status, 0, "fixture git init failed");
    assert.equal(
      spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "fixture"], { cwd: directory }).status,
      0,
      "fixture git commit failed",
    );
    const fixtureHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).stdout.trim();
    writeFileSync(join(directory, "npm"), "");
    writeFileSync(join(directory, "github-output"), "");
    // Keep mocked executables separate so PATH resolution mirrors the workflow.
    mkdirSync(bin);
    writeFileSync(
      join(bin, "npm"),
      "#!/usr/bin/env bash\nset -eu\nif [[ \"$1\" = view ]]; then\n  printf '%s' \"${NPM_VIEW_STDOUT:-}\"\n  printf '%s' \"${NPM_VIEW_STDERR:-}\" >&2\n  exit \"${NPM_VIEW_STATUS:-0}\"\nfi\nif [[ \"$1\" = publish ]]; then\n  touch \"$PUBLISH_MARKER\"\n  exit 0\nfi\nexit 1\n",
    );
    chmodSync(join(bin, "npm"), 0o755);

    const shellBin = process.platform === "win32"
      ? bin.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`)
      : bin;
    const result = spawnSync(bashPath, ["-c", gate], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${shellBin}:${process.env.PATH}`,
        GITHUB_OUTPUT: outputFile,
        NPM_VIEW_STDOUT: scenario.stdout?.replaceAll(expectedHead, fixtureHead) ?? "",
        NPM_VIEW_STDERR: scenario.stderr ?? "",
        NPM_VIEW_STATUS: String(scenario.status),
        PUBLISH_MARKER: publishMarker,
      },
    });

    assert.equal(result.status, scenario.expectedStatus, `${scenario.name}: unexpected gate status\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.equal(existsSync(publishMarker), scenario.published, `${scenario.name}: publish action mismatch`);
    if (scenario.output !== undefined) {
      assert.match(readFileSync(outputFile, "utf8"), new RegExp(scenario.output));
    }
    if (scenario.diagnostic !== undefined) {
      assert.match(`${result.stdout}${result.stderr}`, new RegExp(scenario.diagnostic));
    }
    console.log(`PASS: ${scenario.name}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};


runScenario({
  name: "confirmed version absence authorizes publication",
  stderr: "npm error code E404\nnpm error 404 Not Found\n",
  status: 1,
  expectedStatus: 0,
  published: true,
  output: "publish_required=true",
});
runScenario({
  name: "matching version and gitHead skips publication",
  stdout: JSON.stringify({ version: "0.6.0", gitHead: expectedHead }),
  status: 0,
  expectedStatus: 0,
  published: false,
  output: "publish_required=false",
});
runScenario({
  name: "mismatched version stops publication",
  stdout: JSON.stringify({ version: "0.5.0", gitHead: expectedHead }),
  status: 0,
  expectedStatus: 1,
  published: false,
});
runScenario({
  name: "mismatched gitHead stops publication",
  stdout: JSON.stringify({ version: "0.6.0", gitHead: "different-head" }),
  status: 0,
  expectedStatus: 1,
  published: false,
});
runScenario({
  name: "missing gitHead stops publication",
  stdout: JSON.stringify({ version: "0.6.0" }),
  status: 0,
  expectedStatus: 1,
  published: false,
});
runScenario({
  name: "malformed metadata stops publication",
  stdout: "not-json",
  status: 0,
  expectedStatus: 1,
  published: false,
});
runScenario({
  name: "non-E404 registry failure stops publication",
  stderr: "npm error code E401\nnpm error Unauthorized\n",
  status: 1,
  expectedStatus: 1,
  published: false,
  diagnostic: "npm error Unauthorized",
});
