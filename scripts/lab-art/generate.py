#!/usr/bin/env python3
"""Generate one piece of Edison Lab art through OpenRouter and save the raw image.

  python3 scripts/lab-art/generate.py <out.png> <aspect, e.g. 3:2> "<prompt>" [reference.png ...]

Needs OPENROUTER_API_KEY. Raw output is large: run scripts/lab-art/fit.py to shrink it into src/lab/art/.
Original art only: prompts must not name existing games, characters or artists.
"""
import base64, json, os, sys, urllib.request

MODEL = 'google/gemini-3.1-flash-image'
out, aspect, prompt, refs = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
content = [{'type': 'text', 'text': prompt}]
for r in refs:
    b64 = base64.b64encode(open(r, 'rb').read()).decode()
    content.append({'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{b64}'}})
body = {
    'model': MODEL,
    'messages': [{'role': 'user', 'content': content}],
    'modalities': ['image', 'text'],
    'image_config': {'aspect_ratio': aspect},
    'usage': {'include': True},
}
req = urllib.request.Request(
    'https://openrouter.ai/api/v1/chat/completions',
    data=json.dumps(body).encode(),
    headers={'Authorization': 'Bearer ' + os.environ['OPENROUTER_API_KEY'], 'Content-Type': 'application/json'},
)
try:
    res = json.load(urllib.request.urlopen(req, timeout=300))
except urllib.error.HTTPError as e:
    sys.exit(f'HTTP {e.code}: {e.read().decode()[:600]}')
msg = res['choices'][0]['message']
images = msg.get('images') or []
if not images:
    sys.exit('no image returned: ' + json.dumps(res)[:800])
url = images[0]['image_url']['url']
open(out, 'wb').write(base64.b64decode(url.split(',', 1)[1]))
print(out, 'cost $', (res.get('usage') or {}).get('cost'))
