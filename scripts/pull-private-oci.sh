#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: REGISTRY_USERNAME=... REGISTRY_PASSWORD=... $0 IMAGE OUTPUT" >&2
  exit 2
fi
: "${REGISTRY_USERNAME:?REGISTRY_USERNAME is required}"
: "${REGISTRY_PASSWORD:?REGISTRY_PASSWORD is required}"

image="$1"
output="$2"
registry="${image%%/*}"
remainder="${image#*/}"
repository="${remainder%:*}"
reference="${remainder##*:}"
case "$reference" in
  "$remainder") echo "IMAGE must contain a tag" >&2; exit 2 ;;
esac

token="$(curl --retry 4 --retry-all-errors -fsSL \
  --user "$REGISTRY_USERNAME:$REGISTRY_PASSWORD" \
  "https://$registry/token?service=$registry&scope=repository:$repository:pull" | jq -er .token)"
authorization="Authorization: Bearer $token"
accept="Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json"
workspace="$(mktemp -d /tmp/benchly-oci.XXXXXX)"
layout="$workspace/layout"
mkdir -p "$layout/blobs/sha256"

curl --retry 4 --retry-all-errors -fsSL -H "$authorization" -H "$accept" \
  "https://$registry/v2/$repository/manifests/$reference" -o "$workspace/index.json"
manifest_digest="$(jq -er '.manifests[] | select(.platform.os == "linux" and .platform.architecture == "amd64") | .digest' "$workspace/index.json" | head -1)"
manifest_hex="${manifest_digest#sha256:}"
curl --retry 4 --retry-all-errors -fsSL -H "$authorization" -H "$accept" \
  "https://$registry/v2/$repository/manifests/$manifest_digest" -o "$layout/blobs/sha256/$manifest_hex"

actual_manifest="$(shasum -a 256 "$layout/blobs/sha256/$manifest_hex" | awk '{print $1}')"
test "$actual_manifest" = "$manifest_hex"

jq -r '.config.digest, .layers[].digest' "$layout/blobs/sha256/$manifest_hex" | while IFS= read -r digest; do
  hex="${digest#sha256:}"
  curl --retry 4 --retry-all-errors -fsSL -H "$authorization" \
    "https://$registry/v2/$repository/blobs/$digest" -o "$layout/blobs/sha256/$hex"
  actual="$(shasum -a 256 "$layout/blobs/sha256/$hex" | awk '{print $1}')"
  test "$actual" = "$hex"
done

manifest_size="$(wc -c < "$layout/blobs/sha256/$manifest_hex" | tr -d ' ')"
manifest_media_type="$(jq -er .mediaType "$layout/blobs/sha256/$manifest_hex")"
jq -n \
  --arg mediaType "$manifest_media_type" \
  --arg digest "$manifest_digest" \
  --arg reference "$reference" \
  --argjson size "$manifest_size" \
  '{schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json", manifests: [{mediaType: $mediaType, digest: $digest, size: $size, annotations: {"org.opencontainers.image.ref.name": $reference}, platform: {os: "linux", architecture: "amd64"}}]}' \
  > "$layout/index.json"
printf '%s\n' '{"imageLayoutVersion":"1.0.0"}' > "$layout/oci-layout"
tar -C "$layout" -cf "$output" .
printf '%s\t%s\n' "$manifest_digest" "$output"
