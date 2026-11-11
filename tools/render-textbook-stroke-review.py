# -*- coding: utf-8 -*-
"""Render local normative rows beside exact candidate strokes; no downloads or classifications."""
import argparse,hashlib,json
from pathlib import Path
import fitz
from PIL import Image,ImageDraw,ImageFont
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('output',type=Path)
parser.add_argument('--character')
parser.add_argument('--font',type=Path,default=Path('/System/Library/Fonts/Supplemental/Songti.ttc'))
args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
review=json.loads((root/'resources/textbooks/textbook-stroke-review.json').read_text())
if args.character and args.character not in {e['character'] for e in review['characters']}:parser.error('Character is not in this review')
source=root/review['source']['path']
if hashlib.sha256(source.read_bytes()).hexdigest()!=review['source']['sha256']:raise ValueError('Normative source changed')
pdf=fitz.open(source)
font=ImageFont.truetype(str(args.font),19)
small=ImageFont.truetype(str(args.font),14)
tiles=[];mapping=[]
for entry in sorted(review['characters'],key=lambda e:(e['strokes'][0]['from'],e['character'])):
 if args.character and entry['character']!=args.character:continue
 dataBytes=(root/f"public/characters/2.0.1/{entry['character']}.json").read_bytes()
 if hashlib.sha256(dataBytes).hexdigest()!=entry['glyphSha256']:raise ValueError('Glyph changed')
 data=json.loads(dataBytes);page=pdf[entry['pdfPage']-1];clip=fitz.Rect(entry['sourceClip'])
 if not any(clip.contains(r) for r in page.search_for(entry['ucs'])):raise ValueError('Missing source identifier')
 pix=page.get_pixmap(matrix=fitz.Matrix(2,2),clip=clip)
 row=Image.frombytes('RGB',[pix.width,pix.height],pix.samples);row.thumbnail((290,112))
 for stroke in entry['strokes']:
  idx=stroke['index'];number=len(tiles)+1
  svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g transform="translate(0,900) scale(1,-1)">'+''.join(f'<path fill="{ "#d92953" if i==idx else "#e1e4e0"}" d="{path}"/>' for i,path in enumerate(data['strokes']))+'</g></svg>'
  doc=fitz.open(stream=svg.encode(),filetype='svg');p=doc[0].get_pixmap(matrix=fitz.Matrix(.12,.12));glyph=Image.frombytes('RGB',[p.width,p.height],p.samples)
  tile=Image.new('RGB',(400,164),'white');d=ImageDraw.Draw(tile)
  d.text((4,2),f"{number} {entry['character']} 第{idx+1}笔 {stroke['name'] or '?'}",font=font,fill='black')
  d.text((4,25),stroke['from']+f"  PDF {entry['pdfPage']}",font=small,fill='#555555')
  tile.paste(glyph,(0,42));tile.paste(row,(108,48));d.rectangle((0,0,399,163),outline='#b6c0b5')
  tiles.append(tile);mapping.append({'number':number,'character':entry['character'],'index':idx,'from':stroke['from']})
for offset in range(0,len(tiles),40):
 sheet=Image.new('RGB',(2000,1312),'#dddddd')
 for i,tile in enumerate(tiles[offset:offset+40]):sheet.paste(tile,((i%5)*400,(i//5)*164))
 sheet.save(args.output/f'sheet-{offset//40+1:02}.png')
(args.output/'map.json').write_text(json.dumps(mapping,ensure_ascii=False,indent=2))
print(f'{len(tiles)} candidate positions; {(len(tiles)+39)//40} sheets: {args.output}')
