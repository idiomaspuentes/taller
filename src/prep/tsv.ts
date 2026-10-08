/**
 * Port of the `_read_tsv` half of idiomas-puentes-docs/scripts/fcr_prep/inventory.py.
 * Delimited-text reader: tab by default, comma if no tab appears in a sample
 * and a comma does (matching csv.Sniffer's dialect pick for the same two
 * candidates). A comma file is read the CSV way (RFC4180-ish); a tab file as
 * the resources of Door43 write it (`parseTabbed`).
 */

function detectDelimiter(sample: string): "\t" | "," {
  if (!sample.includes("\t") && sample.includes(",")) return ",";
  return "\t";
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  function pushField() {
    row.push(field);
    field = "";
  }
  function pushRow() {
    pushField();
    rows.push(row);
    row = [];
  }

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length || row.length) pushRow();
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/**
 * A table with tabs, as the notes, the questions and the word lists of Door43 are written: a row to a line, a tab
 * between two cells, and nothing quoted. A quote is a character of the text. Read the CSV way, a cell that began
 * with a quote lost its quotes («"Que los diez hijos…". Y el rey…» in the questions of Esther), and one that did
 * not close it would have taken the rows after it for itself.
 */
function parseTabbed(text: string): string[][] {
  return text
    .split("\n")
    .map((line) => line.replace(/\r/g, ""))
    .filter((line) => line !== "")
    .map((line) => line.split("\t"));
}

/**
 * What a cell is to say, as a table writes it: on one line and with no tab in it. A line break is written out
 * (`\n`, two characters), as the notes write theirs.
 */
export function tsvCell(value: string): string {
  return value.replace(/\r\n?|\n/g, "\\n").replace(/\t/g, " ");
}

export type TsvTable = {
  headers: string[];
  rows: Record<string, string>[];
};

/** Read a TSV/CSV file into headers + {header: value} rows, all trimmed. */
export function parseTsvTable(text: string): TsvTable {
  const sample = text.slice(0, 2048);
  const delimiter = detectDelimiter(sample);
  const rows = delimiter === "\t" ? parseTabbed(text) : parseDelimited(text, delimiter);
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (const raw of rows.slice(1)) {
    const record: Record<string, string> = {};
    headers.forEach((header, idx) => {
      record[header] = (raw[idx] ?? "").trim();
    });
    out.push(record);
  }
  return { headers, rows: out };
}

/** Read a TSV/CSV file's text into an array of {header: value} rows, all trimmed. */
export function readTsv(text: string): Record<string, string>[] {
  return parseTsvTable(text).rows;
}
