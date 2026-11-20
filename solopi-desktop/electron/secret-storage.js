const { isSecretReference } = require('./credential-storage');
// Persist credentials through the selected encrypted backend; never plaintext.
const secretKey = /^(apiKey|authToken|sshPassphrase|password|accessToken|refreshToken)$/i;
const encryptedPrefix = 'solopi-desktop:stored-secret:v1:';
const legacyPrefix = 'solopi-desktop:legacy-secret:v1:';
const legacySecrets = new Map();
const legacyReferences = new Map();

function storedValue(value) {
  if (typeof value !== 'string') return value;
  if (value.startsWith(encryptedPrefix)) {
    return { __glassboxEncrypted: 1, data: value.slice(encryptedPrefix.length) };
  }
  if (value.startsWith(legacyPrefix)) {
    if (!legacySecrets.has(value)) throw new Error('凭据引用已失效，请重新打开配置后重试');
    return legacySecrets.get(value);
  }
  return value;
}

// Reading settings must never touch the OS keychain. Keep password inputs string-compatible
// without giving the renderer plaintext. Unchanged references round-trip without encryption.
function prepareSecretsForDisplay(value) {
  if (Array.isArray(value)) return value.map(prepareSecretsForDisplay);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (secretKey.test(key) && child) {
      if (child?.__glassboxEncrypted === 1) return [key, encryptedPrefix + child.data];
      if (typeof child === 'string') {
        if (isSecretReference(child)) return [key, child];
        if (child.startsWith(encryptedPrefix) || child.startsWith(legacyPrefix)) return [key, child];
        if (!legacyReferences.has(child)) {
          const ref = legacyPrefix + require('node:crypto').randomUUID();
          legacyReferences.set(child, ref);
          legacySecrets.set(ref, child);
        }
        return [key, legacyReferences.get(child)];
      }
    }
    return [key, prepareSecretsForDisplay(child)];
  }));
}
function transform(value, storage, decrypt = false) {
  if (Array.isArray(value)) return value.map((item) => transform(item, storage, decrypt));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (secretKey.test(key) && child) {
      if (isSecretReference(child)) {
        if (!decrypt) return [key, child];
        if (!storage.resolveReference) throw Error('当前凭据后端不支持引用');
        return [key, storage.resolveReference(child)];
      }
      const original = child;
      child = storedValue(child);
      // Existing legacy credentials are preserved, not silently migrated during autosave.
      if (!decrypt && typeof original === 'string' && original.startsWith(legacyPrefix)) return [key, child];
      if (decrypt && child?.__glassboxEncrypted === 1) {
        try {
          return [key, storage.decryptString(Buffer.from(child.data, 'base64'))];
        } catch (cause) {
          const fileEncrypted = Buffer.from(child.data, 'base64').subarray(0,5).toString() === 'LWSF1';
          const message = fileEncrypted
            ? '无法读取本机加密凭据，请检查原凭据目录及访问权限；配置已保留。'
            : '无法读取系统钥匙串中的凭据，请确认应用身份及钥匙串授权；配置已保留。';
          throw Object.assign(new Error(message, {cause}), { code: 'SECRET_ACCESS_DENIED' });
        }
      }
      if (!decrypt && typeof child === 'string') {
        if (!storage.isEncryptionAvailable() || storage.getSelectedStorageBackend?.() === 'basic_text') {
          throw new Error('系统安全存储不可用，未保存凭据；请解锁系统钥匙串后重试');
        }
        return [key, { __glassboxEncrypted: 1, data: storage.encryptString(child).toString('base64') }];
      }
    }
    return [key, transform(child, storage, decrypt)];
  }));
}
module.exports = {
  prepareSecretsForDisplay,
  hasPlainSecrets: function hasPlainSecrets(value) {
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) =>
      (secretKey.test(key) && typeof child === 'string' && !isSecretReference(child) && child.length > 0) || hasPlainSecrets(child));
  },
  protectSecrets: (value, storage) => transform(value, storage),
  revealSecrets: (value, storage) => transform(value, storage, true),
};
