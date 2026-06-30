import { formatDate, formatCurrency } from './utils'

export function exportToCSV(data: Record<string, unknown>[], filename: string) {
  if (!data.length) return
  const headers = Object.keys(data[0])
  const rows = data.map(row =>
    headers.map(h => {
      const val = row[h]
      if (val == null) return ''
      const str = String(val)
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str
    }).join(',')
  )
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function exportPaymentsToPDF(payments: Record<string, unknown>[], title: string) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF()
  doc.setFontSize(16)
  doc.text(title, 14, 20)
  doc.setFontSize(10)
  let y = 35
  const headers = ['Descrição', 'Valor', 'Vencimento', 'Status']
  const colW = [80, 35, 35, 30]
  let x = 14
  headers.forEach((h, i) => {
    doc.text(h, x, y)
    x += colW[i]
  })
  y += 6
  doc.line(14, y, 196, y)
  y += 4
  payments.forEach(p => {
    x = 14
    const row = [
      String(p.description || ''),
      formatCurrency(p.amount as number),
      formatDate(p.due_date as string),
      String(p.status || ''),
    ]
    row.forEach((cell, i) => {
      doc.text(cell.substring(0, 30), x, y)
      x += colW[i]
    })
    y += 6
    if (y > 270) { doc.addPage(); y = 20 }
  })
  doc.save(`${title}.pdf`)
}

export async function exportEmployeeToPDF(employee: Record<string, unknown>, documents: Record<string, unknown>[]) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF()
  doc.setFontSize(18)
  doc.text('Ficha do Colaborador', 14, 20)
  doc.setFontSize(12)
  doc.text(`Nome: ${employee.full_name}`, 14, 35)
  doc.text(`CPF: ${employee.cpf || '-'}`, 14, 43)
  doc.text(`Cargo: ${employee.role || '-'}`, 14, 51)
  doc.text(`Admissão: ${formatDate(employee.admission_date as string)}`, 14, 59)
  doc.text(`Status: ${employee.status || '-'}`, 14, 67)
  doc.text(`CRN: ${employee.crn_number || '-'} / ${employee.crn_region || '-'}`, 14, 75)
  doc.text(`WhatsApp: ${employee.whatsapp || '-'}`, 14, 83)
  doc.text(`E-mail: ${employee.email || '-'}`, 14, 91)
  doc.setFontSize(14)
  doc.text('Documentos', 14, 106)
  doc.setFontSize(10)
  let y = 116
  documents.forEach(d => {
    doc.text(`${d.name}: ${d.status}`, 14, y)
    y += 7
  })
  doc.save(`colaborador_${employee.full_name}.pdf`)
}
