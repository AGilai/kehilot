import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seatFont, seatingMapHtml } from '../src/seatingMapReport.ts';
import { demoSeating } from '../src/seating.ts';
import type { SeatingMap } from '../src/types.ts';

const report: SeatingMap = { event: demoSeating(new Date('2026-10-27T12:00:00Z')).event, warnings: [], generatedAt: '2026-10-27T12:00:00Z', freeColor: '#6AA84F',
  layout: { revision: 1, width: 300, height: 50, sourceRange:'A1:E2',sheet:'Map',rightToLeft:false,cells:[
    {id:'A1',x:0,y:0,width:50,height:20,label:'משפחה-1',kind:'seat',background:'#FF7C80',color:'#000000',fontSize:11,bold:false,borders:[true,true,true,true]},
    {id:'B1',x:50,y:0,width:50,height:20,label:'משפחה-2',kind:'seat',background:'#FF7C80',color:'#000000',fontSize:11,bold:false,borders:[true,true,true,true]},
    {id:'D1',x:150,y:0,width:100,height:40,label:'בימה',kind:'label',background:'#FD9997',color:'#000000',fontSize:11,bold:false,borders:[false,false,false,false]},
  ]}, maps: [
    {prayer:'arvit',title:'ערבית',freeSeats:1,cells:[{cellId:'A1',label:'משפחה-1',available:false},{cellId:'B1',label:'פנוי',available:true},{cellId:'D1',label:'בימה',available:false}]},
    {prayer:'shacharit',title:'שחרית',freeSeats:0,cells:[{cellId:'A1',label:'משפחה-1',available:false},{cellId:'B1',label:'משפחה-2',available:false},{cellId:'D1',label:'בימה',available:false}]},
  ] };

test('one landscape sheet contains two separate positioned maps and green free seats', () => {
  const html=seatingMapHtml(report);
  assert.ok(html.includes('@page{size:A4 landscape;margin:15mm}'));
  assert.equal((html.match(/<section>/g)||[]).length,2);
  assert.equal((html.match(/data-cell="D1"/g)||[]).length,2);
  assert.ok(html.includes('ערבית · 1 מקומות פנויים'));
  assert.ok(html.includes('שחרית · 0 מקומות פנויים'));
  assert.equal((html.match(/background:#6AA84F/g)||[]).length,1);
  assert.equal((html.match(/background:#FFFFFF/g)||[]).length,3);
  assert.ok(!html.includes('background:#FF7C80'));
  assert.ok(html.includes('height:180pt'));
  assert.ok(html.includes('white-space:nowrap'));
  assert.ok(html.includes('27-10-2026'));
  assert.ok(seatingMapHtml(report,true).includes('landscape;margin:0mm'));
});

test('map print escapes labels, keeps all cells, and refuses incomplete snapshots', () => {
  const changed=structuredClone(report);changed.maps[0]!.cells[0]!.label='<img src=x onerror="alert(1)">';
  const html=seatingMapHtml(changed);
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
  assert.ok(!/<img|<script|https?:\/\//.test(html));
  assert.equal((html.match(/class="cell"/g)||[]).length,6);
  assert.throws(()=>seatingMapHtml({...report,layout:null}));
  changed.maps[1]!.cells.pop();assert.throws(()=>seatingMapHtml(changed));
  assert.ok(seatFont('שם משפחה ארוך-4',24,16,7)<7);
});
