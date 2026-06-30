import * as XLSX from 'xlsx'

export async function parseXLSX(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })
        if (!json.length) { resolve({ headers: [], rows: [] }); return }
        const headers = (json[0] as string[]).map(String)
        const rows = json.slice(1).map(r => headers.map((_, i) => String((r as string[])[i] ?? '')))
        resolve({ headers, rows })
      } catch (err) {
        reject(err)
      }
    }
    reader.readAsArrayBuffer(file)
  })
}

export function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split('\n').filter(l => l.trim())
  if (!lines.length) return { headers: [], rows: [] }
  const sep = lines[0].includes(';') ? ';' : ','
  const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''))
  const rows = lines.slice(1).map(line => {
    const cols: string[] = []
    let current = ''
    let inQuotes = false
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes }
      else if (char === sep && !inQuotes) { cols.push(current.trim()); current = '' }
      else { current += char }
    }
    cols.push(current.trim())
    return cols
  })
  return { headers, rows }
}
