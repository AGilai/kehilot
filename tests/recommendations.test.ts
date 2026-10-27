import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classificationLabel, recommendationCells, recommendationColumns, recommendationsHtml, REPORT_COLUMNS, TRIBE_BACKGROUNDS } from '../src/recommendations.ts';
import type { AliyahRecommendations, RecommendationPerson } from '../src/types.ts';

const person: RecommendationPerson = { id: 'permanent-person', name: 'ישראל ישראלי', firstName: 'ישראל', lastName: 'ישראלי', tribe: 'yisrael', torahName: 'ישראל בן אברהם', wifePrayerName: 'שרה בת יצחק', classification: 'א', aliyahCount: 0, windowMonths: 12, lastAliyahDate: null, lastAliyah: 'לא נמצא', events: [] };
const report: AliyahRecommendations = { service: { date: '2026-10-31', reading: 'וירא', parashot: ['וירא'], hebrewDate: 'כ׳ חשון תשפ״ז', year: 5787, yearLabel: 'תשפ״ז', title: 'שבת פרשת וירא - תשפ״ז' }, eventWindowEnd: '2026-11-07', notes: ['בדיקת דוח'], sections: [{ id: 'events', title: 'אירועים', limit: null, people: [person] }, { id: 'kohen', title: 'כהנים', limit: 15, people: [] }] };

test('report columns follow the requested RTL order and keep zero distinct from missing counts', () => {
  assert.deepEqual(recommendationCells(person), ['ישראל', 'ישראל ישראלי', 'ישראל בן אברהם', 'שרה בת יצחק', 'דור א׳', '0', '—']);
  assert.equal(recommendationCells({ ...person, tribe: '', aliyahCount: null })[5], '—');
  assert.equal(classificationLabel('דור ב'), 'דור ב׳');
  assert.equal(classificationLabel('דור ב-נשוי'), 'דור ב׳-נשוי');
  assert.equal(classificationLabel('קבוע'), 'קבוע');
});

test('printable report preserves every section, row, event and tribe background without external resources', () => {
  const event = { kind: 'yahrzeit' as const, date: '2026-10-31', hebrewDate: 'כ׳ חשון תשפ״ז', description: 'יארצייט — אב, כ׳ חשון תשפ״ז', needsReview: false };
  const html = recommendationsHtml({ ...report, sections: [{ ...report.sections[0]!, people: [{ ...person, events: [event] }, { ...person, id: 'kohen', tribe: 'kohen' }, { ...person, id: 'levi', tribe: 'levi' }] }, report.sections[1]!] });
  assert.match(html, /<html lang="he" dir="rtl">/);
  assert.match(html, /size:A4 portrait/);
  assert.match(html, /<h1>שבת פרשת וירא - תשפ״ז<\/h1>/);
  assert.ok(html.includes(event.description));
  for (const background of Object.values(TRIBE_BACKGROUNDS)) assert.ok(html.includes(`background:${background}`));
  assert.equal(TRIBE_BACKGROUNDS.yisrael, '#FFFFFF');
  assert.notEqual(TRIBE_BACKGROUNDS.kohen, TRIBE_BACKGROUNDS.levi);
  assert.match(html, /table-header-group/);
  assert.ok(!/<script|<iframe|<link|<img|https?:\/\//i.test(html));
  assert.match(html, /אין מתפללים מתאימים/);
  const firstTable = html.slice(html.indexOf('<table'));
  assert.deepEqual([...firstTable.matchAll(/<th scope="col">([^<]+)<\/th>/g)].slice(0, 7).map(match => match[1]), REPORT_COLUMNS);
});

test('congregant text and report metadata are escaped in printable HTML', () => {
  const payload = '<img src=x onerror="alert(1)"> & \'name\'';
  const html = recommendationsHtml({ ...report, service: { ...report.service, title: payload }, notes: [payload], sections: [{ id: 'events', title: payload, limit: null, people: [{ ...person, name: payload, torahName: payload }] }] });
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &#39;name&#39;/);
  assert.ok(!html.includes(person.id));
});


test('ranked sections show last aliyah while events keep their event column on screen and print', () => {
  const last = 'י״ד אלול תשפ״ו · כי תבוא';
  const event = { kind: 'bar_mitzvah' as const, date: '2026-10-31', hebrewDate: 'כ׳ חשון תשפ״ז', description: 'בר מצווה', needsReview: false };
  const row = { ...person, lastAliyahDate: '2026-08-27', lastAliyah: last, events: [event] };
  for (const id of ['kohen', 'levi', 'israel_a', 'israel_b', 'israel_regular']) {
    assert.equal(recommendationColumns(id)[6], 'עלייה אחרונה');
    assert.equal(recommendationCells(row, id)[6], last);
    assert.equal(recommendationCells(person, id)[6], 'לא נמצא');
  }
  assert.equal(recommendationColumns('events')[6], 'אירוע');
  assert.equal(recommendationCells(row, 'events')[6], event.description);
  const html = recommendationsHtml({ ...report, sections: [
    { ...report.sections[0]!, people: [row] }, { ...report.sections[1]!, people: [row] },
  ] });
  const tables = html.split('<table').slice(1);
  assert.ok(tables[0]!.includes('<th scope="col">אירוע</th>'));
  assert.ok(!tables[0]!.includes(last));
  assert.ok(tables[1]!.includes('<th scope="col">עלייה אחרונה</th>'));
  assert.ok(tables[1]!.includes(last));
  assert.ok(!tables[1]!.includes('<td>בר מצווה</td>'));
});

test('last aliyah text is escaped in the printed ranked tables', () => {
  const html = recommendationsHtml({ ...report, sections: [{ ...report.sections[1]!, people: [{ ...person, lastAliyah: '<script>alert(1)</script>' }] }] });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});
