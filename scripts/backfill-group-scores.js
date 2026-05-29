#!/usr/bin/env node
/**
 * Backfill group_min_score / min_score for college-groups files using
 * gaokao.cn schoolprovincescore endpoint.
 *
 * Rules:
 *  - Never overwrite an existing non-null score.
 *  - Match strictly by group code (special_group_id / group_code / group_id) when present;
 *    fall back to sg_name only if both are normalized identical, otherwise skip.
 *  - Skip the whole school if school_id_gaokao_cn cannot be resolved.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'cli/data/college-groups');

const PROVINCE_NAME_TO_ID = {
  '北京': 11, '天津': 12, '河北': 13, '山西': 14, '内蒙古': 15,
  '辽宁': 21, '吉林': 22, '黑龙江': 23,
  '上海': 31, '江苏': 32, '浙江': 33, '安徽': 34, '福建': 35, '江西': 36, '山东': 37,
  '河南': 41, '湖北': 42, '湖南': 43, '广东': 44, '广西': 45, '海南': 46,
  '重庆': 50, '四川': 51, '贵州': 52, '云南': 53, '西藏': 54,
  '陕西': 61, '甘肃': 62, '青海': 63, '宁夏': 64, '新疆': 65,
};
const PROVINCE_SLUG_TO_ID = {
  beijing: 11, tianjin: 12, hebei: 13, shanxi: 14, neimenggu: 15, neimongol: 15, innermongolia: 15,
  liaoning: 21, jilin: 22, heilongjiang: 23,
  shanghai: 31, jiangsu: 32, zhejiang: 33, anhui: 34, fujian: 35, jiangxi: 36, shandong: 37,
  henan: 41, hubei: 42, hunan: 43, guangdong: 44, guangxi: 45, hainan: 46,
  chongqing: 50, sichuan: 51, guizhou: 52, yunnan: 53, xizang: 54, tibet: 54,
  shaanxi: 61, gansu: 62, qinghai: 63, ningxia: 64, xinjiang: 65,
};

// Load school-index for ID lookup fallbacks
const schoolIndex = (() => {
  const buf = fs.readFileSync(path.join(ROOT, 'cli/data/school-index.json.gz'));
  return JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
})();
const byZsCode = {}, byName = {};
for (const r of schoolIndex.rows) {
  if (r.zs_code) byZsCode[String(r.zs_code)] = r.gaokao_cn_id;
  if (r.name) byName[r.name] = r.gaokao_cn_id;
}

function resolveSchoolId(d) {
  // direct fields including _-prefixed variants and meta.*
  const candidates = [
    d.school_id_gaokao_cn, d.gaokao_cn_school_id, d.gaokao_cn_id,
    d._school_id_eolcn, d._school_id_gaokao_cn, d._gaokao_cn_id,
    d.meta?.school_id_gaokao_cn, d.meta?.gaokao_cn_school_id, d.meta?.gaokao_cn_id,
    d.meta?._school_id_eolcn,
  ];
  for (const c of candidates) {
    if (c != null && c !== '' && Number.isFinite(Number(c))) return Number(c);
  }
  // zs_code (e.g. "10024" or 1024)
  const zsCandidates = [
    d.zs_code, d.meta?.zs_code, d.meta?.zs_code_guobiao,
    d._code_enroll_guobiao, d.meta?._code_enroll_guobiao,
  ];
  for (const zs of zsCandidates) {
    if (zs == null) continue;
    const zk = String(zs);
    if (byZsCode[zk]) return Number(byZsCode[zk]);
    if (zk.length === 4 && byZsCode['1' + zk]) return Number(byZsCode['1' + zk]);
  }
  // code-like 4-digit identifiers -> try "1XXXX"
  const codeCandidates = [
    d.code, d.meta?.code, d._code_enroll, d.meta?._code_enroll,
  ];
  for (const code of codeCandidates) {
    if (code == null) continue;
    const ck = String(code);
    if (byZsCode[ck]) return Number(byZsCode[ck]);
    if (ck.length === 4 && byZsCode['1' + ck]) return Number(byZsCode['1' + ck]);
  }
  // name
  const uni = d.uni ?? d.meta?.uni ?? d._university ?? d.university ?? d.meta?._university ?? d.meta?.university;
  if (uni && byName[uni]) return Number(byName[uni]);
  return null;
}

function getProvinceList(d) {
  // Returns Array<{province_id:number, province?:string, groups:array, _parent:object, _parentKey:any}>
  // _parent and _parentKey kept for back-writing (not used since we mutate in place via reference)
  const out = [];
  if (Array.isArray(d.provinces)) {
    for (const p of d.provinces) {
      let pid = p.province_id ?? p.provinceId;
      if (!pid && p.province) pid = PROVINCE_NAME_TO_ID[p.province];
      if (!pid && p.slug) pid = PROVINCE_SLUG_TO_ID[String(p.slug).toLowerCase()];
      if (!pid && p.province_name) pid = PROVINCE_NAME_TO_ID[p.province_name];
      if (pid) out.push({ province_id: Number(pid), groupsRef: p.groups, container: p });
    }
  } else if (d.provinces && typeof d.provinces === 'object') {
    for (const [k, p] of Object.entries(d.provinces)) {
      let pid = null;
      if (/^\d+$/.test(k)) pid = Number(k);
      else if (PROVINCE_NAME_TO_ID[k]) pid = PROVINCE_NAME_TO_ID[k];
      else if (PROVINCE_SLUG_TO_ID[k.toLowerCase()]) pid = PROVINCE_SLUG_TO_ID[k.toLowerCase()];
      else if (p && (p.province_id || p.provinceId)) pid = Number(p.province_id ?? p.provinceId);
      else if (p && p.province && PROVINCE_NAME_TO_ID[p.province]) pid = PROVINCE_NAME_TO_ID[p.province];
      else if (p && p.province_name && PROVINCE_NAME_TO_ID[p.province_name]) pid = PROVINCE_NAME_TO_ID[p.province_name];
      if (pid) out.push({ province_id: Number(pid), groupsRef: p.groups, container: p });
    }
  }
  return out;
}

function normalizeCode(s) {
  if (s == null) return null;
  let v = String(s).trim();
  // strip parens, leading zeros, prefixes like "第" "组"
  v = v.replace(/^第/, '').replace(/组$/, '');
  v = v.replace(/[（）()]/g, '').trim();
  v = v.replace(/^0+/, '') || '0';
  return v;
}

function getGroupKey(g) {
  // Try in order: special_group_id, group_id, group_code, group, sg_name
  return g.special_group_id ?? g.group_id ?? g.special_group ?? g.group_code ?? g.group ?? null;
}

function getGroupScore(g) {
  if (typeof g.group_min_score === 'number') return g.group_min_score;
  if (typeof g.min_score === 'number') return g.min_score;
  if (typeof g.min === 'number') return g.min;
  return null;
}

function setGroupScore(g, score, rank) {
  // Pick the field already used in this object (preserve existing schema)
  const fields = ['group_min_score', 'min_score', 'min'];
  let scoreField = null;
  for (const f of fields) if (f in g) { scoreField = f; break; }
  if (!scoreField) scoreField = 'min_score';
  g[scoreField] = score;

  if (rank != null) {
    const rfields = ['group_min_rank', 'min_rank', 'min_section'];
    let rankField = null;
    for (const f of rfields) if (f in g) { rankField = f; break; }
    if (!rankField) rankField = 'min_rank';
    g[rankField] = rank;
  }
}

async function fetchJson(url) {
  // Use curl
  try {
    const out = execFileSync('curl', [
      '-s', '--max-time', '20',
      '-H', 'Referer: https://www.gaokao.cn/',
      '-H', 'User-Agent: Mozilla/5.0',
      url
    ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (!out || !out.trim()) return { error: 'empty' };
    if (out.startsWith('<')) return { error: 'html' };
    try { return JSON.parse(out); } catch (e) { return { error: 'parse', body: out.slice(0, 200) }; }
  } catch (e) {
    return { error: 'curl', msg: String(e.message).slice(0, 200) };
  }
}

// Extract items list from schoolprovincescore response (data.{type}.item[])
function extractItems(resp) {
  if (!resp || !resp.data) return [];
  const items = [];
  if (Array.isArray(resp.data)) {
    for (const sub of resp.data) {
      if (sub && Array.isArray(sub.item)) items.push(...sub.item);
    }
  } else if (typeof resp.data === 'object') {
    for (const [, sub] of Object.entries(resp.data)) {
      if (sub && Array.isArray(sub.item)) items.push(...sub.item);
    }
  }
  return items;
}

function buildLookups(items) {
  const byCode = new Map();
  const bySgName = new Map();
  for (const it of items) {
    const min = it.min;
    if (!min || min === '-' || min === '' || min == null) continue;
    const score = Number(min);
    if (!Number.isFinite(score) || score < 100 || score > 800) continue;
    const rankRaw = it.min_section;
    const rank = (rankRaw && rankRaw !== '-' && rankRaw !== '') ? Number(rankRaw) : null;
    const rec = { score, rank: Number.isFinite(rank) ? rank : null, raw: it };
    const code = it.special_group;
    if (code) {
      const k = normalizeCode(code);
      if (!byCode.has(k)) byCode.set(k, []);
      byCode.get(k).push(rec);
    }
    if (it.sg_name) {
      const k = normalizeCode(it.sg_name);
      if (!bySgName.has(k)) bySgName.set(k, []);
      bySgName.get(k).push(rec);
    }
  }
  return { byCode, bySgName };
}

async function processFile(file) {
  const fp = path.join(DATA_DIR, file);
  const text = fs.readFileSync(fp, 'utf8');
  const data = JSON.parse(text);

  const schoolId = resolveSchoolId(data);
  if (!schoolId) {
    return { file, skipped: 'no_school_id', filled: 0, attempted: 0 };
  }

  const provinces = getProvinceList(data);
  if (!provinces.length) return { file, skipped: 'no_provinces', filled: 0, attempted: 0 };

  let filled = 0, attempted = 0, requests = 0;
  const failedProvs = [];

  for (const prov of provinces) {
    if (!Array.isArray(prov.groupsRef) || !prov.groupsRef.length) continue;
    // Skip if all groups already have scores
    const nullGroups = prov.groupsRef.filter(g => getGroupScore(g) == null);
    if (!nullGroups.length) continue;
    attempted += nullGroups.length;

    const url = `https://static-data.gaokao.cn/www/2.0/schoolprovincescore/${schoolId}/2025/${prov.province_id}.json`;
    const resp = await fetchJson(url);
    requests++;
    if (resp.error || resp.code !== '0000') {
      failedProvs.push(`${prov.province_id}:${resp.error || resp.code}`);
      continue;
    }
    const items = extractItems(resp);
    if (!items.length) {
      failedProvs.push(`${prov.province_id}:empty`);
      continue;
    }
    const { byCode, bySgName } = buildLookups(items);

    for (const g of nullGroups) {
      const rawKey = getGroupKey(g);
      let recs = null;
      if (rawKey != null) {
        const k = normalizeCode(rawKey);
        if (byCode.has(k)) recs = byCode.get(k);
        else if (bySgName.has(k)) recs = bySgName.get(k);
      }
      if (!recs && g.sg_name) {
        const k = normalizeCode(g.sg_name);
        if (bySgName.has(k)) recs = bySgName.get(k);
      }
      if (!recs || recs.length !== 1) continue; // ambiguous = skip
      const rec = recs[0];
      setGroupScore(g, rec.score, rec.rank);
      filled++;
    }
  }

  if (filled > 0) {
    // Preserve indentation style: detect 2-space or 4-space
    const indentMatch = text.match(/\n( +)"/);
    const indent = indentMatch ? indentMatch[1].length : 2;
    const endsWithNewline = text.endsWith('\n');
    fs.writeFileSync(fp, JSON.stringify(data, null, indent) + (endsWithNewline ? '\n' : ''));
  }

  return { file, schoolId, filled, attempted, requests, failedProvs };
}

(async () => {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).sort();
  const args = process.argv.slice(2);
  let startIdx = 0, endIdx = files.length;
  if (args[0] === '--range' && args[1]) {
    const [s, e] = args[1].split(':').map(Number);
    startIdx = s; endIdx = e;
  } else if (args[0] === '--file' && args[1]) {
    const idx = files.indexOf(args[1]);
    if (idx >= 0) { startIdx = idx; endIdx = idx + 1; }
  }

  let totalFilled = 0, totalReqs = 0, schoolsTouched = 0, skippedNoId = 0;
  const failures = {};
  for (let i = startIdx; i < endIdx; i++) {
    const f = files[i];
    try {
      const r = await processFile(f);
      if (r.skipped === 'no_school_id') skippedNoId++;
      if (r.filled > 0) schoolsTouched++;
      totalFilled += r.filled || 0;
      totalReqs += r.requests || 0;
      if (r.failedProvs && r.failedProvs.length) {
        for (const fp of r.failedProvs) {
          failures[fp] = (failures[fp] || 0) + 1;
        }
      }
      console.log(`[${i + 1}/${endIdx}] ${f}: schoolId=${r.schoolId || 'NONE'} filled=${r.filled || 0}/${r.attempted || 0} reqs=${r.requests || 0}${r.skipped ? ' SKIP=' + r.skipped : ''}${r.failedProvs && r.failedProvs.length ? ' fails=' + r.failedProvs.join(',') : ''}`);
    } catch (e) {
      console.error(`[${i + 1}] ${f} ERROR: ${e.message}`);
    }
  }

  console.log('---');
  console.log(`Schools touched: ${schoolsTouched}, no_school_id: ${skippedNoId}`);
  console.log(`Total filled: ${totalFilled}, total requests: ${totalReqs}`);
  console.log(`Failure breakdown:`, failures);
})();
