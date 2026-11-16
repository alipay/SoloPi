const numeric = value => typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : null;
function parseBattery(text = '') {
  const fields = Object.fromEntries(text.split(/\r?\n/).map(line => line.match(/^\s*([^:]+):\s*(.*?)\s*$/)).filter(Boolean).map(m => [m[1].toLowerCase(), m[2]]));
  const level = numeric(fields.level), scale = numeric(fields.scale);
  const simulated = /UPDATES STOPPED/i.test(text);
  const present = fields.present === 'true' ? true : fields.present === 'false' ? false : null;
  const valid = !simulated && present === true && level !== null && scale > 0 && level >= 0 && level <= scale;
  const temperature = numeric(fields.temperature), voltage = numeric(fields.voltage);
  const power = ['ac', 'usb', 'wireless', 'dock'].map(key => fields[`${key} powered`]);
  return { valid, simulated, present, levelPercent: valid ? level / scale * 100 : null,
    temperatureC: !simulated && temperature !== null ? temperature / 10 : null,
    voltageMv: !simulated && voltage > 0 ? voltage : null,
    powered: power.includes('true') ? true : power.every(v => v === 'false') ? false : null,
  };
}

function performanceBatteryMetrics(raw) {
  const battery = parseBattery(raw);
  if (battery.simulated || battery.present !== true || battery.temperatureC === null) {
    return { batteryError: '电池温度不可用（设备未提供有效读数）' };
  }
  return {
    batteryTemperatureC: battery.temperatureC,
    batteryLevelPercent: battery.levelPercent ?? undefined,
    batteryVoltageMv: battery.voltageMv ?? undefined,
    batteryPowered: battery.powered ?? undefined,
  };
}


// Device-wide battery readings; never an application's energy consumption.
async function collectPerformanceBattery(run, signal) {
  signal?.throwIfAborted();
  let raw = '';
  try {
    raw = await run(signal);
    signal?.throwIfAborted();
    return { raw, ...performanceBatteryMetrics(raw) };
  } catch (error) {
    signal?.throwIfAborted();
    return { raw: String(error.stdout || raw), batteryError: '电池状态读取失败', batteryDiagnostic: String(error.message || error) };
  }
}
module.exports = { parseBattery, performanceBatteryMetrics, collectPerformanceBattery };
