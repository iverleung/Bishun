"""Read-only source audit; requires PyMuPDF, separate from the website build."""
import hashlib
import json
import re
from pathlib import Path

import fitz

root = Path(__file__).resolve().parent.parent
pdf_path = root / 'GF0023-2020《通用规范汉字笔顺规范》.pdf'
source = root / 'node_modules/hanzi-writer-data'
with fitz.open(pdf_path) as pdf:
    codes = []
    for page in list(pdf)[8:]:
        codes.extend(re.findall(r'^([0-9A-F]{5})$', page.get_text(), re.M))
characters = {chr(int(code, 16)) for code in codes}
if len(codes) != 8105 or len(characters) != 8105:
    raise ValueError('UCS extraction did not produce exactly 8105 unique characters')
files = [p for p in source.glob('*.json') if len(p.stem) == 1]
available = {p.stem for p in files}
report = {
    'source': 'hanzi-writer-data@2.0.1',
    'standard': 'GF0023-2020',
    'standardPdfSha256': hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
    'standardCharacterCount': len(characters),
    'sourceCharacterCount': len(files),
    'rawBytes': sum(p.stat().st_size for p in files),
    'standardCovered': len(characters & available),
    'standardMissingCount': len(characters - available),
    'standardMissingCharacters': ''.join(sorted(characters - available)),
    'sourceOutsideStandardCount': len(available - characters),
    'contentReviewed': False,
}
(root / 'resources/character-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print({key: value for key, value in report.items() if key != 'standardMissingCharacters'})
