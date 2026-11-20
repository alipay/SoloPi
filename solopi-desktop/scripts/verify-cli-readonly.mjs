#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

function getOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : "";
}

function hasFlag(args, name) {
  return args.includes(name);
}

function writeJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function isInside(parentPath, targetPath) {
  const relative = path.relative(parentPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveExistingAppPath() {
  let appPath = String(process.env.GLASSBOX_APP_PATH || "").trim();
  if (!appPath && process.platform === "darwin") {
    try {
      appPath = execFileSync(
        "osascript",
        ["-e", 'POSIX path of (path to application "Glass Box")'],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
    } catch (_error) {
      appPath = "";
    }
  }

  if (!appPath) {
    throw new Error("未找到用户已安装的 Glass Box；请通过 GLASSBOX_APP_PATH 指定用户现有安装。");
  }

  const resolvedAppPath = fs.realpathSync(appPath.replace(/\/+$/, ""));
  const lowerSegments = resolvedAppPath.toLowerCase().split(path.sep).filter(Boolean);
  const forbiddenSegments = new Set(["build", "dist", "release", "dmg-staging"]);
  const systemTemporaryRoots = [os.tmpdir(), "/tmp"]
    .map((candidate) => {
      try {
        return fs.realpathSync(candidate);
      } catch (_error) {
        return path.resolve(candidate);
      }
    });

  if (
    systemTemporaryRoots.some((temporaryRoot) => isInside(temporaryRoot, resolvedAppPath))
    || lowerSegments.some((segment) => forbiddenSegments.has(segment))
    || lowerSegments.some((segment) => segment.includes("backup"))
  ) {
    throw new Error("拒绝运行临时、构建、发布或备份目录中的 Glass Box；请选择用户已经安装的唯一 App。");
  }

  return resolvedAppPath;
}

function getReportPackagesDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Glass Box", "report-packages");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Glass Box", "report-packages");
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configHome, "Glass Box", "report-packages");
}

function countReportPackages(reportPackagesDir) {
  try {
    return fs.readdirSync(reportPackagesDir)
      .filter((fileName) => fileName.endsWith(".glassreport"))
      .length;
  } catch (_error) {
    return 0;
  }
}

function runCommand(cliPath, args) {
  const startedAt = Date.now();
  const result = spawnSync(cliPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });

  return {
    command: [cliPath, ...args].join(" "),
    status: result.status ?? 2,
    durationMs: Date.now() - startedAt,
    stdout: result.stdout || "",
    stderr: result.stderr || result.error?.message || "",
  };
}

function parseJsonOutput(check, fallback = {}) {
  try {
    return JSON.parse(check.stdout);
  } catch (_error) {
    return fallback;
  }
}

function createCheck(id, name, passed, details = {}) {
  return {
    id,
    name,
    status: passed ? "pass" : "fail",
    ...details,
  };
}

function summarizeCommand(commandResult) {
  return {
    command: commandResult.command,
    status: commandResult.status,
    durationMs: commandResult.durationMs,
    stderr: commandResult.stderr.trim(),
  };
}

function getSummaryCounts(summaryPayload) {
  const summary = summaryPayload?.summary || {};
  return {
    successCount: Number(summary.successCount || 0),
    failedCount: Number(summary.failedCount || 0),
    stoppedCount: Number(summary.stoppedCount || 0),
    runningCount: Number(summary.runningCount || 0),
    pendingCount: Number(summary.pendingCount || 0),
    completed: Number(summary.completed || 0),
    caseCount: Number(summary.caseCount || 0),
  };
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = hasFlag(args, "--json");
  let appPath = "";
  let cliPath = "";
  try {
    appPath = resolveExistingAppPath();
    cliPath = path.join(appPath, "Contents", "Resources", "bin", "glassbox");
  } catch (error) {
    const payload = {
      schemaVersion: "glassbox.cli.readonlyVerify.v1",
      success: false,
      appPath,
      cliPath,
      checks: [],
      recoveryActions: [error.message],
    };
    if (jsonMode) {
      writeJson(payload);
    } else {
      console.error(error.message);
    }
    return 1;
  }
  const taskId = getOption(args, "--task-id") || process.env.GLASSBOX_VERIFY_TASK_ID || "";
  const caseFile = getOption(args, "--case-file") || process.env.GLASSBOX_VERIFY_CASE_FILE || "";
  const includeReindex = hasFlag(args, "--include-reindex");
  const reportPackagesDir = getOption(args, "--report-packages-dir") || getReportPackagesDir();
  const beforeReportCount = countReportPackages(reportPackagesDir);
  const commandResults = [];
  const checks = [];

  checks.push(createCheck("cli-exists", "CLI executable exists", fs.existsSync(cliPath), { cliPath }));

  if (!fs.existsSync(cliPath)) {
    const payload = {
      schemaVersion: "glassbox.cli.readonlyVerify.v1",
      success: false,
      cliPath,
      reportPackagesDir,
      checks,
      recoveryActions: [
        "确认 GLASSBOX_APP_PATH 指向用户已经安装的 Glass Box，并且该安装包含 CLI。",
      ],
    };
    if (jsonMode) {
      writeJson(payload);
    } else {
      console.error(`Missing CLI: ${cliPath}`);
    }
    return 1;
  }

  const doctor = runCommand(cliPath, ["doctor", "--json"]);
  commandResults.push({ id: "doctor", ...summarizeCommand(doctor) });
  const doctorPayload = parseJsonOutput(doctor);
  checks.push(createCheck("doctor-exit-zero", "doctor --json exits 0", doctor.status === 0));
  checks.push(createCheck("doctor-schema", "doctor schema is glassbox.doctor.v1", doctorPayload.schemaVersion === "glassbox.doctor.v1"));
  checks.push(createCheck("doctor-headless", "doctor reports headless submission", doctorPayload?.cli?.submissionType === "headless"));
  checks.push(createCheck(
    "doctor-runner-entry",
    "doctor resolves headless runner entry",
    Array.isArray(doctorPayload?.checks)
      && doctorPayload.checks.some((item) => item.id === "headless-runner-entry" && item.status === "pass")
  ));

  const helpCommands = [
    { id: "help", args: ["--help"], pattern: /Usage:/ },
    { id: "run-task-help", args: ["run", "task", "--help"], pattern: /CLI-launched headless runner/ },
    { id: "run-case-help", args: ["run", "case", "--help"], pattern: /single-case shortcut for run task/ },
  ];

  for (const item of helpCommands) {
    const result = runCommand(cliPath, item.args);
    commandResults.push({ id: item.id, ...summarizeCommand(result) });
    checks.push(createCheck(`${item.id}-exit-zero`, `${item.id} exits 0`, result.status === 0));
    checks.push(createCheck(`${item.id}-usage`, `${item.id} prints expected help`, item.pattern.test(result.stdout)));
  }

  let summaryPayload = null;
  if (taskId) {
    const summaryResult = runCommand(cliPath, ["reports", "show", taskId, "--summary", "--json"]);
    commandResults.push({ id: "reports-summary", ...summarizeCommand(summaryResult) });
    summaryPayload = parseJsonOutput(summaryResult);
    checks.push(createCheck("reports-summary-exit-zero", "reports show --summary exits 0", summaryResult.status === 0));
    checks.push(createCheck("reports-summary-success", "reports summary payload succeeds", summaryPayload.success === true));
    checks.push(createCheck(
      "reports-summary-diagnostics",
      "failed case summaries expose generic diagnostics",
      Array.isArray(summaryPayload.cases)
        && summaryPayload.cases
          .filter((item) => String(item.status || "") === "failed")
          .every((item) => Array.isArray(item.correlationIds)
            && Array.isArray(item.diagnosticHints)
            && Array.isArray(item.diagnosticLogSnippets))
    ));
  }

  let validationPayload = null;
  if (caseFile) {
    const caseFilePath = path.resolve(process.cwd(), caseFile);
    checks.push(createCheck("case-file-exists", "case file exists", fs.existsSync(caseFilePath), { caseFile: caseFilePath }));
    if (fs.existsSync(caseFilePath)) {
      const validationResult = runCommand(cliPath, ["cases", "validate", caseFilePath, "--json"]);
      commandResults.push({ id: "cases-validate", ...summarizeCommand(validationResult) });
      validationPayload = parseJsonOutput(validationResult);
      checks.push(createCheck("cases-validate-exit-zero", "cases validate exits 0", validationResult.status === 0));
      checks.push(createCheck("cases-validate-success", "cases validate payload succeeds", validationPayload.success === true));
    }
  }

  let reindexPayload = null;
  if (includeReindex) {
    const reindexResult = runCommand(cliPath, ["reports", "reindex", "--dry-run", "--json"]);
    commandResults.push({ id: "reports-reindex-dry-run", ...summarizeCommand(reindexResult) });
    reindexPayload = parseJsonOutput(reindexResult);
    checks.push(createCheck("reports-reindex-dry-run-exit-zero", "reports reindex --dry-run exits 0", reindexResult.status === 0));
    checks.push(createCheck("reports-reindex-schema", "reports reindex schema is glassbox.reports.reindex.v1", reindexPayload.schemaVersion === "glassbox.reports.reindex.v1"));
  }

  const afterReportCount = countReportPackages(reportPackagesDir);
  checks.push(createCheck("no-report-side-effects", "readonly checks do not create .glassreport files", beforeReportCount === afterReportCount, {
    beforeReportCount,
    afterReportCount,
    reportPackagesDir,
  }));

  const failedChecks = checks.filter((check) => check.status !== "pass");
  const payload = {
    schemaVersion: "glassbox.cli.readonlyVerify.v1",
    success: failedChecks.length === 0,
    cliPath,
    taskId,
    caseFile: caseFile ? path.resolve(process.cwd(), caseFile) : "",
    reportPackagesDir,
    reportCounts: {
      before: beforeReportCount,
      after: afterReportCount,
    },
    doctor: {
      schemaVersion: doctorPayload.schemaVersion || "",
      submissionType: doctorPayload?.cli?.submissionType || "",
      packagedAppPath: doctorPayload?.cli?.packagedAppPath || "",
      warnings: doctorPayload.warnings || [],
      recoveryActions: doctorPayload.recoveryActions || [],
    },
    summary: summaryPayload ? getSummaryCounts(summaryPayload) : null,
    validation: validationPayload ? {
      success: validationPayload.success === true,
      caseCount: Number(validationPayload.caseCount || 0),
      errors: validationPayload.errors || [],
      warnings: validationPayload.warnings || [],
    } : null,
    reindex: reindexPayload ? {
      success: reindexPayload.success === true,
      dryRun: reindexPayload.dryRun === true,
      summary: reindexPayload.summary || {},
    } : null,
    checks,
    commands: commandResults,
    recoveryActions: failedChecks.length
      ? [
        "Run glassbox doctor --json first and fix any failed checks before running automation tasks.",
        "If only sandbox-related local access failed, rerun the same command outside the sandbox.",
      ]
      : [],
  };

  if (jsonMode) {
    writeJson(payload);
  } else {
    console.log(`GlassBox CLI readonly verify: ${payload.success ? "PASS" : "FAIL"}`);
    checks.forEach((check) => {
      console.log(`${check.status === "pass" ? "OK" : "FAIL"}\t${check.id}\t${check.name}`);
    });
    if (summaryPayload) {
      const counts = payload.summary;
      console.log(`summary: success=${counts.successCount}, failed=${counts.failedCount}, stopped=${counts.stoppedCount}, running=${counts.runningCount}, pending=${counts.pendingCount}, completed=${counts.completed}, cases=${counts.caseCount}`);
    }
  }

  return payload.success ? 0 : 1;
}

process.exitCode = main();
