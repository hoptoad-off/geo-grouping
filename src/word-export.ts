import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType,
} from 'docx';
import type { Participant } from './types.js';

// Display labels mirror viewer/live.js so the doc and the page agree.
const CAMPUS_LABELS: Record<string, string> = {
  mirzo_ulugbek: 'Mirzo Ulugbek',
  yashnobod: 'Yashnobod',
};

/** Human-readable campus name; falls back to the raw id. */
export function campusLabel(id: string): string {
  return CAMPUS_LABELS[id] ?? id;
}

const STATUS_LABELS: Record<string, string> = {
  waiting: 'Ожидает',
  grouped: 'В группе',
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function coords(p: Participant): string {
  return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
}

/** Label/value pairs shown for a single participant. */
function fields(p: Participant): [string, string][] {
  return [
    ['ID', p.id],
    ['Имя', p.displayName],
    ['Телефон', p.phone],
    ['Кампус', campusLabel(p.campusId)],
    ['Язык', p.language],
    ['Статус', statusLabel(p.status)],
    ['Группа', p.groupId ?? '—'],
    ['Координаты', coords(p)],
    ['Создан', p.createdAt],
  ];
}

/** Builds a .docx Buffer describing one participant. */
export async function buildPointDoc(p: Participant): Promise<Buffer> {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: p.displayName || p.id, heading: HeadingLevel.HEADING_1 }),
        ...fields(p).map(([k, v]) => new Paragraph({
          children: [new TextRun({ text: `${k}: `, bold: true }), new TextRun(String(v))],
        })),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

const COLUMNS = ['Имя', 'Телефон', 'Кампус', 'Язык', 'Статус', 'Группа', 'Координаты', 'Создан'];

function tableRow(cells: string[]): TableRow {
  return new TableRow({
    children: cells.map((c) => new TableCell({ children: [new Paragraph(String(c))] })),
  });
}

/** Builds a .docx Buffer with a table over many participants. */
export async function buildPointsDoc(ps: Participant[]): Promise<Buffer> {
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      tableRow(COLUMNS),
      ...ps.map((p) => tableRow([
        p.displayName, p.phone, campusLabel(p.campusId), p.language,
        statusLabel(p.status), p.groupId ?? '—', coords(p), p.createdAt,
      ])),
    ],
  });
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: `Точки (${ps.length})`, heading: HeadingLevel.HEADING_1 }),
        table,
      ],
    }],
  });
  return Packer.toBuffer(doc);
}
