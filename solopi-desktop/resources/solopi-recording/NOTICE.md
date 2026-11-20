# SoloPi recording companion

SoloPi.apk is the unmodified SoloPi v1.0.4 companion from the upstream repository:
https://github.com/alipay/SoloPi/tree/84c28ed045926c413eaa548359d953f77ad0d7fb .

Copyright 2015-present Ant Financial Services Group and SoloPi contributors.
Licensed under the Apache License, Version 2.0; see LICENSE.txt.

manifest.json records the immutable artifact URL, SHA-256, Android package/version,
and verified signing certificate digest. Desktop verifies the bundled bytes before
installation. No private SDK, credentials or user data are included.

The native Desktop recording adapter implements the documented scheme/HTTP
recording protocol from solopi-skill at the recorded protocolSourceRevision.
The Python CLI and Python runtime are not required by Desktop.
