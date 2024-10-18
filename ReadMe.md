<!--
Copyright (C) 2021-2024 Giorgio Maone <https://maone.net>

SPDX-License-Identifier: GPL-3.0-or-later
-->

# NoScript Commmons Library

### What

A collection of reusable modules, APIs and documentation designed to facilitate the cross-browser development and maintenance of privacy and security browser extensions, helping them survive the restrictions imposed by Google's [Manifest V3](https://developer.chrome.com/extensions/migrating_to_manifest_v3) on Chromium-based browser, but in perspective on Firefox-based ones too, should Mozilla be forced to compromise and downgrade their WebExtensions API to some extent for compatibility's sake. Furthermore, it will aid developers porting and/or maintaining extensions on mobile browsers, such as the new Firefox for Android (code-name "Fenix"), which support just a subset of the APIs available on the desktop.

### Why

By abstracting the common functionality shared among security and privacy extensions, providing consistent implementations across multiple browser engines and shielding developers from the browser-dependent implementation details (which precisely in the most optimistic scenario, i.e. Firefox keeping its WebExtensions API as powerful as it is, are doomed to diverge dramatically), this library aims to minimize the additional maintenance burden and mitigate the danger of introducing new, insidious bugs and security vulnerabilities due to features mismatches and multiple code paths.

Cross-browser issues have a chance to be fixed or worked around in one single place, ideally with the help of multiple developers sharing the same requirements. The solutions will be subject to automated tests to timely catch regressions, especially those caused by further changes in the APIs provided by the different browsers. The residual browser-specific differences, compromises and corner cases which couldn't be addressed at all, or without significant performance penalties, are clearly benchmarked and documented, to make both developers and users well aware of the limitations imposed by each browser and capable of educated decisions, tailored to their security and privacy needs. This transparency should pressure browser vendors into increasing their support level, when they're are publicly shown to be measurably lacking in comparison with their competitors.

### How

To start using the NSCL, just add this repository as a git [submodule](https://git-scm.com/book/en/v2/Git-Tools-Submodules) and integrate the [include.sh](https://github.com/hackademix/nscl/blob/main/include.sh) script in your browser extensions building workflow.

Please use the [issue tracker](https://github.com/hackademix/nscl/issues) here for bug reports and RFEs, and [this forum](https://forums.informaction.com/viewforum.php?f=27) for general discussion.

![NoScript Commons Library](https://raw.githubusercontent.com/hackademix/nscl/main/nscl-logo.png)

#### Security reports

We strive to fix security sensitive issues in the shortest time possible (hours, ideally) while protecting users.
If you've find one, please report privately at [security@noscript.net](mailto:security@noscript.net).
To ensure confidentiality and protect users, please encrypt your report with this __PGP key__:
3359 0391 70A3 CD9B 25CF 5A46 231A 83AF DA9C 2434.
