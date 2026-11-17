// Desktop uses the user-validated local runtime. Server runtimes are independent.
const { AgentRuntime } = require('./runtime');
function createDesktopRuntime(options) { return new AgentRuntime(options); }
module.exports = { createDesktopRuntime };
