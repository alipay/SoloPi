const fs = require('node:fs');
const path = require('node:path');

// Save a text document with optional sibling assets. Unique directories prevent an
// overwrite of one report from changing images referenced by another report.
function saveTextExport(filePath, content, attachments) {
  let assetDirectory;
  try {
    if (attachments) {
      if (!/^performance-images-[a-f0-9-]{36}$/.test(attachments.directory || '')
        || !Array.isArray(attachments.files) || attachments.files.length > 16) {
        throw new Error('Invalid export attachments');
      }
      const files = attachments.files.map(file => {
        if (!/^[a-z0-9-]+\.png$/.test(file.name || '') || typeof file.base64 !== 'string'
          || file.base64.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.base64)) {
          throw new Error('Invalid export image');
        }
        const data = Buffer.from(file.base64, 'base64');
        if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid PNG image');
        return { name: file.name, data };
      });
      const destination = path.join(path.dirname(filePath), attachments.directory);
      fs.mkdirSync(destination); // Fail rather than reusing or overwriting an existing directory.
      assetDirectory = destination;
      for (const file of files) fs.writeFileSync(path.join(destination, file.name), file.data, { flag: 'wx' });
    }
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (error) {
    if (assetDirectory) fs.rmSync(assetDirectory, { recursive: true, force: true });
    throw error;
  }
}
module.exports = { saveTextExport };
