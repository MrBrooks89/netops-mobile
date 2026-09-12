#!/usr/bin/env python3
"""Print uiautomator nodes with text/content-desc/bounds, optionally filtered.

Usage:
  scripts/emu.sh adb exec-out cat /sdcard/window_dump.xml | python3 scripts/ui-nodes.py [filter]
Filter matches text, content-desc or resource-id (case-insensitive substring).
"""
import re
import sys
import xml.etree.ElementTree as ET

raw = sys.stdin.read()
m = re.search(r"<\?xml.*?</hierarchy>", raw, re.S)
if not m:
    sys.exit("could not read UI hierarchy")
root = ET.fromstring(m.group(0))
needle = sys.argv[1].lower() if len(sys.argv) > 1 else None
for node in root.iter("node"):
    text = node.get("text") or ""
    desc = node.get("content-desc") or ""
    rid = node.get("resource-id") or ""
    if not (text or desc):
        continue
    if needle and needle not in (text + " " + desc + " " + rid).lower():
        continue
    label = text or desc
    kind = "text" if text else "desc"
    print(f"{node.get('bounds')}\t[{kind}] {label!r}\t{rid}")
