const fs = require('node:fs');
const path = require('node:path');
const PRODUCT_NAME = 'solopi-desktop';
// Persistent macOS Keychain identity: changing branding must not change its key.
const KEYCHAIN_APP_NAME = 'LensWiper';
// Keep existing data in place; new installations use the public product name.
// Never move credentials or task state while another installation may be running.
function defaultDataDirectory(appData, exists = fs.existsSync) {
  const legacy = path.join(appData, 'Glass Box');
  if (exists(legacy)) return legacy;
  const previousBrand = path.join(appData, 'solopi-harness-desktop');
  return exists(previousBrand) ? previousBrand : path.join(appData, PRODUCT_NAME);
}
module.exports = { PRODUCT_NAME, KEYCHAIN_APP_NAME, defaultDataDirectory };
