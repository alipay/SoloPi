// Android toybox/toolbox top columns vary by ROM. Resolve CPU and process columns
// from the header, never interpret a command argument as a CPU value.
function parseAndroidTopProcess(output, packageName, pid = '') {
  let header;
  for (const line of String(output || '').split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns[0] === 'PID') {
      header = columns.flatMap(c => c === 'S[%CPU]' ? ['S', '%CPU'] : [c.replace(/[\[\]]/g, '')]);
      continue;
    }
    if (!header || !/^\d+$/.test(columns[0] || '')) continue;
    const cpuIndex = header.findIndex(c => /^(%CPU|CPU%|CPU)$/.test(c));
    const nameIndex = header.findIndex(c => /^(ARGS|NAME|CMD|COMMAND)$/.test(c));
    if (cpuIndex < 0 || nameIndex < 0) continue;
    const name = columns[nameIndex];
    // An exact package is mandatory if PID was unavailable; no substring matching.
    if (pid ? columns[0] !== String(pid) : name !== packageName) continue;
    const cpuPercent = Number(columns[cpuIndex]?.replace('%', ''));
    if (!Number.isFinite(cpuPercent) || cpuPercent < 0) continue;
    return { pid: columns[0], cpuPercent, cpuSource: 'top', cpuUnit: 'percent-one-core', processLine: line };
  }
  return {};
}
module.exports = { parseAndroidTopProcess };
