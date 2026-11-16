// Local ADB child only. This does not claim ownership of pre-existing device PIDs.
function stopOwnedLogProcess(child, graceMs = 1000) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  if (child['__solopi-desktopStopRequested']) return;
  child['__solopi-desktopStopRequested'] = true;
  let timer;
  const done = () => { clearTimeout(timer); child.removeListener?.('exit', done); child.removeListener?.('close', done); };
  child.once('exit', done); child.once('close', done);
  timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} done(); }, graceMs);
  timer.unref?.();
  try { child.kill('SIGTERM'); } catch (_) { done(); }
}
function releaseOwnedLogAssertions(owners, streams, stop) {
  for (const [serial, owner] of Object.entries(owners || {})) {
    // Stop the captured owner even if the map has since been replaced. The stop
    // callback must conditionally remove the map entry, never stop its replacement.
    if (!owner?.taskOwned) stop(serial, owner);
  }
}
module.exports = { stopOwnedLogProcess, releaseOwnedLogAssertions };
