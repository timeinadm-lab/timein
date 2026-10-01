// ============================================================
// Conversa nutricionista ↔ RH em ordem de horário.
// Cada linha de employee_questions guarda a pergunta (message, created_at) e a
// resposta (answer, answered_at). A resposta do RH vai para a última pergunta
// sem resposta — então, mostrando "pergunta + resposta" linha a linha, a
// conversa saía embaralhada (respostas de hoje no meio de mensagens de ontem).
// Aqui cada mensagem vira um item próprio e tudo é ordenado pelo horário.
// ============================================================

export interface LinhaPergunta {
  id: string
  message?: string | null
  answer?: string | null
  created_at: string
  answered_at?: string | null
  answered_by?: string | null
  initiated_by_admin?: boolean | null
}

export interface MensagemChat {
  chave: string
  id: string            // linha de origem
  de: 'pessoa' | 'rh'
  texto: string
  quando: string
  autor?: string | null
  semResposta?: boolean // pergunta da pessoa ainda sem resposta do RH
}

export function linhaDoTempo(linhas: LinhaPergunta[]): MensagemChat[] {
  const out: MensagemChat[] = []
  for (const l of linhas) {
    if (l.message && !l.initiated_by_admin) {
      out.push({ chave: l.id + ':p', id: l.id, de: 'pessoa', texto: l.message, quando: l.created_at, semResposta: !l.answer })
    }
    if (l.answer) {
      out.push({ chave: l.id + ':r', id: l.id, de: 'rh', texto: l.answer, quando: l.answered_at || l.created_at, autor: l.answered_by })
    }
  }
  out.sort((a, b) => new Date(a.quando).getTime() - new Date(b.quando).getTime() || (a.de === 'pessoa' ? -1 : 1))
  // Só fica "aguardando resposta" o que veio depois da última mensagem do RH
  let ultimaRh = -1
  out.forEach((m, i) => { if (m.de === 'rh') ultimaRh = i })
  out.forEach((m, i) => { if (m.de === 'pessoa') m.semResposta = i > ultimaRh })
  return out
}

/** Quantas mensagens da pessoa ainda esperam o RH (as que vieram depois da última resposta) */
export function naoRespondidas(linhas: LinhaPergunta[]): number {
  return linhaDoTempo(linhas).filter(m => m.semResposta).length
}
