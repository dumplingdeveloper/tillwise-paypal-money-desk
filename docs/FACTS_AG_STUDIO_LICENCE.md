# Facts: AG Studio licence for a public hackathon repo judged until 15 Dec 2026

The quotes below are verbatim, fetched on 2026-10-25 with `curl` from a desktop user agent; HTML was reduced to text. Code references are to the installed package `alexa-sim/node_modules/ag-studio` (version 3.0.0, the one in `alexa-sim/package.json:22`).

**Question:** can judges run our public repo with AG Studio (no key, or an evaluation/trial key) until the end of the judging period on Tue 15 Dec 2026, and does the watermark or licence-key behaviour affect them?

## 1. Hackathon rules
Source: https://paypalaihackathon.devpost.com/rules

- Dates:
  - "Submission Period: Thursday Oct 1, 2026 (9:15 am Pacific Time) – Thursday Nov 12, 2026 (12:00 pm Pacific Time) (“Submission Period”)."
  - "Judging Period: Tuesday Dec 1, 2026 (2:00 pm Pacific Time) – Tuesday Dec 15, 2026 (8:00 am Pacific Time) (“Judging Period”)."
- Tool licences:
  - "Use of the developer tools will be subject to the license agreement related thereto." (§4 How To Enter)
  - "If a Project integrates any third-party SDK, APIs and/or data, Entrant must be authorized to use them in accordance with any terms and conditions or licensing requirements of the tool."
- AG Grid is a sponsor tool: "Select Sponsor Tools you may include:" followed by a list starting "AG Grid", "APIMatic", "Astropods", "Bryntum", …
- Judge access:
  - "The Entrant must make the Project available free of charge and without any restriction, for testing, evaluation and use by the Sponsor, Administrator and Judges until the Judging Period ends."
  - "Access can be provided … by including complete setup and run instructions in your project's code repository …, along with any test account credentials, API keys, or sandbox login details necessary to run and test the Project."
- Repository: "The repository must be public and open source by including an open source license file."

## 2. AG Grid sponsor page on Devpost
Source: https://paypalaihackathon.devpost.com/details/aggrid

- Heading "Best Use of AG Grid", then: "This award covers both what your dashboard looks like and how you build it."
- Heading "Start Building", then: "Get building free of charge with the free 45-day trial license." The "free 45-day trial license" link goes to https://www.ag-grid.com/studio/license-pricing/.
- "For any trial issues or hackathon questions: Connect with the AG Grid team via the PayPal Discord!" Links on the page: https://discord.com/invite/HP4BhW3hnp and https://discord.com/invite/sJ2G6DyvSK.

## 3. AG Grid / AG Studio terms
1. The docs page https://www.ag-grid.com/studio/javascript/licence-install.md (AG Studio 3.0.0, the "Note" block) says:
   > "You can test AG Studio locally without a licence. To test in production, access support, and remove the watermark and console warnings, [Request a Trial Licence](https://www.ag-grid.com/studio/license-pricing/?tab=trial)."
2. The pricing page https://www.ag-grid.com/studio/license-pricing/ (also `.md`) says:
   > "Start your 45-day enterprise trial" / "Explore the full enterprise capabilities of AG Studio with no restrictions or watermarks." / "Full enterprise features" / "45 days of access" / "Engineering support"
3. The Commercial EULA https://www.ag-grid.com/eula/commercial/ ("Version: 40", "Last Updated: 9 September 2026"), clause 13, Trial Licence, says:
   - 13.2(a): "…a revocable, non-exclusive, non-transferable and non-sublicensable licence to install, load, launch, access, run, execute, operate, and archive the Software Materials … solely for the Licensee's and its Affiliates' internal evaluation and review purposes to determine whether to enter into a paid licence of the Software and not for any other purpose;"
   - 13.2(b)(i): "for a period of sixty (60) days, consisting of a trial period of thirty (30) days and a further period of thirty (30) days during which the parties can agree to enter into a Licence Quote;"
   - 13.2(d): "the Licensee acknowledges that the Software may place watermarks on output …, have limited functionality, function for a limited period of time …"
   - 13.3(a): "provided for internal evaluation and review purposes only;"
4. The npm package says `"license": "Commercial"` (`alexa-sim/node_modules/ag-studio/package.json:22`).

## 4. What the shipped code does (AG Studio 3.0.0 UMD bundle `dist/umd/ag-studio.js`)
- **No key.** `validateLicense` (l.287860-287889) calls `outputMissingLicenseKey`.
  - That function prints the console banner and returns the watermark text "For Trial Use Only" (l.288144-288156).
  - Our live run captured the banner (`docs/evidence/money-desk-live-initial.json`, `licenceConsole`): "AG Studio Pro with AI License … License Key Not Found … All AG Studio Pro with AI features are unlocked for trial. If you want to hide the watermark please email info@ag-grid.com for a trial license key."
- **Watermark visibility.** It is shown only if `isForceWatermark(…) || !isLocalhost(…) && !isWebsiteUrl(…) && watermarkMessage` (l.287967).
  - `isLocalhost` matches only `127.0.0.1` or `localhost` (l.288021-288024).
  - The same rule exists in the embedded grid/charts licence managers (l.103739, l.216706).
  - So a judge who runs our README steps (`http://127.0.0.1:4179/money-desk.html`) sees no watermark: the elements exist with `ag-hidden` (`money-desk-live-initial.json` → `licence.watermarkElements[*].visible: false`).
  - A judge opening the page through a LAN IP or a hosted URL would see the "For Trial Use Only" watermark.
- **Features without a key.** The banner says "All … features are unlocked for trial." Our live runs used AI features (`createAiHarness`, `clientToolRunner`) with no key, and the plumbing test runs them with no key too.
- **Expired trial key.** `outputExpiredTrialKey` sets a watermark message (l.287886-287887; grid manager l.103905 "Trial Period Expired"). It is still hidden on localhost by the same rule. We did not test with a real or expired key.
- **What our repo does:**
  - It does not vendor AG Studio. The library is an npm dependency, and the sim serves it from `node_modules` at `/vendor/ag-studio.js` (`git ls-files | grep ag-studio` is empty).
  - It reads an optional key only from the `AG_STUDIO_LICENSE_KEY` env var, and commits no key.

## 5. Assessment (what is clear, and what is not)
Clear:
- Running locally with no key is explicitly allowed by the docs ("You can test AG Studio locally without a licence"). On `127.0.0.1` the code hides the watermark, but the console banner stays.
- No key is needed for judges to run the Money Desk on their own machine. Nothing in the code stops working on a date when no key is set.

Unclear (do NOT guess):
- The trial lengths disagree:
  - the Devpost page and the pricing page say 45 days;
  - EULA clause 13.2(b) says 30 + 30 = 60 days.
  - Either way, a trial key requested now (late Oct 2026) would expire before 15 Dec 2026.
- The EULA trial licence is "solely for … internal evaluation and review purposes". It is unclear whether a public repo that judges run, plus a public demo video, is within that, or whether the no-key local mode counts as a separate permission.
- The rules require a public, open-source repo. Ours is the GNU GPL v2 (`LICENSE`: "GNU GENERAL PUBLIC LICENSE Version 2, June 1991") and depends on a Commercial-licensed npm package that it does not redistribute. It is unclear whether AG Grid is fine with this, as the official boilerplate presumably expects.

## 6. Questions for the PayPal Discord (AG Grid team)
1. Is it acceptable for hackathon judges to run our public repo **locally without any AG Studio licence key** (console "License Key Not Found" banner, no watermark on 127.0.0.1) through the end of the Judging Period, **Tue 15 Dec 2026**?
2. The Devpost page and the pricing page say "45-day trial", while EULA v40 clause 13.2(b) says 30 + 30 days. Which applies to hackathon trial keys? Can a key be issued that stays valid until 15 Dec 2026 for judging?
3. Does EULA clause 13.2(a) / 13.3(a) ("internal evaluation and review purposes only") permit:
   - a public GitHub repo that depends on `ag-studio` from npm (not vendored);
   - a public YouTube demo of the Money Desk?
4. Our repo licence is GNU GPL v2, as the rules require an open-source licence. Is depending on the Commercial `ag-studio` npm package acceptable to AG Grid, given that we neither redistribute nor modify it?
5. If a trial key is used for the video, may the video show the AG Studio UI publicly? We will never commit or share the key.
