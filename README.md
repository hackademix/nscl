<!--
Copyright (C) 2021 Giorgio Maone <https://maone.net>

SPDX-License-Identifier: GPL-3.0-or-later
-->

<br>

<div align = center>

[![Badge License]][License]

<br>
<br>

<img 
    src = 'https://raw.githubusercontent.com/hackademix/nscl/main/nscl-logo.png' 
    width = 120
/>

# NSCL

***[NoScripts]*** *Commons Library, a collection containing **Modules**,* <br>
***Documentation*** *and **APIs** designed to for* ***cross-browser*** <br>
*development / maintenance of privacy / security extensions.*

<br>
<br>

[![Button Issues]][Issues]   
[![Button Forum]][Forum]

<br>
<br>

## Integration

Add this repository as a **[Git Submodule]** and integrate <br>
the  [`include.sh`]  script into your build workflow.

<br>
<br>

## Why

As **Google** is imposing **[Manifest V3]** on *chromium-based browsers* <br>
and **Mozilla** may comply and downgrade their **WebExtensions API** <br>
for compatibility sake as well, developers now have to struggle with <br>
the limited tool-set that remains.

*This library tries to alleviate some of these problems.*

<br>
<br>

## Mobile

This library is also useful in the aspect of porting / maintaining extension <br>
for mobile browser, such as the  `Fenix`  Android browser, considering <br>
that often only a small subset of the desktop **APIs** are supported.

<br>
<br>

## Details

By abstracting the common functionality shared among security and privacy extensions, <br>
providing consistent implementations across multiple browser engines and shielding <br>
developers from the browser-dependent implementation details (which precisely in <br>
the most optimistic scenario, i.e. Firefox keeping its WebExtensions API as powerful <br>
as it is, are doomed to diverge dramatically), this library aims to minimize the added <br>
maintenance burden and mitigate the danger of introducing new, insidious bugs <br>
and security vulnerabilities due to features mismatches and multiple code paths.

Cross-browser issues have a chance to be fixed / worked around in single place, <br>
ideally with the help of multiple developers sharing the same requirements.

The solutions will be subject to automated tests to timely catch regressions, <br>
especially those caused by further changes in the different browser APIs.

The residual browser-specific differences, compromises and corner cases <br>
which couldn't be addressed at all, or without significant performance <br>
penalties, are clearly bench marked and documented, to make both <br>
developers and users well aware of the limitations imposed by each <br>
browser and capable of educated decisions, tailored to their <br>
security and privacy needs.

This transparency should pressure browser vendors into <br>
increasing their support level, when they're publicly shown <br>
to be measurably lacking in comparison to their competitors.

<br>
<br>

## Security Reports

We strive to fix security sensitive issues in the shortest <br>
time possible - hours ideally - while protecting users.

Please report privately to **[security@noscript.net]**

To ensure confidentiality and protect users, <br>
please encrypt your report with this **PGP key**.

<br>

```
3359 0391 70A3 CD9B 25CF 5A46 231A 83AF DA9C 2434
```

</div>

<br>


<!----------------------------------------------------------------------------->

[security@noscript.net]: mailto:security@noscript.net
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


