#!/usr/bin/env python3
"""
One-shot tool: Create .src.js files from .user.js files by removing functions
that are now in common.js and inserting the // #COMMON_CODE marker.

Run once, verify results, then delete this script.
"""

import re
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(REPO, 'src')

# Functions to remove (defined in common.js)
COMMON_FUNCTIONS = {
    'nowTs', 'nowUnix', 'safeJsonParse', 'formatNumber', 'formatMoney',
    'ageText', 'escapeHtml', 'addLog', 'getStorage', 'setStorage',
    'getBubbleEl', 'getPanelEl', 'bringToFront', 'clampToViewport',
    'bubbleRightBottomToLeftTop', 'leftTopToBubbleRightBottom',
    'getDefaultBubblePosition', 'getBubblePosition', 'setBubblePosition',
    'getPanelPosition', 'setPanelPosition',
    'copyToClipboard', 'makeDraggableBubble', 'makeDraggablePanel',
    'expandPanelNearBubble', 'collapseToBubble', 'onResize',
    'extractApiKeyFromUrl',
    # Per-script API key functions (replaced by shared key in common)
    'getManualApiKey', 'setManualApiKey',
}

# Pattern to match function declaration start
FUNC_RE = re.compile(r'^(\s*)(?:async\s+)?function\s+(\w+)\s*\(')


def count_braces(line):
    """Count net { minus } in a line, ignoring strings."""
    depth = 0
    in_str = None
    escaped = False
    for ch in line:
        if escaped:
            escaped = False
            continue
        if ch == '\\':
            escaped = True
            continue
        if in_str:
            if ch == in_str:
                in_str = None
            continue
        if ch in ('"', "'", '`'):
            in_str = ch
            continue
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
    return depth


def find_state_close(lines, start):
    """Find the line where the STATE = { ... }; closes."""
    depth = 0
    for i in range(start, len(lines)):
        depth += count_braces(lines[i])
        if depth <= 0 and i > start:
            return i
    return start


def process_file(input_path, output_path, marker_after='STATE'):
    with open(input_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    result = []
    i = 0
    marker_inserted = False

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Detect function start
        m = FUNC_RE.match(line)
        if m:
            func_name = m.group(2)
            if func_name in COMMON_FUNCTIONS:
                # Skip this entire function
                depth = count_braces(line)
                i += 1
                while depth > 0 and i < len(lines):
                    depth += count_braces(lines[i])
                    i += 1
                # Skip trailing blank line
                if i < len(lines) and lines[i].strip() == '':
                    i += 1
                continue

        # Insert marker after STATE definition closes
        if not marker_inserted:
            # Look for "const STATE = {" or "  const STATE = {"
            if re.match(r'\s*const\s+STATE\s*=\s*\{', stripped):
                # Find closing of STATE
                close_line = find_state_close(lines, i)
                # Add all lines through the close
                for j in range(i, close_line + 1):
                    result.append(lines[j])
                i = close_line + 1
                # Insert marker
                result.append('\n')
                result.append('  // #COMMON_CODE\n')
                result.append('\n')
                marker_inserted = True
                continue

        result.append(line)
        i += 1

    with open(output_path, 'w', encoding='utf-8', newline='\n') as f:
        f.writelines(result)

    print(f'[OK] {os.path.basename(output_path)}: {len(lines)} -> {len(result)} lines '
          f'(removed {len(lines) - len(result)} lines)')


SCRIPTS = [
    ('torn-war-bubble.user.js', 'torn-war-bubble.src.js'),
    ('torn-assistant.user.js', 'torn-assistant.src.js'),
    ('torn-pda-deal-finder-bubble.user.js', 'torn-deal-finder.src.js'),
    ('torn-strip-poker-bubble.user.js', 'torn-strip-poker.src.js'),
]

os.makedirs(SRC_DIR, exist_ok=True)

for user_js, src_js in SCRIPTS:
    inp = os.path.join(REPO, user_js)
    out = os.path.join(SRC_DIR, src_js)
    if os.path.isfile(inp):
        process_file(inp, out)
    else:
        print(f'[SKIP] {user_js} not found')
