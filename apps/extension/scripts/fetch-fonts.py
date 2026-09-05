#!/usr/bin/env python3
"""Self-host Sora + Oxanium (latin subset) into public/fonts + emit fonts.css."""
import re, subprocess, os, sys

OUT = os.path.dirname(os.path.abspath(__file__))

def latin_url(family, weight):
    css = subprocess.check_output([
        'curl', '-sL', '-A',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        f'https://fonts.googleapis.com/css2?family={family}:wght@{weight}&display=swap',
    ]).decode()
    # last @font-face block = latin subset (unicode-range starts U+0000-00FF)
    blocks = re.findall(r'@font-face \{[^}]+\}', css)
    for b in reversed(blocks):
        if 'U+0000-00FF' in b:
            m = re.search(r'url\((https://[^)]+\.woff2)\)', b)
            if m:
                return m.group(1)
    return None

def download(url, dest):
    r = subprocess.run(['curl', '-sL', url, '-o', dest])
    return r.returncode == 0 and os.path.getsize(dest) > 500

rules = []
for family, fname in [('Oxanium', 'oxanium'), ('Sora', 'sora')]:
    for weight in ('400', '600'):
        url = latin_url(family, weight)
        if not url:
            print(f'no url {family} {weight}', file=sys.stderr); continue
        dest = os.path.join(OUT, f'{fname}-{weight}.woff2')
        ok = download(url, dest)
        if ok:
            rules.append(f"""@font-face {{
  font-family: '{family}';
  font-style: normal;
  font-weight: {weight};
  font-display: swap;
  src: url('/fonts/{fname}-{weight}.woff2') format('woff2');
}}""")
            print(f'{family} {weight} -> {dest} ({os.path.getsize(dest)} b)')
        else:
            print(f'FAIL {family} {weight}', file=sys.stderr)

with open(os.path.join(OUT, 'fonts.css'), 'w') as f:
    f.write('\n'.join(rules) + '\n')
print('wrote fonts.css with', len(rules), 'rules')
