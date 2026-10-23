const fs = require('fs');
const path = require('path');

const USER_PROFILE_SCHEMA_VERSION = 'glassbox.user-profile.v1';
const EMBEDDED_BUSINESS_AUTH_REVISION = 'glassbox.embedded-business-auth.v1';

function normalizeClientUser(value = {}) {
  const userName = String(value?.userName || '').trim();
  const nickName = String(value?.nickName || '').trim();
  const displayName = String(value?.displayName || '').trim();
  const userId = String(value?.userId || '').trim();
  const avatarUrl = String(value?.avatarUrl || '').trim();
  const businessAuthRevision = String(value?.businessAuthRevision || '').trim();
  const businessAuthVerifiedAt = String(value?.businessAuthVerifiedAt || '').trim();
  const businessAuthTargets = Array.isArray(value?.businessAuthTargets)
    ? [...new Set(value.businessAuthTargets.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];

  if (!userId || !(nickName || displayName || userName)) {
    return null;
  }

  const profile = {
    schemaVersion: USER_PROFILE_SCHEMA_VERSION,
    userName,
    nickName,
    displayName,
    userId,
    avatarUrl,
    verifiedAt: new Date().toISOString(),
  };

  if (businessAuthRevision === EMBEDDED_BUSINESS_AUTH_REVISION && businessAuthTargets.length > 0) {
    return {
      ...profile,
      businessAuthRevision,
      businessAuthVerifiedAt: businessAuthVerifiedAt || new Date().toISOString(),
      businessAuthTargets,
    };
  }

  return profile;
}

function getUserProfilePath(userDataDir) {
  return path.join(userDataDir, 'auth', 'user-profile.json');
}

function readCachedUserProfile(userDataDir) {
  const filePath = getUserProfilePath(userDataDir);
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed?.schemaVersion !== USER_PROFILE_SCHEMA_VERSION) {
      return null;
    }
    const normalized = normalizeClientUser(parsed);
    return normalized ? { ...normalized, verifiedAt: String(parsed.verifiedAt || '') } : null;
  } catch (_error) {
    return null;
  }
}

function writeCachedUserProfile(userDataDir, value) {
  const profile = normalizeClientUser(value);
  if (!profile) {
    const error = new Error('登录用户信息不完整，请重新登录');
    error.code = 'GLASSBOX_AUTH_PROFILE_INVALID';
    throw error;
  }

  const filePath = getUserProfilePath(userDataDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(profile, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
  return profile;
}

function clearCachedUserProfile(userDataDir) {
  fs.rmSync(getUserProfilePath(userDataDir), { force: true });
}

module.exports = {
  USER_PROFILE_SCHEMA_VERSION,
  EMBEDDED_BUSINESS_AUTH_REVISION,
  clearCachedUserProfile,
  getUserProfilePath,
  normalizeClientUser,
  readCachedUserProfile,
  writeCachedUserProfile,
};
