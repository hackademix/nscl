<!--
Copyright (C) 2021 Giorgio Maone <https://maone.net>

SPDX-License-Identifier: GPL-3.0-or-later
-->

<br>

<div align = center>

[![Badge License]][License]

<br>

<img 
    src = 'https://raw.githubusercontent.com/hackademix/nscl/main/nscl-logo.png' 
    width = 160
/>

# NSCL

***[NoScripts]*** *Commons Library, a collection containing **Modules**,* <br>
***Documentation*** *and **APIs** designed to for* ***cross-browser*** <br>
*development / maintenance of privacy / security extensions.*

<br>
<br>

[![Button Issues]][Issues]   
[![Button Forum]][Forum]

</div>

<br>
<br>

## Integration

-   Add this repository as a **[Git Submodule]**

-   Add the  [`include.sh`]  script into your build workflow

<br>
<br>

## Why

As **Google** is imposing **[Manifest V3]** on *chromium-based browsers* <br>
and **Mozilla** may comply and downgrade their **WebExtensions API** <br>
for compatibility sake as well, developers now have to struggle with <br>
the limited tool-set that remains.

This library tries to alleviate some of these problems.

<br>
<br>

## Mobile

This library is also useful in the aspect of porting / maintaining extension <br>
for mobile browser, such as the `Fenix` Android browser, considering that <br>
often only a small subset of the desktop **APIs** are supported.

<br>
<br>

## Details

By abstracting the common functionality shared among security and privacy extensions, providing consistent implementations across multiple browser engines and shielding developers from the browser-dependent implementation details (which precisely in the most optimistic scenario, i.e. Firefox keeping its WebExtensions API as powerful as it is, are doomed to diverge dramatically), this library aims to minimize the additional maintenance burden and mitigate the danger of introducing new, insidious bugs and security vulnerabilities due to features mismatches and multiple code paths.

Cross-browser issues have a chance to be fixed or worked around in one single place, ideally with the help of multiple developers sharing the same requirements. The solutions will be subject to automated tests to timely catch regressions, especially those caused by further changes in the APIs provided by the different browsers.

The residual browser-specific differences, compromises and corner cases which couldn't be addressed at all, or without significant performance penalties, are clearly benchmarked and documented, to make both developers and users well aware of the limitations imposed by each browser and capable of educated decisions, tailored to their security and privacy needs. This transparency should pressure browser vendors into increasing their support level, when they're are publicly shown to be measurably lacking in comparison with their competitors.

<br>
<br>

## Security Reports

We strive to fix security sensitive issues in the shortest <br>
time possible (hours, ideally) while protecting users.

If you've find one, please report privately at [security@noscript.net](mailto:security@noscript.net).
To ensure confidentiality and protect users, please encrypt your report with this __PGP key__:
3359 0391 70A3 CD9B 25CF 5A46 231A 83AF DA9C 2434.

<br>


<!----------------------------------------------------------------------------->

[Git Submodule]: https://git-scm.com/book/en/v2/Git-Tools-Submodules
[Manifest V3]: https://developer.chrome.com/extensions/migrating_to_manifest_v3
[NoScripts]: https://github.com/hackademix/noscript
[Issues]: https://github.com/hackademix/nscl/issues
[Forum]: https://forums.informaction.com/viewforum.php?f=27

[`include.sh`]: include.sh
[License]: LICENSE


<!----------------------------------[ Badges ]--------------------------------->

[Badge License]: https://img.shields.io/badge/License-GPL3-015d93.svg?style=for-the-badge&labelColor=blue


<!---------------------------------[ Buttons ]--------------------------------->

[Button Issues]: https://img.shields.io/badge/Issues-A9225C?style=for-the-badge&logoColor=white&logo=Hackaday
[Button Forum]: https://img.shields.io/badge/Forum-7F2B7B?style=for-the-badge&logoColor=white&logo=ApacheCouchDB


