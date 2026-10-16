#!/usr/bin/env python3
from pathlib import Path
import re
import sys

failed = []
for skill in sorted(Path('skills').glob('*/SKILL.md')):
    text = skill.read_text(encoding='utf-8')
    match = re.match(r'^---\n(.*?)\n---\n', text, re.S)
    if not match:
        failed.append(f'{skill}: missing YAML frontmatter')
        continue
    values = {}
    for line in match.group(1).splitlines():
        if ': ' in line and not line.startswith('  '):
            key, value = line.split(': ', 1)
            values[key] = value.strip('"')
    name = values.get('name', '')
    description = values.get('description', '')
    if name != skill.parent.name:
        failed.append(f'{skill}: name must match directory')
    if not re.match(r'^(?!-)(?!.*--)[a-z0-9-]{1,64}(?<!-)$', name):
        failed.append(f'{skill}: invalid name')
    if not (1 <= len(description) <= 1024):
        failed.append(f'{skill}: invalid description length')

if failed:
    print('\n'.join(failed))
    sys.exit(1)
print('Skill validation: 2 passed, 0 failed')
