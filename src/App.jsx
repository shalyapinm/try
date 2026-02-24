
import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";

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

function normalizeText(s = "") {
  return String(s).toLowerCase().replace(/ё/g, "е")
    .replace(/["'`]/g, " ").replace(/[()\[\]{}]/g, " ")
    .replace(/[\/\\]/g, " ").replace(/[,;:+]/g, " ")
    .replace(/\s+/g, " ").trim();
}
function tokenize(s = "") { return normalizeText(s).split(" ").filter(Boolean); }
function formatMoney(n) { return new Intl.NumberFormat("ru-RU",{maximumFractionDigits:0}).format(Number(n||0)); }

function parseCsv(text) {
  const rows=[]; let row=[], cell="", inQuotes=false;
  for (let i=0;i<text.length;i++) {
    const ch=text[i], next=text[i+1];
    if (ch === '"') { if (inQuotes && next === '"') { cell += '"'; i++; } else inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { row.push(cell); cell=""; continue; }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell); cell="";
      if (row.some(x => String(x).trim() !== "")) rows.push(row);
      row=[]; continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); if (row.some(x => String(x).trim() !== "")) rows.push(row); }
  if (!rows.length) return { headers: [], items: [] };
  const headers = rows[0].map(h => normalizeText(h));
  const items = rows.slice(1).map(r => {
    const o = {}; headers.forEach((h,idx)=>{ o[h] = (r[idx] ?? "").trim(); }); return o;
  });
  return { headers, items };
}

function parseSpreadsheetArrayBuffer(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const firstSheetName = wb.SheetNames?.[0];
  if (!firstSheetName) return [];
  const sheet = wb.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

function mapColumns(rawItems) {
  const aliases = {
    sku: ["sku","артикул","код","id"],
    name: ["name","товар","наименование","title","позиция"],
    aliases: ["aliases","синонимы","keywords","ключи","alias"],
    unit: ["unit","ед","единица","едизм","единицаизмерения","ед."],
    price: ["price","цена","стоимость"],
    category: ["category","категория","group","группа"],
  };
  const normalizedItems = (rawItems||[]).map(row => {
    const out={}; Object.entries(row||{}).forEach(([k,v]) => out[normalizeText(k)] = String(v ?? "").trim()); return out;
  });
  if (!normalizedItems.length) return [];
  const detectField = (obj, logical) => {
    const keys = Object.keys(obj||{});
    for (const c of aliases[logical] || []) { const n = normalizeText(c); const exact = keys.find(k => k === n); if (exact) return exact; }
    for (const c of aliases[logical] || []) { const n = normalizeText(c); const p = keys.find(k => k.includes(n)); if (p) return p; }
    return null;
  };
  const sample = normalizedItems[0];
  const fields = {
    sku: detectField(sample,"sku"),
    name: detectField(sample,"name"),
    aliases: detectField(sample,"aliases"),
    unit: detectField(sample,"unit"),
    price: detectField(sample,"price"),
    category: detectField(sample,"category")
  };

  return normalizedItems.map((r,i)=>{
    const name = r[fields.name] || "";
    const aliasList = String(fields.aliases ? r[fields.aliases] : "").split(/[;|,]/).map(x=>x.trim()).filter(Boolean);
    const priceVal = Number(String(fields.price ? r[fields.price] : "").replace(/\s/g,"").replace(/,/g,"."));
    const unit = (fields.unit ? r[fields.unit] : "") || "шт";
    const sku = (fields.sku ? r[fields.sku] : "") || `ROW-${i+1}`;
    const category = (fields.category ? r[fields.category] : "") || "";
    const searchBlob = [name,...aliasList,category,sku].join(" ");
    return { id:`${sku}-${i}`, sku, name, aliases: aliasList, unit, price: Number.isFinite(priceVal)?priceVal:0, category, searchBlob, tokens: tokenize(searchBlob) };
  }).filter(x=>x.name);
}

function levenshtein(a,b){
  const s=a||"", t=b||""; const m=s.length, n=t.length; if(!m) return n; if(!n) return m;
  const dp = Array.from({length:m+1}, ()=>new Array(n+1).fill(0));
  for(let i=0;i<=m;i++) dp[i][0]=i; for(let j=0;j<=n;j++) dp[0][j]=j;
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++){
    const cost = s[i-1]===t[j-1] ? 0 : 1;
    dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
  }
  return dp[m][n];
}

const UNIT_ALIASES = {
  шт:["шт","штук","штука","шт.","pcs"], лист:["лист","листа","листов","лист."],
  пачка:["пачка","пачки","пачек","уп","упак","упаковка"], мешок:["мешок","мешка","мешков"],
  канистра:["канистра","канистры"], рулон:["рулон","рулона","рулонов"], м2:["м2","м²"], м3:["м3","м³"],
  кг:["кг"], т:["т","тонна","тонн"], л:["л","литр","литра","литров"], м:["м","метр","метра","метров","мп"]
};
const UNIT_CANON = Object.entries(UNIT_ALIASES).reduce((acc,[canon,arr])=>{ arr.forEach(x=>acc[normalizeText(x)] = canon); return acc; },{});
function unitToCanonical(u){ return UNIT_CANON[normalizeText(u)] || normalizeText(u) || "шт"; }

// Берем qty+unit в конце строки, чтобы цифры размеров оставались в названии
function extractRequestsFromDirtyText(input) {
  const text = String(input || "").replace(/\r/g,"\n").replace(/[;]+/g,"\n").trim();
  const lines = text.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  const tailQtyRegex = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(шт\.?|штук|штука|лист(?:а|ов)?|пач(?:ка|ки|ек)?|меш(?:ок|ка|ков)?|канистр(?:а|ы)?|рулон(?:а|ов)?|м2|м²|м3|м³|кг|т(?:онн|онна)?|л(?:итр(?:а|ов)?)?|мп|м(?:етр(?:а|ов)?)?)\s*$/i;
  const altTailQtyRegex = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*[xх*]\s*(шт\.?|лист(?:а|ов)?|пач(?:ка|ки|ек)?|меш(?:ок|ка|ков)?|канистр(?:а|ы)?|м2|м²|м3|м³|кг|л)\s*$/i;

  return lines.map(line => {
    let itemText = line, qty = 1, unit = "шт", unresolved = true;
    const m = line.match(tailQtyRegex) || line.match(altTailQtyRegex);
    if (m) {
      qty = Number(String(m[1]).replace(",", "."));
      unit = unitToCanonical(m[2]);
      itemText = line.slice(0, m.index).trim();
      unresolved = false;
    }
    itemText = String(itemText || "").replace(/[,:]+$/g,"").replace(/\s+/g," ").trim();
    if (!itemText) { itemText = line; unresolved = true; }
    return { raw: line, itemText, qty: Number.isFinite(qty)&&qty>0 ? qty : 1, unit, unresolved };
  });
}

function scoreItem(queryText, item) {
  const qNorm = normalizeText(queryText), qTokens = tokenize(queryText), iTokens = item.tokens || [];
  if (!qTokens.length) return { score: 0, confidence: 0 };
  let score = 0, overlap = 0; const set = new Set(iTokens);

  qTokens.forEach(t => {
    if (set.has(t)) { score += 18; overlap += 1; return; }
    if (iTokens.some(it => it.startsWith(t) || t.startsWith(it)) && t.length >= 3) score += 8;
  });

  const itemNorm = normalizeText(item.searchBlob);
  if (itemNorm.includes(qNorm)) score += 20;
  if (qNorm.includes(normalizeText(item.name))) score += 10;

  const qNums = (qNorm.match(/\d+(?:[.,]\d+)?/g) || []).map(x=>x.replace(",","."));
  const iNums = itemNorm.match(/\d+(?:[.,]\d+)?/g) || [];
  qNums.forEach(n => { if (iNums.includes(n)) score += 10; });

  const dist = levenshtein(qNorm, itemNorm.slice(0, Math.max(qNorm.length,1)+10));
  score += Math.max(0, 1 - dist / Math.max(qNorm.length,1)) * 15;
  if (!overlap) score *= 0.6;

  return { score, confidence: Math.max(0, Math.min(100, Math.round(score))) };
}

function matchTop(queryText, assortment, topN = 3){
  return assortment.map(item => ({ item, ...scoreItem(queryText, item) }))
    .sort((a,b)=>b.score-a.score).slice(0, topN);
}

function parseFromSheetUrl(input){
  const s = String(input||"").trim(); if (!s) return "";
  try {
    const url = new URL(s);
    if (url.hostname.includes("docs.google.com") && url.pathname.includes("/spreadsheets/d/")) {
      const parts = url.pathname.split("/");
      const idx = parts.findIndex(x => x === "d");
      const spreadsheetId = idx >= 0 ? parts[idx+1] : null;
      const gid = url.hash.includes("gid=") ? url.hash.split("gid=")[1] : url.searchParams.get("gid");
      if (spreadsheetId) return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ""}`;
    }
    return s;
  } catch { return s; }
}

export default function App() {
  const [sheetUrl, setSheetUrl] = useState("");
  const [assortment, setAssortment] = useState(() => mapColumns(parseCsv(DEMO_CSV).items));
  const [loadState, setLoadState] = useState({ status: "ok", message: "Загружен демо-ассортимент" });
  const [dirtyText, setDirtyText] = useState("минвата 300 6 пачек\nусб 9 8 листов\nцемент м500 10 мешков\nгрунтовка 2 канистры");
  const [results, setResults] = useState([]);
  const [resultFilter, setResultFilter] = useState("all"); // all|unresolved|low

  const total = useMemo(() => {
    return results.reduce((sum, r) => {
      const item = assortment.find(a => a.id === r.selectedId);
      return sum + (item?.price || 0) * (Number(r.qty) || 0);
    }, 0);
  }, [results, assortment]);

  const groupedOrder = useMemo(() => {
    const grouped = new Map();
    const unresolved = [];
    for (const r of results) {
      const item = assortment.find(a => a.id === r.selectedId);
      const qty = Number(r.qty) || 0;
      if (!item) { unresolved.push(r); continue; }
      const unit = r.unit || item.unit || "шт";
      const key = `${item.id}__${unit}`;
      if (!grouped.has(key)) grouped.set(key, { item, qty: 0, unit });
      grouped.get(key).qty += qty;
    }
    return { grouped, unresolved };
  }, [results, assortment]);

  const orderText = useMemo(() => {
    const lines = [];
    let i = 1;
    for (const [, row] of groupedOrder.grouped) {
      const sum = (row.item.price || 0) * row.qty;
      lines.push(`${i}. ${row.item.name} [${row.item.sku}] — ${row.qty} ${row.unit} × ${formatMoney(row.item.price)} ₽ = ${formatMoney(sum)} ₽`);
      i++;
    }
    for (const r of groupedOrder.unresolved) {
      lines.push(`${i}. НЕ РАСПОЗНАНО: ${r.itemText || r.raw} (исходник: ${r.raw})`);
      i++;
    }
    return lines.join("\n");
  }, [groupedOrder]);

  const visibleResults = useMemo(() => {
    if (resultFilter === "unresolved") return results.filter(r => !r.selectedId);
    if (resultFilter === "low") return results.filter(r => r.confidence < 45);
    return results;
  }, [results, resultFilter]);

  const applyAssortment = (items, sourceLabel) => {
    const mapped = mapColumns(items);
    if (!mapped.length) throw new Error("Не найдено строк ассортимента. Проверьте колонки: sku, name, aliases, unit, price.");
    setAssortment(mapped);
    setLoadState({ status: "ok", message: `Загружено ${mapped.length} позиций (${sourceLabel})` });
  };

  const loadDemo = () => {
    const parsed = parseCsv(DEMO_CSV);
    applyAssortment(parsed.items, "Демо");
  };

  const loadFromGoogle = async () => {
    const url = parseFromSheetUrl(sheetUrl);
    if (!url) { setLoadState({ status: "error", message: "Вставьте ссылку на Google Sheets" }); return; }
    setLoadState({ status: "loading", message: "Загружаю ассортимент из Google Sheets..." });
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      const parsed = parseCsv(text);
      applyAssortment(parsed.items, "Google Sheets");
    } catch (e) {
      setLoadState({ status: "error", message: `Ошибка: ${e.message}. Для фронтенд-версии таблица должна быть опубликована как CSV.` });
    }
  };

  const loadFromFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoadState({ status: "loading", message: `Читаю файл ${file.name}...` });
    try {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      if (ext === "csv") {
        const text = await file.text();
        applyAssortment(parseCsv(text).items, `CSV: ${file.name}`);
      } else if (ext === "xlsx" || ext === "xls") {
        const buf = await file.arrayBuffer();
        applyAssortment(parseSpreadsheetArrayBuffer(buf), `Excel: ${file.name}`);
      } else {
        throw new Error("Поддерживаются только .xlsx, .xls и .csv");
      }
    } catch (err) {
      setLoadState({ status: "error", message: `Ошибка загрузки файла: ${err.message}` });
    } finally {
      e.target.value = "";
    }
  };

  const runParse = () => {
    const reqs = extractRequestsFromDirtyText(dirtyText);
    const prepared = reqs.map((r, idx) => {
      const candidates = matchTop(r.itemText, assortment, 3);
      const best = candidates[0];
      const confidence = best?.confidence || 0;
      return {
        rowId: `${Date.now()}-${idx}`,
        itemText: r.itemText,
        qty: r.qty,
        unit: r.unit,
        raw: r.raw,
        unresolved: r.unresolved,
        candidates,
        selectedId: confidence >= 45 ? (best?.item?.id || "") : "",
        confidence
      };
    });
    setResults(prepared);
    setResultFilter("all");
  };

  const updateResult = (rowId, patch) => setResults(prev => prev.map(r => r.rowId === rowId ? { ...r, ...patch } : r));

  const copyOrder = async () => {
    try {
      await navigator.clipboard.writeText(orderText || "");
      alert("Черновик заказа скопирован в буфер обмена");
    } catch {
      alert("Не удалось скопировать. Выделите текст вручную.");
    }
  };

  const exportOrderXlsx = () => {
    const rows = [];
    let totalSum = 0;
    for (const [, row] of groupedOrder.grouped) {
      const lineSum = (row.item.price || 0) * (Number(row.qty) || 0);
      totalSum += lineSum;
      rows.push({
        SKU: row.item.sku,
        Наименование: row.item.name,
        Количество: row.qty,
        Ед: row.unit,
        Цена: row.item.price,
        Сумма: lineSum
      });
    }
    if (groupedOrder.unresolved.length) {
      groupedOrder.unresolved.forEach((r) => {
        rows.push({
          SKU: "",
          Наименование: `НЕ РАСПОЗНАНО: ${r.itemText || r.raw}`,
          Количество: r.qty,
          Ед: r.unit,
          Цена: "",
          Сумма: ""
        });
      });
    }
    if (!rows.length) { alert("Нет данных для экспорта"); return; }

    rows.push({});
    rows.push({ Наименование: "ИТОГО", Сумма: totalSum });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{wch:14},{wch:60},{wch:12},{wch:8},{wch:12},{wch:14}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Заказ");
    XLSX.writeFile(wb, `order_draft_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const statusClass = loadState.status === "error" ? "status status-error" : loadState.status === "loading" ? "status status-loading" : "status status-ok";

  return (
    <div className="container">
      <div className="card" style={{ marginBottom: 16 }}>
        <h1>Парсер заказа стройматериалов</h1>
        <div className="muted" style={{ marginTop: 6 }}>
          Google Sheets / Excel / CSV → разбор “грязного” текста → подбор номенклатуры → черновик заказа.
        </div>
      </div>

      <div className="grid grid-main">
        <div className="grid">
          <div className="card">
            <h2>1) Ассортимент</h2>
            <div className="muted" style={{ marginTop: 6 }}>Загрузите Google Sheets или локальный Excel/CSV.</div>

            <div style={{ marginTop: 10 }}>
              <input className="input" placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=..." value={sheetUrl} onChange={(e)=>setSheetUrl(e.target.value)} />
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={loadFromGoogle}>Google Sheets</button>
              <button className="btn" onClick={loadDemo}>Демо</button>
            </div>

            <div style={{ marginTop: 10 }}>
              <div className="small" style={{ marginBottom: 4 }}>Загрузка файла</div>
              <input className="file-input" type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={loadFromFile} />
              <div className="muted" style={{ marginTop: 4 }}>Поддержка: .xlsx / .xls / .csv (берется 1-й лист)</div>
            </div>

            <div className={statusClass}>{loadState.message}</div>

            <div style={{ marginTop: 10 }} className="muted">
              Колонки: <b>sku</b>, <b>name</b>, <b>aliases</b>, <b>unit</b>, <b>price</b><br />
              Можно русские: <b>артикул</b>, <b>наименование</b>, <b>синонимы</b>, <b>ед.</b>, <b>цена</b>
            </div>
          </div>

          <div className="card">
            <h2>2) Сообщение клиента</h2>
            <div className="muted" style={{ marginTop: 6 }}>Пример: <code>усб 9 8 листов</code>, <code>минвата 300 6 пачек</code></div>
            <textarea className="textarea" value={dirtyText} onChange={(e)=>setDirtyText(e.target.value)} style={{ marginTop: 10 }} />
            <button className="btn btn-blue" style={{ marginTop: 8, width: "100%" }} onClick={runParse}>Разобрать и собрать черновик заказа</button>
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>3) Итого</h2>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{formatMoney(total)} ₽</div>
            </div>
            <div className="muted" style={{ marginTop: 6 }}>Черновик для менеджера / CRM / 1С</div>
            <div className="toolbar">
              <button className="btn btn-green" onClick={copyOrder}>Скопировать черновик</button>
              <button className="btn btn-amber" onClick={exportOrderXlsx}>Экспорт в Excel</button>
            </div>
            <div className="pre" style={{ marginTop: 8 }}>{orderText || "После разбора здесь появится черновик заказа."}</div>
          </div>
        </div>

        <div className="grid">
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>Ассортимент</h2>
              <span className="badge">{assortment.length} позиций</span>
            </div>

            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table>
                <thead><tr><th>Артикул</th><th>Наименование</th><th>Ед.</th><th className="text-right">Цена</th></tr></thead>
                <tbody>
                  {assortment.slice(0, 80).map(a => (
                    <tr key={a.id}>
                      <td style={{ color:"#64748b", fontSize:12 }}>{a.sku}</td>
                      <td>{a.name}</td>
                      <td>{a.unit}</td>
                      <td className="text-right">{formatMoney(a.price)} ₽</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <h2>Результат разбора</h2>
              <div className="row">
                <button className={`chip ${resultFilter==="all"?"active":""}`} onClick={()=>setResultFilter("all")}>Все ({results.length})</button>
                <button className={`chip ${resultFilter==="low"?"active":""}`} onClick={()=>setResultFilter("low")}>Низкая уверенность ({results.filter(r=>r.confidence<45).length})</button>
                <button className={`chip ${resultFilter==="unresolved"?"active":""}`} onClick={()=>setResultFilter("unresolved")}>Нераспознано ({results.filter(r=>!r.selectedId).length})</button>
              </div>
            </div>

            {!results.length ? (
              <div className="muted" style={{ marginTop: 10 }}>Нажмите «Разобрать...», чтобы увидеть сопоставление позиций.</div>
            ) : !visibleResults.length ? (
              <div className="muted" style={{ marginTop: 10 }}>По выбранному фильтру записей нет.</div>
            ) : (
              <div className="grid" style={{ marginTop: 10 }}>
                {visibleResults.map(r => {
                  const selected = assortment.find(a => a.id === r.selectedId);
                  const lineSum = (selected?.price || 0) * (Number(r.qty) || 0);
                  const barClass = r.confidence >= 70 ? "progress-green" : r.confidence >= 45 ? "progress-amber" : "progress-red";
                  return (
                    <div key={r.rowId} className="result-item">
                      <div className="result-grid">
                        <div>
                          <div className="muted">Исходный фрагмент</div>
                          <div style={{ fontWeight: 600, marginTop: 4 }}>{r.itemText || r.raw}</div>
                          <div className="row small" style={{ marginTop: 8 }}>
                            <span style={{ color: "#64748b" }}>Уверенность</span>
                            <div className="progress"><div className={barClass} style={{ width: `${r.confidence}%` }} /></div>
                            <b>{r.confidence}%</b>
                          </div>
                        </div>

                        <div className="grid" style={{ gridTemplateColumns: "1fr 90px 90px", gap: 8 }}>
                          <div>
                            <div className="muted">Подобранная позиция</div>
                            <select className="select" value={r.selectedId} onChange={(e)=>updateResult(r.rowId,{ selectedId: e.target.value })} style={{ marginTop: 4 }}>
                              <option value="">— Не выбрано —</option>
                              {r.candidates.map(c => <option key={c.item.id} value={c.item.id}>{c.item.name} ({c.confidence}%)</option>)}
                            </select>
                          </div>
                          <div>
                            <div className="muted">Кол-во</div>
                            <input className="input" value={r.qty} onChange={(e)=>updateResult(r.rowId,{ qty: e.target.value })} style={{ marginTop: 4 }} />
                          </div>
                          <div>
                            <div className="muted">Ед.</div>
                            <input className="input" value={r.unit} onChange={(e)=>updateResult(r.rowId,{ unit: e.target.value })} style={{ marginTop: 4 }} />
                          </div>
                        </div>
                      </div>

                      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                        <div className="card" style={{ padding: 10 }}>
                          <div className="muted" style={{ marginBottom: 4 }}>Топ-кандидаты</div>
                          {r.candidates.map(c => (
                            <div key={c.item.id} className="row small" style={{ justifyContent: "space-between", marginBottom: 3 }}>
                              <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.item.name}</span>
                              <span style={{ color:"#64748b" }}>{c.confidence}%</span>
                            </div>
                          ))}
                        </div>
                        <div className="card" style={{ padding: 10 }}>
                          <div className="muted" style={{ marginBottom: 4 }}>Расчет строки</div>
                          <div className="small">Цена: <b>{selected ? `${formatMoney(selected.price)} ₽` : "—"}</b></div>
                          <div className="small" style={{ marginTop: 2 }}>Сумма: <b>{selected ? `${formatMoney(lineSum)} ₽` : "—"}</b></div>
                          <div className="small" style={{ marginTop: 2, color: "#64748b" }}>SKU: {selected?.sku || "—"}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
