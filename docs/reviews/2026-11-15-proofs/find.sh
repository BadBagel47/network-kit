# The "Find a newer version" step of templates/update-network-kit.yml, with the tag list injected.
set -eo pipefail
current="$1"; WANTED="$3"
tags=$(printf '%s\n' $2 | sed 's#^v##' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V)
if [ -n "$WANTED" ]; then
  echo "$tags" | grep -qx "$WANTED" || { echo "::error::network-kit v$WANTED does not exist"; exit 1; }
  target="$WANTED"
else
  line=$(echo "$current" | cut -d. -f1,2)
  target=$(echo "$tags" | grep -E "^${line//./\\.}\.[0-9]+$" | tail -1)
fi
if [ -z "$target" ] || [ "$target" = "$current" ] || \
   [ "$(printf '%s\n%s\n' "$current" "$target" | sort -V | tail -1)" = "$current" ]; then
  echo "network-kit $current is up to date"
  exit 0
fi
kind=patch
[ "$(echo "$target" | cut -d. -f1,2)" != "$(echo "$current" | cut -d. -f1,2)" ] && kind=feature
echo "current=$current target=$target kind=$kind"
