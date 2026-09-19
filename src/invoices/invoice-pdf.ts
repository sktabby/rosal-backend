import * as path from 'path';
import PDFDocument from 'pdfkit';

/**
 * Tax-invoice PDF in the approved Rosal template layout (same design as the
 * mobile app's PI PDF, titled TAX INVOICE). Pure layout: every figure comes
 * from the frozen Invoice record, so a re-download always matches what was issued.
 */

export interface InvoicePdfLine {
  description: string;
  hsnCode: string;
  brand?: string;
  qty: number;
  unit: string;
  rate: number;
  discountPercent: number;
  taxPercent: number;
  amount: number; // after discount, before tax
}

export interface InvoicePdfData {
  invoiceNumber: string;
  invoiceDate: Date;
  gstType: 'CGST_SGST' | 'IGST';
  taxableValue: number;
  grandTotal: number;
  amountInWords: string;
  lines: InvoicePdfLine[];
  company: {
    name: string;
    gstin?: string | null;
    factoryAddress?: string | null;
    officeAddress?: string | null;
    udyamNumber?: string | null;
    panNumber?: string | null;
    bankName?: string | null;
    bankAccountNo?: string | null;
    bankIFSC?: string | null;
    bankBranch?: string | null;
    authorisedSignatory?: string | null;
    declaration?: string | null;
  };
  buyer: Party;
  consignee: Party;
  salesPerson?: { name: string; phone?: string | null; email?: string | null } | null;
  modeOfPayment?: string | null;
  piNumber?: string | null;
  orderNumber?: string | null;
  dispatchDocNo?: string | null;
  eWayBillNo?: string | null;
  transporterName?: string | null;
  termsOfDelivery?: string | null;
  remarks?: string | null;
}

interface Party {
  name: string;
  address: string;
  gstin?: string | null;
  state?: string | null;
  contact?: string | null;
}

// ---- Geometry (PDF points) & palette, matching the template ----
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 24;
const W = PAGE_W - 2 * M;
const CONTENT_BOTTOM = PAGE_H - 36;
const ROW = 18;

const RED = '#D42027';
const INK = '#141414';
const MUTED = '#555555';
const RULE = '#BFBFBF';
const LABEL_FILL = '#F2F2F2';
const HEADER_GRAY = '#DEDEDE';
const AMBER = '#FFC000';
const BLUE_FILL = '#DDEBF7';
const BLUE_BAR = '#BDD7EE';
const VALUE_ORANGE = '#C55A11';
const GREEN = '#1E7B34';
const PINK = '#FCE4E4';

const ASSETS = path.join(process.cwd(), 'assets');
const FONT_REGULAR = path.join(ASSETS, 'fonts', 'Roboto-Regular.ttf');
const FONT_BOLD = path.join(ASSETS, 'fonts', 'Roboto-Bold.ttf');
const LOGO = path.join(ASSETS, 'rosal-lockup.png');

type Align = 'left' | 'center' | 'right';
interface Col { title: string; width: number; align: Align; amber?: boolean }

// Sums to W (547.28pt).
const ITEM_COLS: Col[] = [
  { title: 'Sl.\nNo.', width: 26, align: 'center' },
  { title: 'Description of Goods', width: 150.28, align: 'left', amber: true },
  { title: 'HSN/SAC', width: 52, align: 'center' },
  { title: 'Brand', width: 40, align: 'center' },
  { title: 'Quantity', width: 50, align: 'center' },
  { title: 'Rate', width: 50, align: 'right' },
  { title: 'Disc.\n%', width: 30, align: 'center' },
  { title: 'Tax', width: 30, align: 'center' },
  { title: 'Tax\nAmount', width: 52, align: 'right' },
  { title: 'Amount', width: 67, align: 'right', amber: true },
];

const GST_STATES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};

/** State name + code from a GSTIN's first two digits, e.g. 27 -> Maharashtra. */
export function stateFromGstin(gstin?: string | null): { name: string; code: string } | null {
  const code = (gstin ?? '').slice(0, 2);
  const name = GST_STATES[code];
  return name ? { name, code: String(Number(code)) } : null;
}

const money = (v: number) =>
  v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trimNum = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2))));
const round2 = (v: number) => Math.round(v * 100) / 100;

function formatDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Invoice dates are shown in India time regardless of the server's zone.
  const ist = new Date(d.getTime() + 330 * 60_000);
  return `${String(ist.getUTCDate()).padStart(2, '0')}-${months[ist.getUTCMonth()]}-${String(ist.getUTCFullYear()).slice(2)}`;
}

export function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: `Tax Invoice ${data.invoiceNumber}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      new Renderer(doc, data).render();
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

class Renderer {
  private y = M;
  private page = 0;

  constructor(private doc: PDFKit.PDFDocument, private d: InvoicePdfData) {
    doc.registerFont('R', FONT_REGULAR);
    doc.registerFont('B', FONT_BOLD);
  }

  render() {
    this.newPage();
    this.header();
    this.parties();
    this.details();
    this.items();
    this.bottom();
  }

  // ------------------------------------------------------------ primitives

  private newPage() {
    this.doc.addPage({ size: 'A4', margin: 0 });
    this.page++;
    this.y = M;
    this.text('This is a computer-generated invoice.', M, PAGE_H - 22, { size: 7, color: MUTED });
    this.text(`${this.d.invoiceNumber}  ·  Page ${this.page}`, M, PAGE_H - 22, { size: 7, color: MUTED, width: W, align: 'right' });
  }

  private ensureSpace(h: number, onNewPage?: () => void) {
    if (this.y + h > CONTENT_BOTTOM) {
      this.newPage();
      onNewPage?.();
    }
  }

  private fill(x: number, y: number, w: number, h: number, color: string) {
    this.doc.save().rect(x, y, w, h).fill(color).restore();
  }

  private box(x: number, y: number, w: number, h: number, color = RULE) {
    this.doc.save().lineWidth(0.6).strokeColor(color).rect(x, y, w, h).stroke().restore();
  }

  /** Single line of text; truncated with an ellipsis when [width] is given and it doesn't fit. */
  private text(
    s: string,
    x: number,
    y: number,
    o: { size?: number; bold?: boolean; color?: string; width?: number; align?: Align } = {},
  ) {
    const size = o.size ?? 8;
    this.doc.font(o.bold ? 'B' : 'R').fontSize(size).fillColor(o.color ?? INK);
    const str = o.width ? this.fit(s, o.width) : s;
    this.doc.text(str, x, y, { width: o.width, align: o.align ?? 'left', lineBreak: false });
  }

  private fit(s: string, width: number): string {
    if (this.doc.widthOfString(s) <= width) return s;
    let t = s;
    while (t.length > 0 && this.doc.widthOfString(t + '…') > width) t = t.slice(0, -1);
    return t + '…';
  }

  private wrap(s: string, width: number, size: number, bold = false): string[] {
    this.doc.font(bold ? 'B' : 'R').fontSize(size);
    const lines: string[] = [];
    for (const para of (s ?? '').split('\n')) {
      let cur = '';
      for (const word of para.split(' ').filter(Boolean)) {
        const cand = cur ? `${cur} ${word}` : word;
        if (this.doc.widthOfString(cand) <= width) cur = cand;
        else {
          if (cur) lines.push(cur);
          cur = this.fit(word, width);
        }
      }
      if (cur) lines.push(cur);
    }
    return lines;
  }

  // ------------------------------------------------------------ header

  private header() {
    const c = this.d.company;
    const logoW = 118;
    const midW = 264;
    const rightW = W - logoW - midW;
    const midX = M + logoW;
    const rightX = midX + midW;
    const inner = midW - 14;

    type L = { prefix?: string; text: string; bold?: boolean };
    const lines: L[] = [];
    const addPrefixed = (prefix: string, value?: string | null) => {
      if (!value) return;
      this.wrap(`${prefix} ${value}`, inner, 7.6).forEach((t, i) => lines.push({ prefix: i === 0 ? prefix : undefined, text: t }));
    };
    addPrefixed('FACTORY:', c.factoryAddress);
    addPrefixed('OFFICE:', c.officeAddress);
    if (c.udyamNumber) lines.push({ text: `UDYAM: ${c.udyamNumber}`, bold: true });
    if (c.gstin) lines.push({ text: `GSTIN/UIN: ${c.gstin}`, bold: true });
    const st = stateFromGstin(c.gstin);
    if (st) lines.push({ text: `STATE : ${st.name}, Code : ${st.code}`, bold: true });

    const lineH = 10.2;
    const contentH = 18 + lines.length * lineH;
    const h = Math.max(106, contentH + 12);
    const top = this.y;

    // Left: red block with the logo lockup.
    this.fill(M, top, logoW, h, RED);
    try {
      this.doc.image(LOGO, M + 7, top + 7, { fit: [logoW - 14, h - 14], align: 'center', valign: 'center' });
    } catch {
      /* logo is decorative — never fail the invoice over it */
    }

    // Middle: letterhead.
    this.fill(midX, top, midW, h, HEADER_GRAY);
    let ly = top + (h - contentH) / 2;
    this.text((c.name || 'Rosal Safety Private Limited').toUpperCase(), midX, ly, { size: 12.5, bold: true, color: RED, width: midW, align: 'center' });
    ly += 18;
    for (const l of lines) {
      this.doc.font(l.bold ? 'B' : 'R').fontSize(7.6);
      if (l.prefix && l.text.startsWith(l.prefix)) {
        const rest = l.text.slice(l.prefix.length);
        this.doc.font('B');
        const pw = this.doc.widthOfString(l.prefix);
        this.doc.font('R');
        const total = pw + this.doc.widthOfString(rest);
        const sx = midX + (midW - total) / 2;
        this.text(l.prefix, sx, ly, { size: 7.6, bold: true, color: RED });
        this.text(rest, sx + pw, ly, { size: 7.6 });
      } else {
        this.text(l.text, midX, ly, { size: 7.6, bold: l.bold, width: midW, align: 'center' });
      }
      ly += lineH;
    }

    // Right: title, number, sales person.
    this.fill(rightX, top, rightW, h, AMBER);
    this.text('TAX INVOICE', rightX, top + 10, { size: 14, bold: true, width: rightW, align: 'center' });
    this.text(this.d.invoiceNumber, rightX, top + 29, { size: 8.5, bold: true, color: RED, width: rightW, align: 'center' });
    this.text('SALES PERSON', rightX, top + 42, { size: 7.2, bold: true, width: rightW, align: 'center' });
    const tx = rightX + 8;
    const tw = rightW - 16;
    const labelW = 42;
    let ty = top + 54;
    const sp = this.d.salesPerson;
    for (const [label, value] of [['Name', sp?.name], ['Contact', sp?.phone], ['Email', sp?.email]] as const) {
      this.fill(tx, ty, tw, 13.5, BLUE_FILL);
      this.box(tx, ty, labelW, 13.5, INK);
      this.box(tx + labelW, ty, tw - labelW, 13.5, INK);
      this.text(label, tx + 4, ty + 3.3, { size: 7, bold: true });
      this.text(value ?? '', tx + labelW + 4, ty + 3.3, { size: 7, bold: true, width: tw - labelW - 7 });
      ty += 13.5;
    }

    this.y = top + h + 10;
  }

  // ------------------------------------------------------------ parties

  private parties() {
    const gap = 10;
    const boxW = (W - gap) / 2;
    const labelW = 62;
    const valueW = boxW - labelW - 10;
    const buyerAddr = this.wrap(this.d.buyer.address, valueW, 8).slice(0, 3);
    const shipAddr = this.wrap(this.d.consignee.address, valueW, 8).slice(0, 3);
    const addrH = Math.max(24, Math.max(buyerAddr.length, shipAddr.length) * 10 + 10);
    const total = 20 + ROW + addrH + ROW * 3;
    this.ensureSpace(total);
    this.partyBox(M, boxW, labelW, 'BUYER (BILL TO)', this.d.buyer, buyerAddr, addrH);
    this.partyBox(M + boxW + gap, boxW, labelW, 'CONSIGNEE (SHIP TO)', this.d.consignee, shipAddr, addrH);
    this.y += total + 10;
  }

  private partyBox(x: number, w: number, labelW: number, title: string, p: Party, address: string[], addrH: number) {
    let by = this.y;
    this.fill(x, by, w, 20, AMBER);
    this.box(x, by, w, 20);
    this.text(title, x + 8, by + 6, { size: 8.5, bold: true });
    by += 20;

    const state = p.state ? { name: p.state, code: stateFromGstin(p.gstin)?.code ?? '' } : stateFromGstin(p.gstin);
    const row = (label: string, h: number, draw: (vx: number, vy: number, vw: number) => void) => {
      this.fill(x, by, labelW, h, LABEL_FILL);
      this.box(x, by, labelW, h);
      this.box(x + labelW, by, w - labelW, h);
      this.text(label, x + 6, by + h / 2 - 4.2, { size: 7.2, bold: true });
      draw(x + labelW, by, w - labelW);
      by += h;
    };
    row('Name :', ROW, (vx, vy, vw) => this.text(p.name, vx + 6, vy + 4.5, { size: 8.2, bold: true, color: RED, width: vw - 10 }));
    row('Address :', addrH, (vx, vy) => {
      const start = vy + (addrH - address.length * 10) / 2;
      address.forEach((l, i) => this.text(l, vx + 6, start + i * 10, { size: 8 }));
    });
    row('GSTIN/UIN :', ROW, (vx, vy) => this.text(p.gstin ?? '', vx + 6, vy + 4.5, { size: 8 }));
    row('State Name :', ROW, (vx, vy, vw) => {
      const codeLabelW = 32;
      const codeW = 28;
      const clx = vx + vw - codeLabelW - codeW;
      this.text(state?.name ?? '', vx + 6, vy + 4.5, { size: 8, width: clx - vx - 10 });
      this.fill(clx, vy, codeLabelW, ROW, LABEL_FILL);
      this.box(clx, vy, codeLabelW, ROW);
      this.text('Code', clx + 5, vy + 4.8, { size: 7.2, bold: true });
      this.text(state?.code ?? '', clx + codeLabelW + 6, vy + 4.5, { size: 8 });
    });
    row('Contact :', ROW, (vx, vy, vw) => this.text(p.contact ?? '', vx + 6, vy + 4.5, { size: 8, width: vw - 10 }));
  }

  // ------------------------------------------------------------ details grid

  private details() {
    const barH = 16;
    const rowH = 27;
    const termsH = 22;
    this.ensureSpace(barH + rowH * 3 + termsH);
    this.fill(M, this.y, W, barH, BLUE_BAR);
    this.box(M, this.y, W, barH);
    this.text('I N V O I C E   D E T A I L S', M + 8, this.y + 4.5, { size: 7, bold: true });
    this.y += barH;

    const parts = (this.d.consignee.address ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const destination = parts.slice(-2).join(', ');
    const grid: [string, string][][] = [
      [['Invoice No', this.d.invoiceNumber], ['Dated', formatDate(this.d.invoiceDate)], ['Delivery Note', ''], ['Mode/Terms of Payment', (this.d.modeOfPayment ?? '').toUpperCase()]],
      [['Reference No. & Date', this.d.piNumber ? `PI ${this.d.piNumber}` : ''], ['Other References', this.d.orderNumber ? `Order No ${this.d.orderNumber}` : ''], ["Buyer's Order No.", ''], ['e-Way Bill No.', this.d.eWayBillNo ?? '']],
      [['Dispatch Doc No.', this.d.dispatchDocNo ?? ''], ['Delivery Note Date', ''], ['Dispatched through', this.d.transporterName ?? ''], ['Destination', destination]],
    ];
    const colW = W / 4;
    for (const r of grid) {
      r.forEach(([label, value], i) => {
        const x = M + i * colW;
        this.box(x, this.y, colW, rowH);
        this.text(label, x + 6, this.y + 4, { size: 7.6, bold: true });
        if (value) this.text(value, x + 6, this.y + 14.5, { size: 7.8, bold: true, color: VALUE_ORANGE, width: colW - 12 });
      });
      this.y += rowH;
    }
    this.box(M, this.y, W, termsH);
    this.text('Terms of Delivery', M + 6, this.y + 7, { size: 7.6, bold: true });
    if (this.d.termsOfDelivery) {
      this.doc.font('B').fontSize(7.6);
      const lw = this.doc.widthOfString('Terms of Delivery');
      this.text(this.d.termsOfDelivery, M + 18 + lw, this.y + 7, { size: 7.8, bold: true, color: VALUE_ORANGE });
    }
    this.y += termsH + 10;
  }

  // ------------------------------------------------------------ items & totals

  private tableHeader() {
    const h = 26;
    let x = M;
    for (const col of ITEM_COLS) {
      this.fill(x, this.y, col.width, h, col.amber ? AMBER : HEADER_GRAY);
      this.box(x, this.y, col.width, h);
      const lines = col.title.split('\n');
      const top = this.y + (h - lines.length * 8.5) / 2;
      lines.forEach((l, i) => this.text(l, x, top + i * 8.5, { size: 7.4, bold: true, width: col.width, align: 'center' }));
      x += col.width;
    }
    this.y += h;
  }

  private row(h: number, bg: string, draw: (i: number, x: number, w: number) => void) {
    this.fill(M, this.y, W, h, bg);
    let x = M;
    ITEM_COLS.forEach((col, i) => {
      this.box(x, this.y, col.width, h);
      draw(i, x, col.width);
      x += col.width;
    });
    this.y += h;
  }

  private cell(value: string, x: number, w: number, h: number, align: Align, o: { bold?: boolean; size?: number; color?: string } = {}) {
    if (!value) return;
    this.text(value, x + 4, this.y + h / 2 - (o.size ?? 7.8) / 2 - 0.6, { size: o.size ?? 7.8, bold: o.bold, color: o.color, width: w - 8, align });
  }

  private items() {
    this.tableHeader();
    let n = 0;
    const bgFor = () => (n % 2 === 1 ? LABEL_FILL : '#FFFFFF');
    const taxByRate = new Map<number, number>();
    let totalQty = 0;
    const units = new Set<string>();

    this.d.lines.forEach((li, idx) => {
      const tax = (li.amount * li.taxPercent) / 100;
      taxByRate.set(li.taxPercent, (taxByRate.get(li.taxPercent) ?? 0) + li.amount);
      totalQty += li.qty;
      units.add(li.unit);
      const desc = this.wrap(li.description, ITEM_COLS[1].width - 8, 7.8, true).slice(0, 3);
      const h = Math.max(22, desc.length * 9.5 + 9);
      this.ensureSpace(h, () => this.tableHeader());
      const cells = [
        String(idx + 1), '', li.hsnCode, li.brand ?? '', `${li.qty.toFixed(2)} ${li.unit}`, money(li.rate),
        li.discountPercent > 0 ? trimNum(li.discountPercent) : '', `${trimNum(li.taxPercent)}%`, money(tax), money(li.amount),
      ];
      this.row(h, bgFor(), (i, x, w) => {
        if (i === 1) {
          const top = this.y + (h - desc.length * 9.5) / 2;
          desc.forEach((l, k) => this.text(l, x + 4, top + k * 9.5, { size: 7.8, bold: true }));
        } else {
          this.cell(cells[i], x, w, h, ITEM_COLS[i].align, { color: i === 0 ? MUTED : INK });
        }
      });
      n++;
    });

    // Tax lines follow the GST type Accounts chose on the invoice.
    const taxLines: [string, number][] = [];
    for (const [rate, base] of [...taxByRate.entries()].sort((a, b) => a[0] - b[0])) {
      if (rate <= 0) continue;
      if (this.d.gstType === 'CGST_SGST') {
        const half = round2((base * rate) / 200);
        taxLines.push([`CGST @${trimNum(rate / 2)}%`, half], [`SGST @${trimNum(rate / 2)}%`, half]);
      } else {
        taxLines.push([`IGST @${trimNum(rate)}%`, round2((base * rate) / 100)]);
      }
    }
    const taxable = round2(this.d.taxableValue);
    // Round-off is whatever reconciles the printed rows to the issued grand total.
    const roundOff = round2(this.d.grandTotal - taxable - taxLines.reduce((s, [, v]) => s + v, 0));
    if (Math.abs(roundOff) >= 0.01) taxLines.push(['Round Off', roundOff]);

    const summaryRows = 1 + taxLines.length;
    const fillers = Math.max(0, 7 - n - summaryRows);
    this.ensureSpace(ROW * (summaryRows + fillers) + 24 + 30, () => this.tableHeader());

    this.row(ROW, bgFor(), (i, x, w) => {
      if (i === 1) this.text('Taxable Value', x + 4, this.y + 5, { size: 8, bold: true });
      if (i === 9) this.cell(money(taxable), x, w, ROW, 'right', { bold: true, size: 8 });
    });
    n++;
    for (const [label, amount] of taxLines) {
      this.row(ROW, bgFor(), (i, x, w) => {
        if (i === 1) this.text(label, x + 4, this.y + 5, { size: 8.2, bold: true });
        if (i === 9) this.cell(money(amount), x, w, ROW, 'right', { size: 8 });
      });
      n++;
    }
    for (let k = 0; k < fillers; k++) {
      this.row(ROW, bgFor(), () => undefined);
      n++;
    }

    const qtyText = `${totalQty.toFixed(2)}${units.size === 1 ? ` ${[...units][0]}` : ''}`;
    this.row(24, PINK, (i, x, w) => {
      if (i === 1) this.text('Grand Total', x + 4, this.y + 6.5, { size: 9.5, bold: true, color: RED });
      if (i === 4) this.cell(qtyText, x, w, 24, 'center');
      if (i === 9) this.cell(`₹ ${money(this.d.grandTotal)}`, x, w, 24, 'right', { bold: true, size: 9 });
    });

    // Amount in words.
    const labelW = 150;
    const eoeW = 70;
    const words = this.wrap(this.d.amountInWords, W - labelW - eoeW - 12, 8.4, true).slice(0, 2);
    const wh = Math.max(26, words.length * 11 + 10);
    this.y += 4;
    this.fill(M, this.y, labelW, wh, LABEL_FILL);
    this.fill(M + W - eoeW, this.y, eoeW, wh, LABEL_FILL);
    this.box(M, this.y, W, wh);
    this.box(M, this.y, labelW, wh);
    this.box(M + W - eoeW, this.y, eoeW, wh);
    this.text('Amount Chargeable (in words) :', M + 6, this.y + wh / 2 - 4, { size: 7.4, bold: true });
    const wy = this.y + (wh - words.length * 11) / 2;
    words.forEach((l, i) => this.text(l, M + labelW + 6, wy + i * 11, { size: 8.4, bold: true }));
    this.text('E. & O.E', M + W - eoeW, this.y + wh / 2 - 4, { size: 7.6, bold: true, width: eoeW, align: 'center' });
    this.y += wh + 12;
  }

  // ------------------------------------------------------------ bottom

  private bottom() {
    const c = this.d.company;
    const leftW = 300;
    const gap = 10;
    const rightX = M + leftW + gap;
    const rightW = W - leftW - gap;

    const bullets = (c.declaration ?? '').split('\n').map((s) => s.trim()).filter(Boolean).map((b) => this.wrap(b, leftW - 26, 7));
    const declH = bullets.length ? 22 + bullets.reduce((s, b) => s + b.length, 0) * 9 + bullets.length * 2 + 6 : 0;
    const leftH = 48 + declH;

    const bankRows: [string, string[]][] = [
      ['Bank Name', this.wrap(c.bankName ?? '', rightW - 84, 7.6).slice(0, 3)],
      ['A/c No.', this.wrap(c.bankAccountNo ?? '', rightW - 84, 7.6).slice(0, 2)],
      ['Branch &\nIFSC Code', this.wrap([c.bankBranch, c.bankIFSC].filter(Boolean).join(' & '), rightW - 84, 7.6).slice(0, 3)],
    ];
    const bankH = bankRows.map(([label, lines]) => Math.max(20, Math.max(lines.length, label.split('\n').length) * 9.5 + 8));
    const signH = 46;
    const rightH = 18 + bankH.reduce((a, b) => a + b, 0) + 22 + signH;
    this.ensureSpace(Math.max(leftH, rightH));
    const top = this.y;

    // Left: remarks, PAN, declaration.
    let ly = top;
    const leftRow = (label: string, value: string) => {
      this.fill(M, ly, 80, 24, LABEL_FILL);
      this.box(M, ly, 80, 24);
      this.box(M + 80, ly, leftW - 80, 24);
      this.text(label, M + 6, ly + 8, { size: 7.6, bold: true });
      this.text(value, M + 86, ly + 7.5, { size: 8.2, width: leftW - 92 });
      ly += 24;
    };
    leftRow('Remarks :', this.d.remarks || (this.d.salesPerson?.name ?? '').toUpperCase());
    leftRow("Company's PAN :", c.panNumber ?? '');
    if (bullets.length) {
      this.fill(M, ly, leftW, declH, LABEL_FILL);
      this.box(M, ly, leftW, declH);
      this.text('Declaration', M + 8, ly + 6, { size: 9.5, bold: true, color: GREEN });
      let by = ly + 22;
      for (const lines of bullets) {
        this.doc.save().circle(M + 12, by + 3.6, 1.6).fill(GREEN).restore();
        for (const l of lines) {
          this.text(l, M + 20, by, { size: 7 });
          by += 9;
        }
        by += 2;
      }
    }

    // Right: bank details + signature.
    let ry = top;
    this.fill(rightX, ry, rightW, 18, GREEN);
    this.text("COMPANY'S BANK DETAILS", rightX + 8, ry + 5, { size: 7.8, bold: true, color: '#FFFFFF' });
    ry += 18;
    bankRows.forEach(([label, lines], i) => {
      const h = bankH[i];
      this.fill(rightX, ry, 72, h, LABEL_FILL);
      this.box(rightX, ry, 72, h);
      this.box(rightX + 72, ry, rightW - 72, h);
      const ll = label.split('\n');
      const lt = ry + (h - ll.length * 9.5) / 2;
      ll.forEach((l, k) => this.text(l, rightX + 6, lt + k * 9.5, { size: 7.4, bold: true }));
      const vt = ry + (h - lines.length * 9.5) / 2;
      lines.forEach((l, k) => this.text(l, rightX + 78, vt + k * 9.5, { size: 7.6 }));
      ry += h;
    });
    this.box(rightX, ry, rightW, 22);
    this.text(`for ${c.name || 'Rosal Safety Private Limited'}`, rightX, ry + 7, { size: 7.8, bold: true, width: rightW, align: 'center' });
    ry += 22;
    this.fill(rightX, ry, rightW, signH, LABEL_FILL);
    this.box(rightX, ry, rightW, signH);
    if (c.authorisedSignatory) this.text(c.authorisedSignatory, rightX, ry + 18, { size: 7.6, color: MUTED, width: rightW, align: 'center' });
    this.text('Authorised Signatory', rightX, ry + signH - 14, { size: 7.8, bold: true, color: MUTED, width: rightW, align: 'center' });
    ry += signH;

    this.y = Math.max(ly + declH, ry) + 8;
  }
}
