const fs = require('node:fs');
const path = require('node:path');
const MAX_BYTES = 2 * 1024 * 1024;

// Read a single flat document, then use the same save path as inline input.
// Never accept an export wrapper or silently prefer one of two sources.
function resolveDocument(args) {
  const inline = args.document !== undefined;
  const file = args.documentPath !== undefined;
  if (inline === file) throw Error('document 与 documentPath 必须且只能提供一个');
  if (!file) return args;
  if (typeof args.documentPath !== 'string' || !path.isAbsolute(args.documentPath)) throw Error('documentPath 必须是绝对文件路径');
  const fd = fs.openSync(args.documentPath, 'r');
  let bytes;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw Error('documentPath 必须是最多 2 MiB 的普通 JSON 文件');
    bytes = Buffer.alloc(MAX_BYTES + 1);
    let size = 0, count;
    while (size < bytes.length && (count = fs.readSync(fd, bytes, size, bytes.length - size, null)) > 0) size += count;
    if (size > MAX_BYTES) throw Error('用例文档超过 2 MiB');
    bytes = bytes.subarray(0, size);
  } finally { fs.closeSync(fd); }
  const document = JSON.parse(bytes.toString('utf8'));
  const Ajv = require('ajv');
  const validate = new Ajv({strict:false}).compile(require('./case-contract').documentSchema);
  if (!validate(document)) throw Error(`文件须为单个平铺用例 document：${JSON.stringify(validate.errors)}`);
  if (document.id !== args.caseId) throw Error('文件 document.id 必须等于 caseId');
  const {documentPath, ...rest} = args;
  return {...rest, document};
}
module.exports = {resolveDocument};
