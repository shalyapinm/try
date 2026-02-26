import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';

const DEBUG_NORMALIZE = false;
import { parseOrderText } from "./utils/orderTextParser.js";

const DEMO_CSV = `sku,name,aliases,unit,price,category
MW-50-300,Минвата 50мм пачка 3м2,"минвата;вата;утеплитель",пачка,1450,Утеплитель
OSB-6-1250x2500,OSB-3 6мм 1250x2500,"осб;усб;osb",лист,980,Листовые
OSB-9-1250x2500,OSB-3 9мм 1250x2500,"осб;усб;osb",лист,1220,Листовые
GKL-12-2500,ГКЛ 12.5мм 1200x2500,"гкл;гипсокартон",лист,420,Листовые
CEM-M500-50,Цемент М500 50кг,"цемент;портландцемент",мешок,650,Сухие смеси
SAND-40,Пескобетон М300 40кг,"пескобетон;м300",мешок,310,Сухие смеси
PLY-12-FK,Фанера ФК 12мм 1525x1525,"фанера",лист,1350,Листовые
REBAR-12,Арматура А500С 12мм 11.7м,"арматура;а500с",шт,890,Металл
BLOCK-D500,Газоблок D500 625x250x300,"газоблок;блок",шт,285,Блоки
PRIMER-10,Грунтовка глубокого проникновения 10л,"грунтовка",канистра,920,ЛКМ`;

const LS_KEYS = {
  sheetUrl: 'bo_sheet_url',
  dirtyText: 'bo_dirty_text',
  parserSource: 'bo_parser_source',
};

function normalizeText(s = '') { return String(s).toLowerCase().replace(/ё/g, 'е').replace(/["'`]/g, ' ').replace(/[()\[\]{}]/g, ' ').replace(/[\\/]/g, ' ').replace(/[,;:+]/g, ' ').replace(/\s+/g, ' ').trim(); }
function tokenize(s = '') { return normalizeText(s).split(' ').filter(Boolean); }
function formatMoney(n) { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(n || 0)); }

function parseCsv(text) {
  const rows=[]; let row=[], cell='', inQuotes=false;
  for (let i=0;i<text.length;i++) {
    const ch=text[i], next=text[i+1];
    if (ch === '"') { if (inQuotes && next === '"') { cell += '"'; i++; } else inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { row.push(cell); cell=''; continue; }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell); cell=''; if (row.some(x => String(x).trim() !== '')) rows.push(row); row=[]; continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); if (row.some(x=>String(x).trim()!=='')) rows.push(row); }
  if (!rows.length) return { headers: [], items: [] };
  const headers = rows[0].map(h => normalizeText(h));
  return { headers, items: rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? '').trim()]))) };
}
function parseSpreadsheetArrayBuffer(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames?.[0]];
  return ws ? XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }) : [];
}
function mapColumns(rawItems) {
  const aliases = { sku:['sku','артикул','код','id'], name:['name','товар','наименование','title','позиция'], aliases:['aliases','синонимы','keywords','ключи','alias'], unit:['unit','ед','единица','едизм','единицаизмерения','ед.'], price:['price','цена','стоимость'], category:['category','категория','group','группа'] };
  const normalizedItems = (rawItems||[]).map(row => Object.fromEntries(Object.entries(row||{}).map(([k,v]) => [normalizeText(k), String(v ?? '').trim()])));
  if (!normalizedItems.length) return [];
  const detect = (obj, logical) => {
    const keys = Object.keys(obj || {});
    for (const c of aliases[logical] || []) { const n = normalizeText(c); const k = keys.find(x => x === n); if (k) return k; }
    for (const c of aliases[logical] || []) { const n = normalizeText(c); const k = keys.find(x => x.includes(n)); if (k) return k; }
    return null;
  };
  const f = { sku:detect(normalizedItems[0],'sku'), name:detect(normalizedItems[0],'name'), aliases:detect(normalizedItems[0],'aliases'), unit:detect(normalizedItems[0],'unit'), price:detect(normalizedItems[0],'price'), category:detect(normalizedItems[0],'category') };
  return normalizedItems.map((r,i)=>{
    const name = r[f.name] || '';
    const aliasList = String(f.aliases ? r[f.aliases] : '').split(/[;|,]/).map(s=>s.trim()).filter(Boolean);
    const priceVal = Number(String(f.price ? r[f.price] : '').replace(/\s/g,'').replace(/,/g,'.'));
    const sku = (f.sku ? r[f.sku] : '') || `ROW-${i+1}`;
    const unit = (f.unit ? r[f.unit] : '') || 'шт';
    const category = (f.category ? r[f.category] : '') || '';
    const searchBlob = [name, ...aliasList, category, sku].join(' ');
    return { id:`${sku}-${i}`, sku, name, aliases:aliasList, unit, price:Number.isFinite(priceVal)?priceVal:0, category, searchBlob, tokens:tokenize(searchBlob) };
  }).filter(x=>x.name);
}
function levenshtein(a,b){ const s=a||'', t=b||''; const m=s.length,n=t.length; if(!m) return n; if(!n) return m; const dp=Array.from({length:m+1},()=>Array(n+1).fill(0)); for(let i=0;i<=m;i++) dp[i][0]=i; for(let j=0;j<=n;j++) dp[0][j]=j; for(let i=1;i<=m;i++) for(let j=1;j<=n;j++){ const c=s[i-1]===t[j-1]?0:1; dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+c);} return dp[m][n]; }
const UNIT_ALIASES = { шт:['шт','штук','штука','шт.'], лист:['лист','листа','листов'], пачка:['пачка','пачки','пачек','уп'], мешок:['мешок','мешка','мешков'], канистра:['канистра','канистры'], м2:['м2','м²'], м3:['м3','м³'], кг:['кг'], л:['л','литр','литра','литров'], м:['м','метр','метра','метров','мп'] };
const UNIT_CANON = Object.entries(UNIT_ALIASES).reduce((a,[k,v])=>{ v.forEach(x => a[normalizeText(x)] = k); return a; }, {});
function unitToCanonical(u){ return UNIT_CANON[normalizeText(u)] || normalizeText(u) || 'шт'; }
function extractRequestsFromDirtyText(input) {
  const lines = String(input || '').replace(/\r/g,'\n').replace(/[;]+/g,'\n').split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const re = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(шт\.?|штук|штука|лист(?:а|ов)?|пач(?:ка|ки|ек)?|меш(?:ок|ка|ков)?|канистр(?:а|ы)?|м2|м²|м3|м³|кг|л(?:итр(?:а|ов)?)?|мп|м(?:етр(?:а|ов)?)?)\s*$/i;
  return lines.map(line => {
    let itemText = line, qty = 1, unit = 'шт';
    const m = line.match(re);
    if (m) { qty = Number(String(m[1]).replace(',', '.')); unit = unitToCanonical(m[2]); itemText = line.slice(0, m.index).trim(); }
    return { raw: line, itemText: itemText || line, qty: Number.isFinite(qty)&&qty>0?qty:1, unit };
  });
}
function scoreItem(queryText, item){
  const qNorm = normalizeText(queryText), qTokens = tokenize(queryText), iTokens = item.tokens || []; if (!qTokens.length) return { score:0, confidence:0 };
  let score=0, overlap=0; const set = new Set(iTokens);
  qTokens.forEach(t => { if (set.has(t)) { score += 18; overlap++; return; } if (iTokens.some(it => it.startsWith(t)||t.startsWith(it)) && t.length >= 3) score += 8; });
  const allTokensHit = qTokens.every(t => set.has(t) || iTokens.some(it => it.startsWith(t) || t.startsWith(it)));
  if (allTokensHit) score += 25;
  const itemNorm = normalizeText(item.searchBlob); if (itemNorm.includes(qNorm)) score += 25;
  const qNums = (qNorm.match(/\d+(?:[.,]\d+)?/g) || []).map(x=>x.replace(',','.')); const iNums = itemNorm.match(/\d+(?:[.,]\d+)?/g) || [];
  qNums.forEach(n => { if (iNums.includes(n)) score += 15; });
  const dist = levenshtein(qNorm, itemNorm.slice(0, Math.max(qNorm.length,1)+10)); score += Math.max(0, 1 - dist/Math.max(qNorm.length,1)) * 15; if (!overlap) score *= 0.6;
  return { score, confidence: Math.max(0, Math.min(100, Math.round(score))) };
}
const matchTop = (q, assortment, topN=3) => assortment.map(item => ({ item, ...scoreItem(q, item) })).sort((a,b)=>b.score-a.score).slice(0,topN);
function parseFromSheetUrl(s='') { try { const u = new URL(String(s).trim()); if (u.hostname.includes('docs.google.com') && u.pathname.includes('/spreadsheets/d/')) { const parts=u.pathname.split('/'); const id=parts[parts.indexOf('d')+1]; const gid=u.hash.includes('gid=')?u.hash.split('gid=')[1]:u.searchParams.get('gid'); return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${gid?`&gid=${gid}`:''}`; } return u.toString(); } catch { return String(s||'').trim(); } }

export default function App() {
  const [sheetUrl, setSheetUrl] = useState(() => localStorage.getItem(LS_KEYS.sheetUrl) || '');
  const [parserSourceUrl, setParserSourceUrl] = useState(() => localStorage.getItem(LS_KEYS.parserSource) || '');
  const [assortment, setAssortment] = useState(() => mapColumns(parseCsv(DEMO_CSV).items));
  const [loadState, setLoadState] = useState({ status:'ok', message:'Загружен демо-ассортимент' });
  const [dirtyText, setDirtyText] = useState(() => localStorage.getItem(LS_KEYS.dirtyText) || 'минвата 300 6 пачек\nусб 9 8 листов\nцемент м500 10 мешков');
  const [results, setResults] = useState([]);
  const [resultFilter, setResultFilter] = useState('all');
  const [sendState, setSendState] = useState('');
  const [voiceState, setVoiceState] = useState('idle');
  const recRef = useRef(null);

  useEffect(()=>localStorage.setItem(LS_KEYS.sheetUrl, sheetUrl), [sheetUrl]);
  useEffect(()=>localStorage.setItem(LS_KEYS.parserSource, parserSourceUrl), [parserSourceUrl]);
  useEffect(()=>localStorage.setItem(LS_KEYS.dirtyText, dirtyText), [dirtyText]);

  const applyAssortment = (items, label) => {
    const mapped = mapColumns(items);
    if (!mapped.length) throw new Error('Не найдены строки ассортимента (нужны name/наименование и желательно price).');
    setAssortment(mapped);
    setLoadState({ status:'ok', message:`Загружено ${mapped.length} позиций (${label})` });
  };

  const loadDemo = () => applyAssortment(parseCsv(DEMO_CSV).items, 'Демо');
  const loadFromGoogle = async () => {
    const url = parseFromSheetUrl(sheetUrl);
    if (!url) return setLoadState({ status:'error', message:'Вставьте ссылку на Google Sheets' });
    setLoadState({ status:'loading', message:'Загрузка из Google Sheets...' });
    try { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); applyAssortment(parseCsv(await r.text()).items, 'Google Sheets'); }
    catch (e) { setLoadState({ status:'error', message:`Ошибка Google Sheets: ${e.message}` }); }
  };
  const loadFromFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setLoadState({ status:'loading', message:`Читаю ${f.name}...` });
    try {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (ext === 'csv') applyAssortment(parseCsv(await f.text()).items, `CSV ${f.name}`);
      else if (ext === 'xlsx' || ext === 'xls') applyAssortment(parseSpreadsheetArrayBuffer(await f.arrayBuffer()), `Excel ${f.name}`);
      else throw new Error('Нужен CSV/XLSX');
    } catch (e2) { setLoadState({ status:'error', message:e2.message }); }
    e.target.value = '';
  };
  const syncFromSite = async () => {
    setLoadState({ status:'loading', message:'Синхронизация через /api/parser-sync...' });
    try {
      const url = parserSourceUrl || sheetUrl;
      const resp = await fetch(`/api/parser-sync${url ? `?url=${encodeURIComponent(url)}` : ''}`);
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      applyAssortment(data.items, `parser-sync`);
    } catch (e) {
      setLoadState({ status:'error', message:`Парсер не загрузил ассортимент: ${e.message}` });
    }
  };

  const runParse = () => {
    const reqs = extractRequestsFromDirtyText(dirtyText);
    const prepared = reqs.map((r, idx) => {
      const parsed = parseOrderText(r.itemText);
      const normalizedQuery = parsed?.cleanedText || r.itemText;
      const candidates = matchTop(normalizedQuery, assortment, 3);
      const best = candidates[0];
      return { rowId:`${Date.now()}-${idx}`, ...r, normalizedQuery, candidates, confidence: best?.confidence || 0, selectedId: (best?.confidence || 0) >= 40 ? (best.item.id) : '' };
    });
    setResults(prepared); setResultFilter('all');
  };
  const updateResult = (rowId, patch) => setResults(prev => prev.map(r => r.rowId === rowId ? { ...r, ...patch } : r));

  const total = useMemo(() => results.reduce((s,r)=>{ const it = assortment.find(a=>a.id===r.selectedId); return s + (it?.price || 0) * (Number(r.qty)||0); }, 0), [results, assortment]);
  const groupedOrder = useMemo(() => {
    const g = new Map(); const unresolved = [];
    results.forEach(r => {
      const item = assortment.find(a => a.id === r.selectedId); if (!item) return unresolved.push(r);
      const key = `${item.id}__${r.unit || item.unit}`; if (!g.has(key)) g.set(key, { item, qty:0, unit:r.unit || item.unit }); g.get(key).qty += Number(r.qty) || 0;
    });
    return { grouped:g, unresolved };
  }, [results, assortment]);
  const orderLines = useMemo(() => {
    const out = []; let i=1;
    for (const [,row] of groupedOrder.grouped) out.push(`${i++}. ${row.item.name} [${row.item.sku}] — ${row.qty} ${row.unit} × ${formatMoney(row.item.price)} ₽ = ${formatMoney(row.item.price*row.qty)} ₽`);
    for (const r of groupedOrder.unresolved) out.push(`${i++}. НЕ РАСПОЗНАНО: ${r.itemText}`);
    return out;
  }, [groupedOrder]);
  const orderText = orderLines.join('\n');
  const visibleResults = useMemo(() => resultFilter === 'unresolved' ? results.filter(r=>!r.selectedId) : resultFilter === 'low' ? results.filter(r=>r.confidence<45) : results, [resultFilter, results]);

  const copyOrder = async () => { try { await navigator.clipboard.writeText(orderText || ''); alert('Скопировано'); } catch { alert('Не удалось скопировать'); } };
  const exportOrderXlsx = () => { if (!orderLines.length) return alert('Нет данных'); const rows=[]; for (const [,row] of groupedOrder.grouped) rows.push({SKU:row.item.sku, Наименование:row.item.name, Количество:row.qty, Ед:row.unit, Цена:row.item.price, Сумма:row.item.price*row.qty}); groupedOrder.unresolved.forEach(r=>rows.push({SKU:'', Наименование:`НЕ РАСПОЗНАНО: ${r.itemText}`, Количество:r.qty, Ед:r.unit, Цена:'', Сумма:''})); rows.push({}); rows.push({Наименование:'ИТОГО', Сумма:total}); const ws=XLSX.utils.json_to_sheet(rows); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Заказ'); XLSX.writeFile(wb,`order_${new Date().toISOString().slice(0,10)}.xlsx`); };

  const sendOrder = async () => {
    if (!orderLines.length) return alert('Сначала разберите заказ');
    setSendState('Отправка...');
    try {
      const resp = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerText: dirtyText, lines: orderLines, total, source: 'web-ui', createdAt: new Date().toLocaleString('ru-RU') })
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      setSendState('✅ Отправлено в Telegram');
    } catch (e) { setSendState(`❌ ${e.message}`); }
  };

  const toggleVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return alert('В этом браузере нет Web Speech API. Откройте в Chrome на Android/Desktop и разрешите микрофон.');
    if (recRef.current) {
      recRef.current.stop();
      recRef.current = null;
      setVoiceState('idle');
      return;
    }
    const rec = new SR();
    rec.lang = 'ru-RU'; rec.interimResults = true; rec.continuous = true;
    rec.onstart = () => setVoiceState('listening');
    rec.onend = () => { recRef.current = null; setVoiceState('idle'); };
    rec.onerror = () => setVoiceState('error');
    rec.onresult = (event) => {
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0]?.transcript || '';
        if (event.results[i].isFinal) finalText += t + '\n';
      }
      if (finalText) setDirtyText(prev => (prev ? prev + '\n' : '') + finalText.trim());
    };
    recRef.current = rec;
    rec.start();
  };

  const statusClass = loadState.status === 'error' ? 'status status-error' : loadState.status === 'loading' ? 'status status-loading' : 'status status-ok';

  return (
    <div className='container'>
      <div className='card' style={{ marginBottom: 16 }}>
        <h1>Парсер заказа стройматериалов</h1>
        <div className='muted' style={{ marginTop: 6 }}>Ассортимент с сайта/таблицы → грязный текст/голос → подбор номенклатуры → отправка в Telegram.</div>
      </div>

      <div className='grid grid-main'>
        <div className='grid'>
          <div className='card'>
            <h2>1) Ассортимент</h2>
            <div className='muted' style={{ marginTop: 6 }}>Можно загрузить таблицу вручную или тянуть через Vercel parser-sync.</div>
            <input className='input' style={{ marginTop: 8 }} placeholder='Google Sheets URL (опц.)' value={sheetUrl} onChange={(e)=>setSheetUrl(e.target.value)} />
            <input className='input' style={{ marginTop: 8 }} placeholder='URL прайса/сайта для parser-sync (CSV/JSON/XLSX/HTML table)' value={parserSourceUrl} onChange={(e)=>setParserSourceUrl(e.target.value)} />
            <div className='row' style={{ marginTop: 8, flexWrap:'wrap' }}>
              <button className='btn btn-primary' onClick={loadFromGoogle}>Google Sheets</button>
              <button className='btn' onClick={syncFromSite}>Синхронизировать с сайта</button>
              <button className='btn' onClick={loadDemo}>Демо</button>
            </div>
            <div style={{ marginTop: 10 }}>
              <div className='small'>Файл CSV/XLSX</div>
              <input className='file-input' type='file' accept='.xlsx,.xls,.csv' onChange={loadFromFile} />
            </div>
            <div className={statusClass}>{loadState.message}</div>
          </div>

          <div className='card'>
            <h2>2) Сообщение клиента</h2>
            <div className='row' style={{ marginTop: 8 }}>
              <button className={`btn ${voiceState==='listening' ? 'btn-amber' : 'btn-blue'}`} onClick={toggleVoice}>{voiceState==='listening' ? '⏹ Остановить запись' : '🎤 Голосовой ввод'}</button>
              <span className='muted'>{voiceState==='listening' ? 'Слушаю...' : 'Chrome + доступ к микрофону'}</span>
            </div>
            <textarea className='textarea' style={{ marginTop: 8 }} value={dirtyText} onChange={(e)=>setDirtyText(e.target.value)} />
            <button className='btn btn-blue' style={{ marginTop: 8, width:'100%' }} onClick={runParse}>Разобрать заказ</button>
          </div>

          <div className='card'>
            <div className='row' style={{ justifyContent:'space-between' }}><h2>3) Итого</h2><div style={{ fontSize:20, fontWeight:700 }}>{formatMoney(total)} ₽</div></div>
            <div className='toolbar'>
              <button className='btn btn-green' onClick={copyOrder}>Копировать</button>
              <button className='btn btn-amber' onClick={exportOrderXlsx}>Excel</button>
              <button className='btn btn-primary' onClick={sendOrder}>Отправить</button>
            </div>
            {sendState ? <div className='status status-ok' style={{ marginTop:8 }}>{sendState}</div> : null}
            <div className='pre' style={{ marginTop: 8 }}>{orderText || 'После разбора здесь появится черновик заказа.'}</div>
          </div>
        </div>

        <div className='grid'>
          <div className='card'>
            <div className='row' style={{ justifyContent:'space-between' }}><h2>Ассортимент</h2><span className='badge'>{assortment.length} позиций</span></div>
            <div className='table-wrap' style={{ marginTop: 10 }}><table><thead><tr><th>SKU</th><th>Наименование</th><th>Ед</th><th className='text-right'>Цена</th></tr></thead><tbody>{assortment.slice(0,120).map(a => <tr key={a.id}><td style={{color:'#64748b',fontSize:12}}>{a.sku}</td><td>{a.name}</td><td>{a.unit}</td><td className='text-right'>{formatMoney(a.price)} ₽</td></tr>)}</tbody></table></div>
          </div>
          <div className='card'>
            <div className='row' style={{ justifyContent:'space-between', flexWrap:'wrap' }}>
              <h2>Результат разбора</h2>
              <div className='row'>
                <button className={`chip ${resultFilter==='all'?'active':''}`} onClick={()=>setResultFilter('all')}>Все ({results.length})</button>
                <button className={`chip ${resultFilter==='low'?'active':''}`} onClick={()=>setResultFilter('low')}>Низкая ({results.filter(r=>r.confidence<45).length})</button>
                <button className={`chip ${resultFilter==='unresolved'?'active':''}`} onClick={()=>setResultFilter('unresolved')}>Нет совп. ({results.filter(r=>!r.selectedId).length})</button>
              </div>
            </div>
            {!results.length ? <div className='muted' style={{marginTop:10}}>Нажмите «Разобрать заказ».</div> : (
              <div className='grid' style={{ marginTop:10 }}>
                {visibleResults.map(r => {
                  const selected = assortment.find(a => a.id === r.selectedId); const bar = r.confidence >= 70 ? 'progress-green' : r.confidence >= 45 ? 'progress-amber' : 'progress-red';
                  return <div key={r.rowId} className='result-item'>
                    <div className='result-grid'>
                      <div><div className='muted'>Исходник</div><div style={{fontWeight:600,marginTop:4}}>{r.itemText}</div>
                        <div className='muted' style={{marginTop:6,fontSize:12}}>{DEBUG_NORMALIZE && r.normalizedQuery && r.normalizedQuery !== r.itemText ? ("Нормализовано: " + r.normalizedQuery) : ""}</div><div className='row small' style={{marginTop:8}}><span style={{color:'#64748b'}}>Уверенность</span><div className='progress'><div className={bar} style={{width:(r.confidence + "%")}} /></div><b>{r.confidence}%</b></div></div>
                      <div className='grid' style={{ gridTemplateColumns:'1fr 90px 90px', gap:8 }}>
                        <div><div className='muted'>Позиция</div><select className='select' value={r.selectedId} onChange={(e)=>updateResult(r.rowId,{selectedId:e.target.value})} style={{marginTop:4}}><option value=''>— Не выбрано —</option>{r.candidates.map(c => <option key={c.item.id} value={c.item.id}>{c.item.name} ({c.confidence}%)</option>)}</select></div>
                        <div><div className='muted'>Кол-во</div><input className='input' value={r.qty} onChange={(e)=>updateResult(r.rowId,{qty:e.target.value})} style={{marginTop:4}} /></div>
                        <div><div className='muted'>Ед</div><input className='input' value={r.unit} onChange={(e)=>updateResult(r.rowId,{unit:e.target.value})} style={{marginTop:4}} /></div>
                      </div>
                    </div>
                  </div>;
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
