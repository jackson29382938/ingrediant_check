# Simpler extension screens

This round applies the uploaded UI UX Pro Max skill's minimalist layout,
progressive disclosure, responsive layout, and accessibility guidance to the
extension. Its marketing-page templates do not match this utility, so the app
keeps its existing semantic green theme and system fonts. No remote assets or
runtime dependencies are introduced.

- Use one shared navigation pattern for Settings, Labels & saved, and Purchase
  history. Mark the active destination and provide a keyboard skip link.
- Keep the active goal visible in the popup; reveal goal categories only when
  the reader chooses “Change goals.” Make checking a label the primary action.
- Put a labeled search above settings. Search only filters the current detail
  view; the detail selector remains available when nothing matches.
- Offer “Show essentials” as an explicit choice using the existing Simple level.
  Do not silently reset a returning reader's detail level, goals, weights,
  warnings, or saved data. Hidden settings continue to work.
- Put the long list of detail levels behind a native disclosure. Preserve the
  native radio controls and their existing persistence behavior.
- Use comfortable controls, visible focus indicators, reduced-motion support,
  and wrapping navigation. Give the label page breathing room on narrow screens
  and apply dark mode to its checked-label panel as well as the page.

## Visual and interaction checks

Run `HARNESS_CHROME=/path/to/chromium npm run ui:check` with the already installed
Playwright package. `UI_REVIEW_OUTPUT` controls the screenshot directory (default
`/tmp/ic-ui-review`). `UI_REVIEW_SOURCE` can point to a prior checkout to capture
baseline screenshots without running new interaction assertions against it.

The review renders the real settings, popup, label library, purchase-history,
and report pages in Chromium. It uses isolated synthetic browser storage and
intercepts page resources locally. It checks settings search and recovery, an
explicit detail-level change without changing scoring preferences, keyboard
goal tabs, real label scoring, dark appearance, page errors, and horizontal
overflow at 375px. Desktop, narrow, and dark screenshots support visual review.
The separate history browser check covers populated purchase insights.

This does not verify unpacked-extension installation, live store pages, or real
user accounts. In this managed browser, policy prevents unpacked installation;
content-script regression checks run separately with `HARNESS_CONTENT_ONLY=1`.
