#!/usr/bin/env python3
"""
Torn Dark Tools — Build Script

Assembles standalone .user.js files from src/ sources + shared common code.
Each source file in src/ contains a `// #COMMON_CODE` marker that gets replaced
with the contents of src/common.js.

Usage:
    python3 build.py          # build all scripts
    python3 build.py --check  # verify built files match (CI mode)
"""

import os
import sys
import glob

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(REPO_ROOT, 'src')
COMMON_FILE = os.path.join(SRC_DIR, 'common.js')
MARKER = '// #COMMON_CODE'

# Map source files to output files in repo root
SCRIPTS = {
    'torn-assistant.src.js':           'torn-assistant.user.js',
    'torn-deal-finder.src.js':         'torn-pda-deal-finder-bubble.user.js',
    'torn-war-bubble.src.js':          'torn-war-bubble.user.js',
    'torn-strip-poker.src.js':         'torn-strip-poker-bubble.user.js',
}


def build():
    if not os.path.isfile(COMMON_FILE):
        print(f'[ERROR] Common file not found: {COMMON_FILE}')
        sys.exit(1)

    with open(COMMON_FILE, 'r', encoding='utf-8') as f:
        common_code = f.read()

    check_mode = '--check' in sys.argv
    ok = True

    for src_name, out_name in SCRIPTS.items():
        src_path = os.path.join(SRC_DIR, src_name)
        out_path = os.path.join(REPO_ROOT, out_name)

        if not os.path.isfile(src_path):
            print(f'[SKIP] {src_name} — source not found yet')
            continue

        with open(src_path, 'r', encoding='utf-8') as f:
            source = f.read()

        if MARKER not in source:
            print(f'[ERROR] {src_name} — missing {MARKER} marker')
            ok = False
            continue

        # Replace the marker with common code
        assembled = source.replace(MARKER, common_code, 1)

        if check_mode:
            # Compare with existing output
            if os.path.isfile(out_path):
                with open(out_path, 'r', encoding='utf-8') as f:
                    existing = f.read()
                if existing != assembled:
                    print(f'[FAIL] {out_name} — output differs from built version. Run: python3 build.py')
                    ok = False
                else:
                    print(f'[PASS] {out_name}')
            else:
                print(f'[FAIL] {out_name} — output file missing')
                ok = False
        else:
            with open(out_path, 'w', encoding='utf-8', newline='\n') as f:
                f.write(assembled)
            line_count = assembled.count('\n') + 1
            print(f'[BUILT] {out_name} ({line_count} lines)')

    # Bracket balance check on all built files
    if not check_mode:
        print('\n=== Bracket balance ===')
        for out_name in SCRIPTS.values():
            out_path = os.path.join(REPO_ROOT, out_name)
            if not os.path.isfile(out_path):
                continue
            with open(out_path, 'r', encoding='utf-8') as f:
                content = f.read()
            balanced = True
            for o, c in [('(', ')'), ('{', '}'), ('[', ']')]:
                if content.count(o) != content.count(c):
                    print(f'[FAIL] {out_name}: {o}={content.count(o)} {c}={content.count(c)}')
                    balanced = False
                    ok = False
            if balanced:
                print(f'[PASS] {out_name}')

    if not ok:
        sys.exit(1)
    elif check_mode:
        print('\nAll checks passed.')
    else:
        print('\nBuild complete.')


if __name__ == '__main__':
    build()
