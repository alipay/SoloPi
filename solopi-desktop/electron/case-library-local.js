const crypto = require('crypto');
const path = require('path');

function normalizeCaseLibraryBranch(branch) {
  return String(branch || 'master').trim() || 'master';
}

function getLocalCaseLibraryRepoId(repoUrl, branch = 'master') {
  return crypto.createHash('sha1')
    .update(`${String(repoUrl || '').trim()}#${normalizeCaseLibraryBranch(branch)}`)
    .digest('hex')
    .slice(0, 16);
}

function getLocalCaseLibraryRepoPath(dataDir, repoUrl, branch = 'master') {
  return path.join(
    dataDir,
    'case-libraries',
    getLocalCaseLibraryRepoId(repoUrl, branch)
  );
}

function createLocalCaseLibraryRevision(manifest = {}, files = []) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(manifest || {}));
  [...files]
    .sort((left, right) => String(left.relativePath || left.path || '')
      .localeCompare(String(right.relativePath || right.path || '')))
    .forEach((file) => {
      hash.update('\0');
      hash.update(String(file.relativePath || file.path || file.name || ''));
      hash.update('\0');
      hash.update(String(file.content || ''));
    });
  return hash.digest('hex');
}

function normalizeCaseLibraryRelativePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');
}

function createCaseLibraryWorkspaceError(code, message, details = {}) {
  return Object.assign(new Error(message), {
    code,
    details,
  });
}

function parseLocalCaseLibraryWorkspace(manifest = {}, files = []) {
  const declaredWorkspaceFile = normalizeCaseLibraryRelativePath(manifest.workspaceFile);
  let workspaceFile = null;
  let workspace = null;

  if (declaredWorkspaceFile) {
    workspaceFile = files.find((file) => (
      normalizeCaseLibraryRelativePath(file.relativePath || file.path) === declaredWorkspaceFile
    )) || null;
    if (!workspaceFile) {
      throw createCaseLibraryWorkspaceError(
        'CASE_LIBRARY_WORKSPACE_FILE_NOT_FOUND',
        `manifest 声明的 workspace 文件不存在：${declaredWorkspaceFile}`,
        { workspaceFile: declaredWorkspaceFile }
      );
    }
    try {
      workspace = JSON.parse(workspaceFile.content);
    } catch (error) {
      throw createCaseLibraryWorkspaceError(
        'CASE_LIBRARY_WORKSPACE_JSON_INVALID',
        `workspace JSON 解析失败：${declaredWorkspaceFile}：${error.message}`,
        { workspaceFile: declaredWorkspaceFile }
      );
    }
  } else {
    for (const file of files) {
      if (!/\.json$/i.test(file.relativePath || file.name || '')) {
        continue;
      }
      try {
        const parsed = JSON.parse(file.content);
        if (parsed?.schemaVersion === 'glassbox.case-library.workspace.v1') {
          workspaceFile = file;
          workspace = parsed;
          break;
        }
      } catch (_error) {
        // Non-workspace files are parsed by the legacy per-case path.
      }
    }
  }

  if (!workspaceFile || !workspace) {
    return null;
  }
  const relativePath = normalizeCaseLibraryRelativePath(workspaceFile.relativePath || workspaceFile.path);
  if (workspace.schemaVersion !== 'glassbox.case-library.workspace.v1') {
    throw createCaseLibraryWorkspaceError(
      'CASE_LIBRARY_WORKSPACE_SCHEMA_UNSUPPORTED',
      `workspace schema 不受支持：${workspace.schemaVersion || '(empty)'}`,
      { workspaceFile: relativePath, schemaVersion: workspace.schemaVersion || '' }
    );
  }
  if (!Array.isArray(workspace.cases)) {
    throw createCaseLibraryWorkspaceError(
      'CASE_LIBRARY_WORKSPACE_CASES_INVALID',
      'workspace 缺少 cases[]',
      { workspaceFile: relativePath }
    );
  }

  return {
    relativePath,
    workspace: {
      ...workspace,
      cases: workspace.cases.map((testCase) => (
        testCase && typeof testCase === 'object' && !testCase.schemaVersion
          ? { ...testCase, schemaVersion: 'glassbox.workflow.v1' }
          : testCase
      )),
    },
  };
}

module.exports = {
  createLocalCaseLibraryRevision,
  getLocalCaseLibraryRepoId,
  getLocalCaseLibraryRepoPath,
  normalizeCaseLibraryBranch,
  parseLocalCaseLibraryWorkspace,
};
