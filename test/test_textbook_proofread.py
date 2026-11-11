# -*- coding: utf-8 -*-
"""Content regressions against the supplied local PDFs; never downloads fixtures."""
import importlib.util
import json
import openpyxl
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('proofread_textbooks', ROOT / 'tools/proofread-textbooks.py')
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)


class TextbookProofreadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.results = proof.proofread()
        cls.books = {item['book']: item for item in cls.results}
        cls.outputs = proof.build_outputs(cls.results)

    def test_all_supplied_entries_have_matching_pdf_text_and_course_context(self):
        tables = [table for book in self.results for table in book['tables'].values()]
        self.assertEqual(len(tables), 32)
        self.assertEqual(sum(table['sourceCount'] for table in tables), 7819)
        self.assertTrue(all(table['sequenceEqual'] for table in tables))
        self.assertTrue(all(not book['tocMissing'] for book in self.results))
        self.assertEqual(sum(table['printedCount'] is not None for table in tables), 29)

    def test_same_numbers_in_poetry_appendix_do_not_overwrite_main_lessons(self):
        courses = self.books['六年级下册']['toc']
        self.assertEqual(courses['5']['title'], '鲁滨逊漂流记（节选）')
        self.assertEqual(courses['8']['title'], '匆匆')
        self.assertEqual(courses['9']['unit'], '第三单元')
        self.assertEqual(courses['10']['title'], '古诗三首')

    def test_low_grade_sections_and_continuation_headings_stay_distinct(self):
        courses = self.books['一年级上册']['toc']
        self.assertEqual(courses['识字1']['title'], '天地人')
        self.assertEqual(courses['汉语拼音1']['title'], 'a o e')
        self.assertEqual(courses['阅读1']['title'], '秋天')
        self.assertEqual(courses['识字5']['unit'], '第六单元')

    def test_two_column_writing_order_and_right_column_tenth_lesson(self):
        rows = self.books['一年级上册']['tables']['写字表']['source']
        self.assertEqual(''.join(row['text'] for row in rows[:12]), '一二三上口耳目手日火田禾')
        target = [row for row in rows if row['sourceType'] == '课文' and row['sourceLesson'] == '阅读10']
        self.assertEqual(''.join(row['text'] for row in target), '来半你有')

    def test_partial_double_columns_do_not_merge_right_hand_pinyin_lessons(self):
        rows = self.books['一年级上册']['tables']['识字表']['source']
        expected = {'汉语拼音4':'大马路土','汉语拼音8':'桌纸读书','汉语拼音9':'鱼鸭乌鸦','汉语拼音13':'蓝云草原','汉语拼音14':'冰自行车'}
        for lesson, characters in expected.items():
            actual = ''.join(row['text'] for row in rows if row['sourceType']=='课文' and row['sourceLesson']==lesson)
            self.assertEqual(actual, characters)

    def test_font_codes_and_extraction_punctuation_are_not_new_readings(self):
        self.assertEqual(proof.decode('lC'), 'lǜ')
        self.assertEqual(proof.decode('lB'), 'lǘ')
        self.assertEqual(proof.decode('mH、'), 'mò')
        changes = self.outputs['resources/textbooks/proofread-corrections.json']['patches']
        self.assertFalse(any(change['after'] == 'mò、' for change in changes))

    def test_drawing_annotation_is_not_misreported_as_unprinted(self):
        row = next(row for row in self.books['三年级下册']['tables']['识字表']['source'] if row['text'] == '略')
        self.assertEqual(row['rawPinyin'], '')
        self.assertEqual(row['pinyin'], 'lüè')
        self.assertEqual(row['pinyinMethod'], 'visual-path-annotation')
        self.assertEqual(self.books['三年级下册']['source']['sha256'], proof.VISUAL_PINYIN[('三年级下册',117,'略')][1])

    def test_corrections_are_cell_scoped_with_original_values_and_source_hashes(self):
        correction = self.outputs['resources/textbooks/proofread-corrections.json']
        self.assertEqual(len(correction['sourceHashes']), 13)
        self.assertEqual(set(correction['fieldColumns']), {'课序','拼音','单元','课题'})
        totals = self.outputs['docs/教材原件校对记录-2026-11-10.json']['totals']
        self.assertEqual(totals['cellsByField'], {'拼音':557,'课序':20,'课题':176,'单元':316})
        self.assertEqual(totals['pinyinCorrectionKinds'], {'font-code-decoding':6,'missing-writing-pinyin':550,'visual-path-annotation':1})
        self.assertEqual(totals['changedCells'], 1069)
        self.assertTrue(all(patch['evidence'].get('pdfPage') for patch in correction['patches']))


    def test_runtime_books_preserve_all_checked_rows_and_course_context(self):
        correction=json.loads((ROOT/'resources/textbooks/proofread-corrections.json').read_text())
        index=json.loads((ROOT/'resources/textbooks/pilot-v1/index.json').read_text())
        self.assertEqual(len(index['books']),12)
        workbook=openpyxl.load_workbook(ROOT/proof.WORKBOOK,read_only=True,data_only=True)
        total=0
        try:
            for entry in index['books']:
                book=json.loads((ROOT/f'resources/textbooks/pilot-v1/{entry["id"]}.json').read_text())
                rows=[list(row) for row in workbook[book['title']].values]
                for patch in correction['patches']:
                    if patch['sheet']!=book['title']:continue
                    column=ord(correction['fieldColumns'][patch['field']])-ord('A')
                    for number in patch['rows']:
                        self.assertEqual(rows[number-1][column],patch['before'])
                        rows[number-1][column]=patch['after']
                expected={}
                for table in ['识字表','写字表','词语表']:
                    originals=[(i,row) for i,row in enumerate(rows,1) if row[0]==table]
                    source=self.books[book['title']]['tables'].get(table,{}).get('source',[])
                    self.assertEqual(len(originals),len(source))
                    expected.update({f'row-{i}':(row,src) for (i,row),src in zip(originals,source)})
                seen=set()
                for unit in book['units']:
                    for task in unit['tasks']:
                        for mode in ['read','write','words']:
                            self.assertEqual([item['sourceRow'] for item in task.get(mode,[])],sorted(item['sourceRow'] for item in task.get(mode,[])))
                            for item in task.get(mode,[]):
                                self.assertNotIn(item['id'],seen);seen.add(item['id'])
                                row,src=expected[item['id']]
                                self.assertEqual(row[0],{'read':'识字表','write':'写字表','words':'词语表'}[mode])
                                if mode=='words':
                                    self.assertEqual((item['text'],item['pdfPage']),(row[5],row[8]))
                                else:
                                    self.assertEqual((item['character'],item['reading'],item['polyphonic'],item['pdfPage']),(row[5],row[6],row[7]=='是',row[8]))
                                self.assertEqual(task['kind'],'garden' if src['sourceType']=='语文园地' else 'lesson')
                                if task['kind']=='lesson':
                                    course=self.books[book['title']]['toc'][str(src['sourceLesson'])]
                                    self.assertEqual(task['title'],course['title']);self.assertEqual(unit['title'],course['unit'])
                                elif src['sourceGarden']=='语文园地':
                                    self.assertEqual(unit['title'],row[2]);self.assertEqual(task['sourceLabel'],'语文园地')
                self.assertEqual(seen,set(expected));total+=len(seen)
        finally:
            workbook.close()
        self.assertEqual(total,7819)

    def test_runtime_numberless_gardens_merge_read_write_without_reusing_last_lesson_id(self):
        book=json.loads((ROOT/'resources/textbooks/pilot-v1/g3-first.json').read_text())
        garden=next(task for task in book['units'][2]['tasks'] if task['id']=='garden-3')
        workbook=openpyxl.load_workbook(ROOT/proof.WORKBOOK,read_only=True,data_only=True)
        try:
            rows=list(workbook['三年级上册'].values)
            read={rows[item['sourceRow']-1][1] for item in garden['read']}
            write={rows[item['sourceRow']-1][1] for item in garden['write']}
            self.assertEqual(read,{10});self.assertEqual(write,{8})
        finally:
            workbook.close()


if __name__ == '__main__':
    unittest.main()
