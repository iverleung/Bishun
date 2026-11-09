# -*- coding: utf-8 -*-
"""Read-only textbook comparison (PyMuPDF and openpyxl required).

The drawing-only annotation for 略 was checked visually on the pinned PDF.
Generated corrections are independent of the original refs/ and the Web app.
"""
import argparse
import hashlib
import collections
import json
import re

import fitz
import openpyxl
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
WORKBOOK = 'refs/统编版小学语文生字词表_1-6年级全12册.xlsx'
VISUAL_PINYIN = {('三年级下册', 117, '略'): ('lüè', 'af911d41b10c46908fd82610ecb0ec0f2c62fa8f609947b9748d00ab0d58e141')}

def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()
HAN = re.compile('[\\u3400-\\u4dbf\\u4e00-\\u9fff]')
MAP = dict(zip('AEFGHIJKLMOPQRSTUWYDVBC', ['ǎ', 'ē', 'è', 'ǒ', 'ò', 'í', 'ǐ', 'ì', 'ǔ', 'ù', 'ū', 'ú', 'ā', 'é', 'à', 'ō', 'ī', 'á', 'ó', 'ě', 'ǚ', 'ǘ', 'ǜ']))

def decode(s):
    """Decode the checked font alphabet; punctuation in raw mH、 is not a sound."""
    return ''.join((MAP.get(c, c) for c in s if c.isalpha()))

def spans(p):
    return [s for b in p.get_text('dict')['blocks'] for l in b.get('lines', []) for s in l['spans']]

def line_groups(items, tolerance=5):
    groups = []
    for s in sorted(items, key=lambda s: (s['origin'][1], s['bbox'][0])):
        y = s['origin'][1]
        if not groups or abs(y - groups[-1][0]) > tolerance:
            groups.append([y, [s]])
        else:
            groups[-1][1].append(s)
    return [sorted(g[1], key=lambda s: s['bbox'][0]) for g in groups]

def toc(doc, book):
    """Read columns in order; keep the poetry appendix out of main-lesson keys."""
    result = {}
    unit = None
    section = '阅读'
    for i in range(3, 6 if book.startswith('一年') else 5):
        items = [s for s in spans(doc[i]) if 40 < s['bbox'][1] < 690 and s['text'].strip()]
        cols = [items]
        if any((s['bbox'][0] < 150 for s in items)) and any((s['bbox'][0] > doc[i].rect.width / 2 - 0.5 for s in items)):
            cols = [[s for s in items if s['bbox'][0] < doc[i].rect.width / 2 - 0.5], [s for s in items if s['bbox'][0] >= doc[i].rect.width / 2 - 0.5]]
        for col in cols:
            for row in line_groups(col):
                text = ' '.join((s['text'] for s in row)).strip()
                m = re.match('^第([一二三四五六七八九十]+)单元', text)
                if m:
                    unit = '第' + m[1] + '单元'
                    section = '汉语拼音' if '汉语拼音' in text else '识字' if '识字' in text else '阅读'
                    continue
                if text.strip() == '古诗词诵读':
                    section = '古诗词诵读'
                    continue
                if section == '古诗词诵读':
                    continue
                if text.strip() in ['识字', '汉语拼音', '阅读']:
                    section = text.strip()
                    continue
                m = re.match('^\\s*(\\d{1,2})\\s*\\*?\\s*(.+?)\\s*\\.{2,}\\s*(\\d{1,3})\\s*$', text)
                if not m:
                    m = re.match('^\\s*(\\d{1,2})\\s+(.+?)\\s+(\\d{1,3})\\s*$', text)
                if not m or not unit:
                    continue
                (number, title, page) = (m[1], m[2].strip(), int(m[3]))
                title = re.sub('[*\\u200b\\ufeff]', '', title).strip().rstrip('.')
                title = re.sub('\\s+', '', title) if section != '汉语拼音' else re.sub('\\s+', ' ', title)
                key = section + str(int(number)) if book.startswith(('一年', '二年')) else str(int(number))
                result[key] = {'unit': unit, 'title': title, 'printedPage': page, 'tocPdfPage': i + 1, 'bbox': [round(v, 2) for v in row[0]['bbox']]}
    return result

def contexts(items, ss, name, typ, page, previous):
    """Associate printed labels, handling two columns and whitespace-only left spans."""
    events = []
    column = lambda x: int(name == '一年级上册' and typ == '写字表' and (x > 250))
    for span in ss:
        text = span['text'].strip()
        x = span['bbox'][0]
        y = span['origin'][1]
        if not text or span['color'] == 0:
            continue
        value = None
        if text in ['识字', '汉语拼音', '阅读']:
            value = ('section', text)
        elif text.startswith('语文园地') and span['size'] < 15:
            value = ('garden', text)
        elif span['size'] >= 15:
            match = re.match('^\\s*(\\d{1,2})(?:\\s|(?=[\\u3400-\\u9fff]))', span['text'])
            if match and (re.fullmatch('\\s*\\d{1,2}\\s*', text) or x < 112 + column(x) * page.rect.width / 2):
                value = ('number', int(match[1]))
        if value:
            events.append((column(x), round(y / 3) * 3, -1 if typ == '词语表' else x, 0, value))
    for (index, item) in enumerate(items):
        events.append((column(item['bbox'][0]), round(item['baseline'] / 3) * 3, item['bbox'][0], 1, index))
    for (col, y, x, kind, value) in sorted(events):
        state = previous.setdefault(col, {'section': '阅读', 'number': None, 'garden': None})
        if kind == 0:
            (key, entry) = value
            if key == 'section':
                state.update(section=entry, number=None, garden=None)
            elif key == 'number':
                state.update(number=entry, garden=None)
            else:
                state['garden'] = entry
        else:
            item = items[value]
            item['sourceType'] = '语文园地' if state['garden'] else '课文'
            item['sourceGarden'] = state['garden']
            number = state['number']
            item['sourceLesson'] = (state['section'] + str(number) if name.startswith(('一年', '二年')) else str(number)) if number else None
    return previous

def proofread():
    book = openpyxl.load_workbook(ROOT / WORKBOOK, read_only=True, data_only=True)
    summary = list(book['汇总与质检'].values)
    results = []
    for sr in summary[4:16]:
        name = sr[0]
        doc = fitz.open(ROOT / 'refs' / f'{name}.pdf')
        courses = toc(doc, name)
        r = {'book': name, 'source': {'file': f'refs/{name}.pdf', 'sha256': file_hash(ROOT / 'refs' / f'{name}.pdf'), 'pdfPages': len(doc)}, 'toc': courses, 'tables': {}}
        for (typ, rg) in zip(['识字表', '写字表', '词语表'], sr[6:9]):
            if not isinstance(rg, str) or '–' not in rg:
                continue
            (start, end) = map(int, rg.split('–'))
            source = []
            previous = {}
            heading = ''.join((s['text'] for s in spans(doc[start - 1]) if s['size'] >= 20))
            if typ not in re.sub('\\s+', '', heading):
                raise ValueError(f'{name} {typ}: incorrect appendix start page')
            for pn in range(start, end + 1):
                p = doc[pn - 1]
                ss = spans(p)
                if typ == '词语表':
                    words = []
                    for row in line_groups([s for s in ss if 15.5 <= s['size'] <= 16.5 and s['color'] != 0 and (35 < s['bbox'][1] < 710)], 2):
                        text = ''.join((s['text'] for s in row))
                        words.extend(({'text': w, 'pdfPage': pn, 'bbox': row[0]['bbox'], 'baseline': row[0]['origin'][1]} for w in re.findall('[\\u3400-\\u4dbf\\u4e00-\\u9fff]+', text)))
                    contexts(words, ss, name, typ, p, previous)
                    source.extend(words)
                else:
                    chars = []
                    for b in p.get_text('rawdict')['blocks']:
                        for l in b.get('lines', []):
                            for s in l['spans']:
                                if not (17.5 <= s['size'] <= 18.5 and s['color'] in [2301728, 44783]):
                                    continue
                                for c in s['chars']:
                                    if HAN.fullmatch(c['c']):
                                        chars.append({'text': c['c'], 'x': (c['bbox'][0] + c['bbox'][2]) / 2, 'y': c['origin'][1], 'poly': s['color'] == 44783, 'pdfPage': pn, 'bbox': c['bbox'], 'baseline': c['origin'][1]})
                    chars.sort(key=lambda c: (c['x'] > 250 if name == '一年级上册' and typ == '写字表' else False, round(c['y'] / 3) * 3, c['x']))
                    for c in chars:
                        c['rawPinyin'] = ''
                    for s in ss:
                        if not ('Hanyu' in s['font'] and s['size'] <= 12.5):
                            continue
                        x = (s['bbox'][0] + s['bbox'][2]) / 2
                        y = s['origin'][1]
                        near = [c for c in chars if 5 < c['y'] - y < 28 and abs(c['x'] - x) < 22]
                        if near:
                            c = min(near, key=lambda c: abs(c['x'] - x))
                            c.setdefault('parts', []).append((s['bbox'][0], s['text']))
                    for c in chars:
                        c['rawPinyin'] = ''.join((t for (x, t) in sorted(c.pop('parts', []))))
                        c['pinyin'] = decode(c['rawPinyin'])
                        c['pinyinMethod'] = 'text-layer'
                        c.pop('x')
                        c.pop('y')
                        override = VISUAL_PINYIN.get((name, pn, c['text']))
                        if override:
                            if r['source']['sha256'] != override[1]:
                                raise ValueError('Visual annotation exception belongs to a different PDF')
                            if c['pinyin'] and c['pinyin'] != override[0]:
                                raise ValueError('Visual annotation exception conflicts with extracted text')
                            c['pinyin'] = override[0]
                            c['pinyinMethod'] = 'visual-path-annotation'
                    contexts(chars, ss, name, typ, p, previous)
                    source.extend(chars)
            if typ == '识字表' and any(not item['pinyin'] for item in source):
                raise ValueError(f'{name}: missing annotation needs an original-page review')
            for item in source:
                if item.get('pinyin') and not re.fullmatch('[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜêńňǹḿ]+', item['pinyin']):
                    raise ValueError(f'{name}: unrecognized pinyin font encoding')
            expected = [{'row': i, 'values': list(row)} for (i, row) in enumerate(book[name].iter_rows(values_only=True), 1) if row[0] == typ]
            left = [s['text'] for s in source]
            right = [r['values'][5] for r in expected]
            diffs = []
            if left != right:
                raise ValueError(f'{name} {typ}: text sequence mismatch; no corrections generated')
            if left == right:
                for (src, x) in zip(source, expected):
                    v = x['values']
                    changes = {}
                    if typ != '词语表':
                        if src['pinyin'] and src['pinyin'] != (v[6] or ''):
                            changes['pinyin'] = {'old': v[6], 'new': src['pinyin'], 'raw': src['rawPinyin']}
                        if typ == '识字表' and src['poly'] != (v[7] == '是'):
                            changes['poly'] = {'old': v[7], 'new': src['poly']}
                    if src.get('sourceType') != v[4]:
                        changes['sourceType'] = {'old': v[4], 'new': src.get('sourceType')}
                    if src.get('sourceType') == '课文' and src.get('sourceLesson') != str(v[1]):
                        changes['lesson'] = {'old': v[1], 'new': src.get('sourceLesson')}
                    if any((key not in ['pinyin', 'poly'] for key in changes)):
                        raise ValueError(f"{name} row {x['row']}: source lesson/type mismatch")
                    if changes:
                        diffs.append({'row': x['row'], 'text': src['text'], 'pdfPage': src['pdfPage'], 'changes': changes})
            source_text = re.sub('\\s+', '', ''.join((doc[i - 1].get_text() for i in range(start, end + 1))))
            anchors = re.findall('（共(\\d+)[^）]*）', source_text)
            printed_count = int(anchors[0]) if len(anchors) == 1 else None
            counted = sum((not c.get('poly', False) for c in source)) if typ == '识字表' else len(source)
            if len(anchors) > 1 or (printed_count is not None and printed_count != counted):
                raise ValueError(f'{name} {typ}: printed count mismatch')
            if any((src['pdfPage'] != x['values'][8] for (src, x) in zip(source, expected))):
                raise ValueError(f'{name} {typ}: source page mismatch')
            r['tables'][typ] = {'pdfRange': [start, end], 'printedCount': printed_count, 'countExcludingBlue': counted, 'sourceCount': len(source), 'xlsxCount': len(expected), 'sequenceEqual': left == right, 'firstMismatch': next((i for (i, (a, b)) in enumerate(zip(left, right)) if a != b), None), 'sourceWithPinyin': sum((bool(s.get('pinyin')) for s in source)), 'pinyinDifferences': diffs, 'source': source}
        r['tocMissing'] = sorted({str(row[1]) for row in book[name].iter_rows(min_row=2, values_only=True)} - set(courses))
        r['tocChanges'] = []
        for (i, row) in enumerate(book[name].iter_rows(min_row=2, values_only=True), 2):
            (table, lesson, unit, title, origin, *rest) = row
            course = courses.get(str(lesson))
            if course:
                expected_title = course['title'] + ('·语文园地' if origin == '语文园地' else '')
                if unit != course['unit'] or re.sub('\\s+', ' ', title) != expected_title:
                    r['tocChanges'].append({'row': i, 'lesson': lesson, 'oldUnit': unit, 'newUnit': course['unit'], 'oldTitle': title, 'newTitle': expected_title, 'tocPdfPage': course['tocPdfPage']})
        results.append(r)
        doc.close()
    book.close()
    return results

def build_outputs(results):
    """Export reversible cell corrections and compact checks, never an edited source."""
    grouped = {}
    summaries = []
    changed_rows = set()
    fields = collections.Counter()
    pinyin_kinds = collections.Counter()
    source_hashes = {WORKBOOK: file_hash(ROOT / WORKBOOK)}

    def add(sheet, row, field, before, after, evidence):
        if before == after:
            return
        key = (sheet, field, before, after, json.dumps(evidence, ensure_ascii=False, sort_keys=True))
        if key not in grouped:
            grouped[key] = dict(sheet=sheet, field=field, before=before, after=after, rows=[], evidence=evidence)
        grouped[key]['rows'].append(row)
        changed_rows.add((sheet, row))
        fields[field] += 1
    for result in results:
        name = result['book']
        if result['tocMissing']:
            raise ValueError(f"{name}: unmapped course keys: {result['tocMissing']}")
        source = result['source']
        source_hashes[source['file']] = source['sha256']
        table_checks = {}
        document = fitz.open(ROOT / source['file'])
        for (table_name, table) in result['tables'].items():
            page_labels = {}
            for page_number in range(table['pdfRange'][0], table['pdfRange'][1] + 1):
                page = document[page_number - 1]
                footers = [span for span in spans(page) if re.fullmatch('\\d+', span['text'].strip()) and span['size'] <= 12.5 and (span['bbox'][1] > page.rect.height - 90)]
                if not footers:
                    raise ValueError(f'{name} PDF p{page_number}: missing printed footer')
                page_labels[page_number] = max(footers, key=lambda span: span['bbox'][1])['text'].strip()
            deltas = table['pinyinDifferences']
            for delta in deltas:
                original = delta['changes']
                if any((key != 'pinyin' for key in original)):
                    raise ValueError(f"{name} row {delta['row']}: non-pinyin appendix difference requires review")
                changed = original['pinyin']
                matched = [item for item in table['source'] if item['text'] == delta['text'] and item['pdfPage'] == delta['pdfPage'] and (item.get('pinyin') == changed['new'])]
                if not matched:
                    raise ValueError('Correction has no matching PDF annotation')
                methods = {item['pinyinMethod'] for item in matched}
                if len(methods) != 1:
                    raise ValueError('Ambiguous correction evidence')
                method = next(iter(methods))
                evidence = dict(pdf=source['file'], pdfPage=delta['pdfPage'], printedPage=page_labels[delta['pdfPage']], table=table_name, method=method)
                add(name, delta['row'], '拼音', changed['old'], changed['new'], evidence)
                kind = 'visual-path-annotation' if method == 'visual-path-annotation' else 'missing-writing-pinyin' if table_name == '写字表' else 'font-code-decoding'
                pinyin_kinds[kind] += 1
            table_checks[table_name] = {key: table[key] for key in ['pdfRange', 'sourceCount', 'xlsxCount', 'sequenceEqual', 'printedCount', 'countExcludingBlue', 'sourceWithPinyin']}
            table_checks[table_name]['pageLabels'] = page_labels
            table_checks[table_name]['mainLessonMarkersMatch'] = True
            table_checks[table_name]['allSourceTypesMatch'] = True
            table_checks[table_name]['blueFlagsMatch'] = True if table_name == '识字表' else None
            table_checks[table_name]['pinyinCorrections'] = len(deltas)
        document.close()
        for change in result['tocChanges']:
            course = result['toc'][str(change['lesson'])]
            evidence = dict(pdf=source['file'], pdfPage=change['tocPdfPage'], method='toc-text-layer', lesson=change['lesson'], printedLessonStartPage=course['printedPage'])
            add(name, change['row'], '单元', change['oldUnit'], change['newUnit'], evidence)
            add(name, change['row'], '课题', change['oldTitle'], change['newTitle'], evidence)
        summaries.append(dict(book=name, source=source, tocLessonCount=len(result['toc']), unresolvedCourseKeys=result['tocMissing'], metadataChangedRows=len(result['tocChanges']), tables=table_checks))
    patches = list(grouped.values())
    workbook = openpyxl.load_workbook(ROOT / WORKBOOK, read_only=True, data_only=True)
    columns = {'单元': 2, '课题': 3, '拼音': 6}
    originals = {sheet.title: list(sheet.values) for sheet in workbook if sheet.title != '汇总与质检'}
    seen = set()
    for patch in patches:
        for row_number in patch['rows']:
            identity = (patch['sheet'], row_number, patch['field'])
            if identity in seen:
                raise ValueError('Duplicate cell patch')
            seen.add(identity)
            actual = originals[patch['sheet']][row_number - 1][columns[patch['field']]]
            if actual != patch['before']:
                raise ValueError(f'Patch does not match source cell: {identity}')
    workbook.close()
    corrections = dict(schemaVersion=1, date='2026-11-10', scope='Corrections against provided PDFs; original files are unchanged. Not consumed by the Web app yet.', sourceHashes=source_hashes, fieldColumns={'单元': 'C', '课题': 'D', '拼音': 'G'}, patches=patches)
    audit = dict(schemaVersion=1, date='2026-11-10', status='source-comparison-complete', method='Full supplied-row text-layer comparison plus documented visual checks; not a full page-by-page human review or a normative stroke audit.', sourceHashes=source_hashes, totals=dict(books=len(results), tables=sum((len(item['tables']) for item in results)), rows=sum((table['sourceCount'] for item in results for table in item['tables'].values())), changedRows=len(changed_rows), changedCells=sum(fields.values()), cellsByField=dict(fields), pinyinCorrectionKinds=dict(pinyin_kinds), patchGroups=len(patches), printedCountAnchors=sum((table['printedCount'] is not None for item in results for table in item['tables'].values()))), visualChecks={'tocPages': {'一年级下册': [4], '二年级上册': [4], '三年级下册': [4], '四年级下册': [4, 5], '六年级下册': [4, 5]}, 'fontCodeRows': {'一年级上册': [164], '二年级下册': [343], '三年级下册': [75, 147], '四年级下册': [56, 112]}, 'writingPage': {'一年级上册': [113]}, 'pathAnnotation': {'book': '三年级下册', 'pdfPage': 117, 'printedPage': 112, 'character': '略', 'reading': 'lüè', 'xlsxRow': 230}}, limitations=['Only the supplied revisions were compared; current official publication catalog was not queried.', 'Page numbers in workbook are PDF physical pages, not printed lesson pages.', '语文园地 source labels are checked; their inherited numeric lesson keys remain raw export metadata, not independent garden IDs.', '表内序号 is an export helper, not an independently printed textbook field; its meaning was not redefined.', 'PDF source-file permissions and teaching/stroke standards are outside this content comparison.'], books=summaries)
    return {'resources/textbooks/proofread-corrections.json': corrections, 'docs/教材原件校对记录-2026-11-10.json': audit}

def main():
    parser = argparse.ArgumentParser(description='Compare the 12 supplied textbook PDFs with the original XLSX. No downloads; never edits refs/.')
    parser.add_argument('--check', action='store_true', help='Compare generated JSON with committed outputs without writing them')
    args = parser.parse_args()
    outputs = build_outputs(proofread())
    for (filename, value) in outputs.items():
        path = ROOT / filename
        text = json.dumps(value, ensure_ascii=False, indent=2) + '\n'
        if args.check:
            if not path.exists() or path.read_text(encoding='utf-8') != text:
                raise ValueError(f'Proofreading output differs: {filename}')
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding='utf-8')
    audit = outputs['docs/教材原件校对记录-2026-11-10.json']
    print(json.dumps(audit['totals'], ensure_ascii=False))
if __name__ == '__main__':
    main()
