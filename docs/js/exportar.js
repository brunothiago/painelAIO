// Exporta os AIOs filtrados para CSV e Excel (.xlsx montado sem bibliotecas,
// mesma técnica do painelcargaaio).
import { nomePessoa } from './estado.js';
import { carimbo, fmtEtapas } from './util.js';
import { COLUNAS, colLetra } from './campos.js';



function valor(a, k) {
  const v = a[k];
  if (k === 'etapas') return fmtEtapas(v);
  if (k === 'responsavel' || k === 'updated_by') return nomePessoa(v);
  if (k === 'tipo') return v === 'EMISSAO' ? 'Emissão' : v === 'CONVALIDACAO' ? 'Convalidação' : '';
  if (v === true) return 'Sim';
  if (v === false) return 'Não';
  if (['valor_solicitado', 'exec_fisica_pct', 'saldo_conta', 'ref_valor_repasse'].includes(k)) return v == null ? '' : +v;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) { const [y, m, d] = v.slice(0, 10).split('-'); return `${d}/${m}/${y}`; }
  return v ?? '';
}
const linhas = (lista) => lista.map((a) => COLUNAS.map(([k]) => valor(a, k)));

function baixar(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportarCSV(lista) {
  const esc = (v) => {
    const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v);  // vírgula decimal (Excel pt-BR)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const txt = [COLUNAS.map(([, r]) => r), ...linhas(lista)].map((l) => l.map(esc).join(';')).join('\r\n');
  baixar(new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8;' }), `painel_aio_${carimbo()}.csv`);
}

// ---- XLSX (OOXML num ZIP sem compressão) ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(arquivos) {
  const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  const partes = [], central = [];
  let off = 0;
  arquivos.forEach((f) => {
    const crc = crc32(f.dados), n = f.nome.length, len = f.dados.length;
    const lh = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(len), ...u32(len), ...u16(n), ...u16(0)]);
    partes.push(lh, f.nome, f.dados);
    central.push({ nome: f.nome, crc, len, off });
    off += lh.length + n + len;
  });
  let tam = 0;
  const cp = [];
  central.forEach((c) => {
    const ch = new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(c.crc), ...u32(c.len), ...u32(c.len),
      ...u16(c.nome.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(c.off)]);
    cp.push(ch, c.nome); tam += ch.length + c.nome.length;
  });
  const fim = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(tam), ...u32(off), ...u16(0)]);
  return new Blob([...partes, ...cp, fim], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const escXml = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[m]));

export function exportarXLSX(lista) {
  const enc = new TextEncoder();
  const todas = [COLUNAS.map(([, r]) => r), ...linhas(lista)];
  const xmlLinhas = todas.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = colLetra(ci) + (ri + 1);
    if (v === null || v === undefined || v === '') return `<c r="${ref}"/>`;
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const arquivos = [
    ['[Content_Types].xml', `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ['_rels/.rels', `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${X}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="AIOs" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', `${X}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${xmlLinhas}</sheetData></worksheet>`],
  ].map(([nome, xml]) => ({ nome: enc.encode(nome), dados: enc.encode(xml) }));
  baixar(zip(arquivos), `painel_aio_${carimbo()}.xlsx`);
}

