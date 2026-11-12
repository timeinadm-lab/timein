// Grava o PDF no bucket `arquivos` e, quando há vínculo, aponta
// contract_file_url para ele — é o que tira o "sem contrato" da ficha e do sino.
// Caminho igual ao anexo manual da ficha: employees/<employee_id>/<link_id>_<timestamp>.pdf
import { supabase } from './supabase'

export function caminhoDoContrato(employeeId: string, linkId?: string | null) {
  const stamp = Date.now()
  return linkId
    ? `employees/${employeeId}/${linkId}_${stamp}.pdf`
    : `employees/${employeeId}/contrato_${stamp}.pdf`
}

export async function enviarPdfContrato(employeeId: string, blob: Blob, linkId?: string | null) {
  const path = caminhoDoContrato(employeeId, linkId)
  const { error } = await supabase.storage.from('arquivos').upload(path, blob, {
    upsert: true,
    contentType: 'application/pdf',
  })
  if (error) throw error
  return path
}

/** Mesmo efeito de anexar o arquivo na ficha do colaborador. */
export async function anexarNoVinculo(opts: {
  employeeId: string
  linkId: string
  path: string
  clientName?: string | null
  vacancyId?: string | null
}) {
  const { error } = await supabase.from('employee_client_links').update({ contract_file_url: opts.path }).eq('id', opts.linkId)
  if (error) throw error

  const docName = `Contrato assinado${opts.clientName ? ' — ' + opts.clientName : ''}`
  const { data: existingDocs } = await supabase.from('employee_documents')
    .select('id').eq('employee_id', opts.employeeId).eq('name', docName).limit(1)
  if (existingDocs?.[0]) {
    await supabase.from('employee_documents').update({ file_url: opts.path, status: 'Entregue' }).eq('id', existingDocs[0].id)
  } else {
    await supabase.from('employee_documents').insert({
      employee_id: opts.employeeId, name: docName, status: 'Entregue', file_url: opts.path,
    })
  }

  if (opts.vacancyId) {
    await supabase.from('vacancy_interests')
      .update({ status: 'Contratado', hired_at: new Date().toISOString(), employee_id: opts.employeeId })
      .eq('vacancy_id', opts.vacancyId).eq('status', 'Em contrato')
  } else {
    await supabase.from('vacancy_interests')
      .update({ status: 'Contratado', hired_at: new Date().toISOString() })
      .eq('employee_id', opts.employeeId).eq('status', 'Em contrato')
  }
}
