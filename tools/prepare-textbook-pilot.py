# -*- coding: utf-8 -*-
"""Explicitly prepare the first textbook pilot from local, source-checked files."""
import hashlib
import json
from pathlib import Path
import openpyxl
import sys
sys.dont_write_bytecode = True
import importlib.util
spec = importlib.util.spec_from_file_location("proofread_textbooks", Path(__file__).with_name("proofread-textbooks.py"))
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'resources/textbooks/proofread-corrections.json'
corrections = json.loads(SOURCE.read_text(encoding='utf-8'))
for path, expected in corrections['sourceHashes'].items():
    if proof.file_hash(ROOT / path) != expected:
        raise ValueError(f'Source changed; re-proofread before preparing: {path}')
results = proof.proofread()
pilot = next(book for book in results if book['book'] == '一年级上册')
workbook = openpyxl.load_workbook(ROOT / proof.WORKBOOK, read_only=True, data_only=True)
rows = [list(row) for row in workbook['一年级上册'].values]
columns = {name: ord(column) - ord('A') for name, column in corrections['fieldColumns'].items()}
applied = 0
for patch in corrections['patches']:
    if patch['sheet'] != '一年级上册':
        continue
    for number in patch['rows']:
        column = columns[patch['field']]
        if rows[number - 1][column] != patch['before']:
            raise ValueError('Correction no longer matches original cell')
        rows[number - 1][column] = patch['after']
        applied += 1
numbers = {value: index + 1 for index, value in enumerate('一二三四五六七八')}
units = [{'id': f'unit-{i}', 'title': f'第{value}单元', 'tasks': []} for value, i in numbers.items()]
tasks = {}
for table, bucket in [('识字表', 'read'), ('写字表', 'write')]:
    original = [(number, row) for number, row in enumerate(rows, 1) if row[0] == table]
    source = pilot['tables'][table]['source']
    if len(original) != len(source):
        raise ValueError('Pilot rows do not match proofread source')
    for (number, row), item in zip(original, source):
        if row[5] != item['text']:
            raise ValueError('Pilot text differs from original')
        if item['sourceType'] == '语文园地':
            garden = item['sourceGarden'].strip()
            unit_number = numbers[garden[-1]]
            task_id = f'garden-{unit_number}'
            title, label, order, kind = garden, '', 999, 'garden'
        else:
            lesson = item['sourceLesson']
            if row[1] != lesson:
                raise ValueError('Pilot lesson does not match corrected source')
            course = pilot['toc'][lesson]
            unit_number = numbers[course['unit'][1:-2]]
            section = next(prefix for prefix in ['识字', '汉语拼音', '阅读'] if lesson.startswith(prefix))
            prefix = {'识字':'literacy', '汉语拼音':'pinyin', '阅读':'reading'}[section]
            task_id = f'{prefix}-{lesson[len(section):]}'
            title, label, order, kind = course['title'], lesson, course['printedPage'], 'lesson'
        if task_id not in tasks:
            tasks[task_id] = {'id':task_id, 'kind':kind, 'label':label, 'title':title, 'order':order, 'read':[], 'write':[]}
            units[unit_number - 1]['tasks'].append(tasks[task_id])
        tasks[task_id][bucket].append({'id':f'row-{number}', 'character':row[5], 'reading':row[6], 'polyphonic':row[7] == '是', 'sourceRow':number, 'pdfPage':row[8]})
for unit in units:
    unit['tasks'].sort(key=lambda task:task.pop('order'))
book = {'schemaVersion':1, 'dataset':'pilot-v1', 'id':'g1-first', 'title':'一年级上册', 'edition':'统编版',
        'source':{'workbookSha256':corrections['sourceHashes'][proof.WORKBOOK], 'pdfSha256':pilot['source']['sha256'], 'correctionsSha256':proof.file_hash(SOURCE), 'appliedCells':applied}, 'units':units}
text = json.dumps(book, ensure_ascii=False, indent=2) + '\n'
folder = ROOT / 'resources/textbooks/pilot-v1'
folder.mkdir(parents=True, exist_ok=True)
(folder / 'g1-first.json').write_text(text, encoding='utf-8')
sha = hashlib.sha256(text.encode('utf-8')).hexdigest()
url = f'/textbooks/pilot-v1/g1-first-{sha[:12]}.json'
public = ROOT / 'public' / url.lstrip('/')
public.parent.mkdir(parents=True, exist_ok=True)
public.write_text(text, encoding='utf-8')
index = {'schemaVersion':1,'dataset':'pilot-v1','books':[{'id':book['id'],'title':book['title'],'edition':book['edition'],'url':url,'sha256':sha,'bytes':len(text.encode('utf-8'))}]}
(folder / 'index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
workbook.close()
print(f'Prepared {len(tasks)} independent tasks, {sum(len(t["read"]) for t in tasks.values())} reading and {sum(len(t["write"]) for t in tasks.values())} writing occurrences; applied {applied} corrections.')
