import * as XLSX from 'xlsx';

function normalize(s=''){return String(s).toLowerCase().replace(/ё/g,'е').replace(/["'`]/g,' ').replace(/[()\[\]{}]/g,' ').replace(/[\\/]/g,' ').replace(/[,;:+]/g,' ').replace(/\s+/g,' ').trim();}

function parseCsv(text) {
  const rows=[]; let row=[], cell='', inQuotes=false;
  for (let i=0;i<text.length;i++) {
    const ch=text[i], next=text[i+1];
    if (ch==='"') { if (inQuotes && next==='"') { cell+='"'; i++; } else inQuotes=!inQuotes; continue; }
    if (ch===',' && !inQuotes) { row.push(cell); cell=''; continue; }
    if ((ch==='\n' || ch==='\r') && !inQuotes) {
      if (ch==='\r' && next==='\n') i++;
      row.push(cell); cell=''; if (row.some(x=>String(x).trim()!=='')) rows.push(row); row=[]; continue;
    }
    cell+=ch;
  }
  if (cell.length || row.length) { row.push(cell); if (row.some(x=>String(x).trim()!=='')) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h=>normalize(h));
  return rows.slice(1).map(r=>Object.fromEntries(headers.map((h,idx)=>[h,String(r[idx]??'').trim()])));
}

function parseHtmlTable(html) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>m[1]);
  if (!rows.length) return [];
  const parsedRows = rows.map(r => [...r.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => c[1].replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim()));
  const header = (parsedRows.find(r => r.length >= 2) || []).map(normalize);
  const body = parsedRows.filter(r => r.length >= 2).slice(1);
  if (!header.length || !body.length) return [];
  return body.map(r => Object.fromEntries(header.map((h,i)=>[h,String(r[i]??'')])));
}

function parseSheet(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval:'', raw:false });
}

export default async function handler(req, res){
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({ok:false,error:'Method not allowed'});
  try {
    const src = (req.method === 'POST' ? (req.body?.url || req.body?.sourceUrl) : req.query.url) || process.env.PARSER_SOURCE_URL;
    if (!src) return res.status(400).json({ok:false,error:'Set PARSER_SOURCE_URL or pass ?url='});

    const resp = await fetch(src, { headers: { 'user-agent': 'Mozilla/5.0 parser-sync' } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ctype = resp.headers.get('content-type') || '';
    const ab = await resp.arrayBuffer();
    const buf = Buffer.from(ab);

    let rows = [];
    if (ctype.includes('application/json') || src.endsWith('.json')) {
      const j = JSON.parse(buf.toString('utf8'));
      rows = Array.isArray(j) ? j : (Array.isArray(j.items) ? j.items : []);
    } else if (ctype.includes('sheet') || ctype.includes('excel') || /\.(xlsx|xls)(\?|$)/i.test(src)) {
      rows = parseSheet(buf);
    } else {
      const text = buf.toString('utf8');
      rows = ctype.includes('text/html') || /<html|<table/i.test(text) ? parseHtmlTable(text) : parseCsv(text);
      if (!rows.length && text.includes(';')) {
        rows = parseCsv(text.replace(/;/g, ','));
      }
    }

    res.status(200).json({ ok:true, source: src, count: rows.length, items: rows.slice(0, 5000) });
  } catch(e){
    res.status(500).json({ok:false,error:e.message||'sync failed'});
  }
}
