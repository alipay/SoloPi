const fs = require('fs');
const path = require('path');

const CASE_FILE_PATTERN = /\.(?:json|ya?ml)$/i;
const IGNORED_PATH_PARTS = new Set([
  '.git',
  'assets',
  'node_modules',
]);

function normalizeRelativePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');
}

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isIgnoredRelativePath(relativePath) {
  return normalizeRelativePath(relativePath)
    .split('/')
    .some((part) => IGNORED_PATH_PARTS.has(part));
}

function createWatchSignature(entry) {
  return JSON.stringify({
    repoPath: path.resolve(entry.repoPath),
    casesRoot: normalizeRelativePath(entry.casesRoot || 'cases'),
    workspaceFile: normalizeRelativePath(entry.workspaceFile || ''),
  });
}

function createCaseLibraryWatcherManager(options = {}) {
  const fsModule = options.fsModule || fs;
  const debounceMs = Math.max(50, Number(options.debounceMs) || 400);
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
  const onError = typeof options.onError === 'function' ? options.onError : () => {};
  const watchers = new Map();

  const closeRecord = (record) => {
    if (record.timer) {
      clearTimeout(record.timer);
      record.timer = null;
    }
    record.handles.forEach((handle) => {
      try {
        handle.close();
      } catch (_error) {
        // The watcher may already have been invalidated by a rename/delete.
      }
    });
    record.handles = [];
  };

  const schedule = (record, changedPath = '') => {
    if (changedPath) {
      record.changedPaths.add(changedPath);
    }
    if (record.timer) {
      clearTimeout(record.timer);
    }
    record.timer = setTimeout(() => {
      record.timer = null;
      const changedPaths = Array.from(record.changedPaths);
      record.changedPaths.clear();
      Promise.resolve(onChange({
        ...record.entry,
        changedPaths,
        previousRevision: record.revision || '',
      })).catch((error) => onError(error, record.entry));
    }, debounceMs);
    record.timer.unref?.();
  };

  const shouldHandleEvent = (record, watchDir, filename) => {
    if (filename == null || String(filename).trim() === '') {
      return true;
    }
    const absolutePath = path.resolve(watchDir, String(filename));
    const relativePath = normalizeRelativePath(path.relative(record.entry.repoPath, absolutePath));
    if (!relativePath || isIgnoredRelativePath(relativePath)) {
      return false;
    }
    if (relativePath === 'manifest.json') {
      return true;
    }
    if (record.entry.workspaceFile && relativePath === normalizeRelativePath(record.entry.workspaceFile)) {
      return true;
    }
    const casesRootPath = path.resolve(
      record.entry.repoPath,
      normalizeRelativePath(record.entry.casesRoot || 'cases')
    );
    return isPathInside(casesRootPath, absolutePath) && CASE_FILE_PATTERN.test(relativePath);
  };

  const addWatch = (record, watchDir, recursive) => {
    if (!watchDir || !fsModule.existsSync(watchDir)) {
      return;
    }
    try {
      const handle = fsModule.watch(watchDir, { persistent: false, recursive }, (_eventType, filename) => {
        if (shouldHandleEvent(record, watchDir, filename)) {
          schedule(record, filename ? path.resolve(watchDir, String(filename)) : watchDir);
        }
      });
      handle.on?.('error', (error) => onError(error, record.entry));
      record.handles.push(handle);
    } catch (error) {
      if (!recursive) {
        throw error;
      }
      // Recursive fs.watch is supported by macOS. The fallback keeps tests and
      // other development hosts usable without introducing polling.
      const pending = [watchDir];
      while (pending.length > 0) {
        const current = pending.shift();
        if (!current || !fsModule.existsSync(current)) {
          continue;
        }
        addWatch(record, current, false);
        fsModule.readdirSync(current, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && !IGNORED_PATH_PARTS.has(entry.name))
          .forEach((entry) => pending.push(path.join(current, entry.name)));
      }
    }
  };

  const createRecord = (entry) => {
    const normalizedEntry = {
      ...entry,
      libraryId: String(entry.libraryId || '').trim(),
      repoPath: path.resolve(entry.repoPath),
      casesRoot: normalizeRelativePath(entry.casesRoot || 'cases'),
      workspaceFile: normalizeRelativePath(entry.workspaceFile || ''),
    };
    const record = {
      entry: normalizedEntry,
      signature: createWatchSignature(normalizedEntry),
      revision: String(entry.revision || ''),
      handles: [],
      timer: null,
      changedPaths: new Set(),
    };
    addWatch(record, normalizedEntry.repoPath, false);
    addWatch(record, path.resolve(normalizedEntry.repoPath, normalizedEntry.casesRoot), true);
    if (normalizedEntry.workspaceFile) {
      const workspacePath = path.resolve(normalizedEntry.repoPath, normalizedEntry.workspaceFile);
      const casesRootPath = path.resolve(normalizedEntry.repoPath, normalizedEntry.casesRoot);
      if (!isPathInside(casesRootPath, workspacePath)) {
        addWatch(record, path.dirname(workspacePath), false);
      }
    }
    return record;
  };

  return {
    sync(entries = []) {
      const nextIds = new Set();
      entries.forEach((entry) => {
        const libraryId = String(entry?.libraryId || '').trim();
        if (!libraryId || !entry?.repoPath) {
          return;
        }
        nextIds.add(libraryId);
        const signature = createWatchSignature(entry);
        const current = watchers.get(libraryId);
        if (current && current.signature === signature) {
          current.entry = { ...current.entry, ...entry };
          current.revision = String(entry.revision || current.revision || '');
          return;
        }
        if (current) {
          closeRecord(current);
        }
        try {
          watchers.set(libraryId, createRecord(entry));
        } catch (error) {
          onError(error, entry);
        }
      });
      Array.from(watchers.entries()).forEach(([libraryId, record]) => {
        if (!nextIds.has(libraryId)) {
          closeRecord(record);
          watchers.delete(libraryId);
        }
      });
    },
    getRevision(libraryId) {
      return watchers.get(libraryId)?.revision || '';
    },
    markRevision(libraryId, revision) {
      const record = watchers.get(libraryId);
      if (record) {
        record.revision = String(revision || '');
      }
    },
    close() {
      watchers.forEach(closeRecord);
      watchers.clear();
    },
    getWatchedLibraryIds() {
      return Array.from(watchers.keys());
    },
  };
}

module.exports = {
  createCaseLibraryWatcherManager,
  normalizeRelativePath,
};
