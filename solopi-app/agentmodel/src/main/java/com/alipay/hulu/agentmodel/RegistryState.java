package com.alipay.hulu.agentmodel;

final class RegistryState {
    final String activeVersion;
    final String previousVersion;

    RegistryState(String activeVersion, String previousVersion) {
        this.activeVersion = activeVersion;
        this.previousVersion = previousVersion;
    }

    RegistryState activate(String version) {
        if (version.equals(activeVersion)) {
            return this;
        }
        return new RegistryState(version, activeVersion);
    }

    RegistryState rollback() {
        if (previousVersion == null || previousVersion.length() == 0) {
            throw new IllegalStateException("No previous version is available");
        }
        return new RegistryState(previousVersion, activeVersion);
    }
}
