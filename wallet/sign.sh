#!/usr/bin/env bash
# Turns a folder like passes/membership.pass into a signed membership.pkpass.
# Needs: your Pass Type ID certificate (.p12) from developer.apple.com and Apple's WWDR cert (AppleWWDRCAG4.cer).
# Usage: ./sign.sh passes/membership.pass cert.p12 AppleWWDRCAG4.cer
set -euo pipefail
PASS_DIR=$1; P12=$2; WWDR=$3
OUT="$(basename "$PASS_DIR" .pass).pkpass"
TMP=$(mktemp -d)
cp "$PASS_DIR"/* "$TMP"/
( cd "$TMP"
  python3 -c 'import hashlib,json,os;json.dump({f:hashlib.sha1(open(f,"rb").read()).hexdigest() for f in sorted(os.listdir(".")) if f!="manifest.json"},open("manifest.json","w"))'
  openssl pkcs12 -in "$OLDPWD/$P12" -clcerts -nokeys -out cert.pem -legacy 2>/dev/null || openssl pkcs12 -in "$OLDPWD/$P12" -clcerts -nokeys -out cert.pem
  openssl pkcs12 -in "$OLDPWD/$P12" -nocerts -nodes -out key.pem -legacy 2>/dev/null || openssl pkcs12 -in "$OLDPWD/$P12" -nocerts -nodes -out key.pem
  openssl x509 -inform der -in "$OLDPWD/$WWDR" -out wwdr.pem
  openssl smime -binary -sign -certfile wwdr.pem -signer cert.pem -inkey key.pem -in manifest.json -out signature -outform DER
  rm cert.pem key.pem wwdr.pem
  zip -q -r "$OLDPWD/$OUT" . )
rm -rf "$TMP"
echo "Built $OUT — AirDrop or email it to your iPhone to add it to Wallet."
