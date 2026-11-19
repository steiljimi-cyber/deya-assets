# deyadeyadeya: Apple Wallet passes

Four pass designs in the brand lime (`#D9FF43`) and ink (`#0E0F0A`):

| Folder | Wallet style | What it's for |
|---|---|---|
| `passes/membership.pass` | generic | Member card: name, number, tier |
| `passes/loyalty.pass` | storeCard | 10-stamp loyalty card |
| `passes/event.pass` | eventTicket | Event ticket: date, venue, guest |
| `passes/contact.pass` | generic | Digital business card with a QR code that opens your link |

Each folder holds `pass.json` and the images at the sizes Apple asks for (`icon`, `logo`, `strip` or `thumbnail`, at @1x/@2x/@3x).
`preview.html` shows the four passes as Wallet lays them out.

## Edit
- Text and the QR code: change the values in each `pass.json`. "Your Name", "Venue name" and the other fields are examples.
- Artwork: change the SVGs in `build.js`, then run `node wallet/build.js` (needs Playwright).

## Put a pass on your iPhone
Wallet only opens passes signed with an Apple certificate.

**With an Apple Developer account ($99/yr):**
1. In Certificates, Identifiers & Profiles, create a Pass Type ID, for example `pass.com.deyadeyadeya.membership`, and download its certificate as a `.p12`.
2. Download Apple's WWDR intermediate certificate (`AppleWWDRCAG4.cer`).
3. In `pass.json`, set `passTypeIdentifier` to that ID and `teamIdentifier` to your Team ID.
4. Run `./sign.sh passes/membership.pass cert.p12 AppleWWDRCAG4.cer`, then AirDrop or email the `.pkpass` to your phone.

**Without a developer account:** use a pass-builder app such as Pass2U Wallet. Upload the PNGs from a pass folder and copy in the colors and field text from its `pass.json`.

Apple doesn't let anyone restyle bank or credit cards in Wallet. Their artwork comes from the card issuer.
