## Contributing to SoloPi

Soloπ is released under the Apache 2.0 license, and follows a very standard Github development process, using Github tracker for issues and merging pull requests into master . If you would like to contribute something, or simply want to hack on the code this document should help you get started.

### Sign the Contributor License Agreement

Before we accept a non-trivial patch or pull request we will need you to sign the Contributor License Agreement. Signing the contributor’s agreement does not grant anyone commit rights to the main repository, but it does mean that we can accept your contributions, and you will get an author credit if we do. Active contributors might be asked to join the core team, and given the ability to merge pull requests.

To get started, [sign the Contributor License Agreement](https://www.clahub.com/agreements/alipay/SoloPi).

### Code Conventions

None of these is essential for a pull request, but they will all help.

1. Make sure all new `.java` files to have a simple Javadoc class comment with at least an `@author` tag identifying you, and preferably at least a paragraph on what the class is for.
2. Add the ASF license header comment to all new `.java` files (copy from existing files in the project)
3. Add yourself as an `@author` to the `.java` files that you modify substantially (more than cosmetic changes).
4. Add some Javadocs.
5. When writing a commit message please follow [these conventions](https://tbaggery.com/2008/04/19/a-note-about-git-commit-messages.html), if you are fixing an existing issue please add Fixes gh-XXXX at the end of the commit message (where XXXX is the issue number).
