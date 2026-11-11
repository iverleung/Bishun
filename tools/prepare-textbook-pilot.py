# -*- coding: utf-8 -*-
"""Explicitly prepare the supported textbook volumes from local, source-checked files."""
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
workbook = openpyxl.load_workbook(ROOT / proof.WORKBOOK, read_only=True, data_only=True)
def prepare_book(book_title, book_id):
    pilot = next(book for book in results if book['book'] == book_title)
    rows = [list(row) for row in workbook[book_title].values]
    columns = {name: ord(column) - ord('A') for name, column in corrections['fieldColumns'].items()}
    applied = 0
    for patch in corrections['patches']:
        if patch['sheet'] != book_title:
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
    for table, bucket in [('识字表', 'read'), ('写字表', 'write'), ('词语表', 'words')]:
        original = [(number, row) for number, row in enumerate(rows, 1) if row[0] == table]
        source = pilot['tables'].get(table, {}).get('source', [])
        if len(original) != len(source):
            raise ValueError('Pilot rows do not match proofread source')
        for (number, row), item in zip(original, source):
            if row[5] != item['text']:
                raise ValueError('Pilot text differs from original')
            if item['sourceType'] == '语文园地':
                garden = item['sourceGarden'].strip()
                if garden[-1] in numbers:
                    unit_number = numbers[garden[-1]]
                else:
                    # Upper-grade appendices print only 语文园地. Their preceding
                    # lesson and the checked table of contents identify the unit.
                    course = pilot['toc'][str(row[1])]
                    if row[2] != course['unit']:
                        raise ValueError('Garden unit does not match corrected contents')
                    unit_number = numbers[course['unit'][1:-2]]
                    garden = '语文园地' + list(numbers)[unit_number - 1]
                task_id = f'garden-{unit_number}'
                title, label, order, kind = garden, '', 999, 'garden'
            else:
                lesson = item['sourceLesson']
                if str(row[1]) != str(lesson):
                    raise ValueError('Pilot lesson does not match corrected source')
                course = pilot['toc'][lesson]
                unit_number = numbers[course['unit'][1:-2]]
                if lesson.isdigit():
                    task_id, label = f'reading-{lesson}', f'第{lesson}课'
                else:
                    section = next(prefix for prefix in ['识字', '汉语拼音', '阅读'] if lesson.startswith(prefix))
                    prefix = {'识字':'literacy', '汉语拼音':'pinyin', '阅读':'reading'}[section]
                    task_id, label = f'{prefix}-{lesson[len(section):]}', lesson
                title, order, kind = course['title'], course['printedPage'], 'lesson'
            if task_id not in tasks:
                tasks[task_id] = {'id':task_id, 'kind':kind, 'label':label, 'title':title, 'order':order, 'read':[], 'write':[]}
                if kind == 'garden' and item['sourceGarden'].strip() != title:
                    tasks[task_id]['sourceLabel'] = item['sourceGarden'].strip()
                units[unit_number - 1]['tasks'].append(tasks[task_id])
            if bucket == 'words':
                tasks[task_id].setdefault('words', []).append({'id':f'row-{number}', 'text':row[5], 'sourceRow':number, 'pdfPage':row[8]})
            else:
                tasks[task_id][bucket].append({'id':f'row-{number}', 'character':row[5], 'reading':row[6], 'polyphonic':row[7] == '是', 'sourceRow':number, 'pdfPage':row[8]})
    units = [unit for unit in units if unit['tasks']]
    for unit in units:
        unit['tasks'].sort(key=lambda task:task.pop('order'))
    book = {'schemaVersion':1, 'dataset':'pilot-v1', 'id':book_id, 'title':book_title, 'edition':'统编版',
            'source':{'workbookSha256':corrections['sourceHashes'][proof.WORKBOOK], 'pdfSha256':pilot['source']['sha256'], 'correctionsSha256':proof.file_hash(SOURCE), 'appliedCells':applied}, 'units':units}
    text = json.dumps(book, ensure_ascii=False, indent=2) + '\n'
    folder = ROOT / 'resources/textbooks/pilot-v1'
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f'{book_id}.json').write_text(text, encoding='utf-8')
    sha = hashlib.sha256(text.encode('utf-8')).hexdigest()
    url = f'/textbooks/pilot-v1/{book_id}-{sha[:12]}.json'
    public = ROOT / 'public' / url.lstrip('/')
    public.parent.mkdir(parents=True, exist_ok=True)
    public.write_text(text, encoding='utf-8')
    print(f'{book_title}: {len(tasks)} tasks; {applied} corrected cells.')
    return {'id':book['id'],'title':book['title'],'edition':book['edition'],'url':url,'sha256':sha,'bytes':len(text.encode('utf-8'))}

books = [prepare_book(f'{grade}年级{semester}册', f'g{number}-{suffix}')
         for number, grade in enumerate('一二三四五六', 1)
         for semester, suffix in [('上','first'),('下','second')]]
index = {'schemaVersion':1,'dataset':'pilot-v1','books':books}
folder = ROOT / 'resources/textbooks/pilot-v1'
(folder / 'index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
workbook.close()
