# Public source boundary

Public source consists of the generic application, CLI, the self-contained `solopi-desktop-cli` Skill and selected generic tests and documentation. Business Skills, team procedures, device assets, credentials, logs, reports, deployment records and collaboration material are not part of it.

Create a reviewable snapshot in a new directory:

```sh
node scripts/export-public-source.mjs /path/to/new-public-source
```

The exporter uses an allowlist, rejects private endpoint and credential candidates, and writes a file/hash manifest. It never copies `.git`, ignored runtime state, other Skills or media/Git runtime binaries. The checksum-pinned official SoloPi recording APK is included with its license and provenance. Inspect image ownership and the final manifest before publishing. Do not publish the private working repository or its history as a substitute for this snapshot.

Updates are disabled until a service is explicitly configured. Release pages and trusted artifact hosts are configured separately; no deployment URL is bundled. Device packages and business commands come from user configuration or cases.

This module is contributed to SoloPi under the existing Apache-2.0 root license. The export retains a copy in [LICENSE](../LICENSE), the project [NOTICE](../NOTICE), and [third-party distribution instructions](../THIRD_PARTY_NOTICES.md). This does not change the SoloPi repository license. Third-party dependencies keep their own licenses. A source snapshot is not permission to redistribute native tools: each binary distribution needs its actual version, build configuration, license notices and corresponding-source obligations reviewed. FFmpeg license depends on build options. Build recipes alone do not prove the license of a downloaded binary.
