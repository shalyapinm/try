import dict from "../data/slangDictionary.json";

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeBase(text) {
  let t = (text || "").toLowerCase();

  // ё -> е
  const rep = (dict.normalization && dict.normalization.replaceChars) || {};
  for (const [from, to] of Object.entries(rep)) t = t.split(from).join(to);

  // убрать простую пунктуацию
  t = t.replace(/[,:;!?]/g, " ");
  const strip = (dict.normalization && dict.normalization.stripCharsRegex) || "";
  if (strip) t = t.replace(new RegExp(strip, "g"), " ");

  // унификация разделителей и пробелов
  t = t.replace(/[*×]/g, " x ");
  t = t.replace(/\s+/g, " ").trim();

  return t;
}

function removeNoiseWords(text) {
  const noise = new Set(dict.noiseWords || []);
  return text
    .split(" ")
    .filter((w) => w && !noise.has(w))
    .join(" ");
}

function applyAliases(text) {
  const aliases = [...(dict.aliases || [])].sort((a, b) => {
    const p = (b.priority || 0) - (a.priority || 0);
    if (p !== 0) return p;
    return (b.from || "").length - (a.from || "").length;
  });

  let out = ` ${text} `;
  for (const a of aliases) {
    const from = a.from || "";
    const to = a.to || "";
    if (!from) continue;
    const re = new RegExp(`(?<!\\S)${escapeRegExp(from)}(?!\\S)`, "g");
    out = out.replace(re, to);
  }
  return out.replace(/\s+/g, " ").trim();
}

function detectUnit(token) {
  const units = dict.units || {};
  for (const [canonical, forms] of Object.entries(units)) {
    if ((forms || []).includes(token)) return canonical;
  }
  return undefined;
}

function extractQuantityAndUnit(text) {
  // простой паттерн: "8 листов", "10 мешков"
  const m = text.match(/(\d+)\s+([a-zа-я0-9\.\-]+)/i);
  if (!m) return {};
  const qty = Number(m[1]);
  const rawUnit = (m[2] || "").toLowerCase();
  const unit = detectUnit(rawUnit) || undefined;
  return { quantity: Number.isFinite(qty) ? qty : undefined, unit };
}

function splitByItems(text) {
  return text
    .split(/\s+(?:и|плюс)\s+|,/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function detectProduct(text) {
  // берем самый приоритетный alias типа product/brand_model/brand_to_product
  const candidates = (dict.aliases || [])
    .filter((a) => ["product", "brand_model", "brand_to_product"].includes(a.type))
    .filter((a) => a.to && text.includes(a.to))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  if (candidates.length) return candidates[0].to;

  // fallback: просто ключевые слова
  const fallback = ["осб", "гипсокартон", "минвата", "пена", "монтажная", "пескобетон"];
  return fallback.find((p) => text.includes(p));
}

export function parseOrderText(input) {
  const raw = input || "";
  const normalizedText = normalizeBase(raw);
  const noNoise = removeNoiseWords(normalizedText);
  const cleanedText = applyAliases(noNoise);

  const chunks = splitByItems(cleanedText);

  const items = chunks.map((chunk) => {
    const productNormalized = detectProduct(chunk);
    const { quantity, unit } = extractQuantityAndUnit(chunk);

    let confidence = 0.2;
    if (productNormalized) confidence += 0.5;
    if (quantity) confidence += 0.2;
    if (unit) confidence += 0.1;
    confidence = Math.min(confidence, 0.99);

    return {
      productRaw: chunk,
      productNormalized,
      quantity,
      unit,
      confidence
    };
  });

  return { raw, normalizedText, cleanedText, items };
}
