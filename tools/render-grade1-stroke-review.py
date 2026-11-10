# -*- coding: utf-8 -*-
"""Render recorded first-grade review clips from the existing local standard; no downloads."""
import argparse
import hashlib
import json
from pathlib import Path
import fitz

root = Path(__file__).resolve().parents[1]
review = json.loads((root / 'resources/textbooks/grade1-stroke-review.json').read_text(encoding='utf-8'))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output_directory', type=Path)
parser.add_argument('--character', choices=[entry['character'] for entry in review['characters']])
args = parser.parse_args()
source = review['sources']['strokeOrder']
path = root / source['path']
if hashlib.sha256(path.read_bytes()).hexdigest() != source['sha256']:
    raise ValueError('Standard PDF changed; review the source before rendering recorded clips')
args.output_directory.mkdir(parents=True, exist_ok=True)
with fitz.open(path) as pdf:
    for entry in review['characters']:
        if args.character and entry['character'] != args.character:
            continue
        page = pdf[entry['pdfPage'] - 1]
        clip = fitz.Rect(entry['sourceClip'])
        if not any(clip.contains(rect) for rect in page.search_for(entry['ucs'])):
            raise ValueError('Recorded source clip does not contain the expected UCS identifier')
        target = args.output_directory / (entry['ucs'] + '.png')
        page.get_pixmap(matrix=fitz.Matrix(4, 4), clip=clip).save(target)
        print(f'{entry["character"]}: PDF {entry["pdfPage"]}, {target}')
