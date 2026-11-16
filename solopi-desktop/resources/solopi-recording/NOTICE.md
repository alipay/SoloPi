# SoloPi recording companion

SoloPi.apk is the unmodified official SoloPi v1.0.2 release from
https://github.com/alipay/SoloPi/releases/tag/v1.0.2 .

Copyright 2015-present Ant Financial Services Group and SoloPi contributors.
Licensed under the Apache License, Version 2.0; see LICENSE.txt.

manifest.json records the immutable artifact URL, SHA-256, Android package/version,
and verified signing certificate digest. Desktop verifies the bundled bytes before
installation. No private SDK, credentials or user data are included.

The native Desktop recording adapter implements the documented scheme/HTTP
recording protocol from solopi-skill at the recorded protocolSourceRevision.
The Python CLI and Python runtime are not required by Desktop.
