import { supabase } from './supabase'

// Os buckets são privados. Um arquivo é guardado como caminho (ex: "atestados/<id>/x.pdf")
// e só é aberto por URL assinada temporária. Aceita também URLs públicas antigas (legado).
export function parseStorage(value: string, bucketHint?: string): { bucket: string; path: string } | null {
  if (!value) return null
  const pub = value.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/)
  if (pub) return { bucket: pub[1], path: decodeURIComponent(pub[2]) }
  if (value.startsWith('http')) return null // URL externa qualquer — sem como assinar
  if (!bucketHint) return null
  return { bucket: bucketHint, path: value.replace(/^\/+/, '') }
}

export async function getSignedUrl(value: string, bucketHint?: string, expiresIn = 3600): Promise<string | null> {
  const parsed = parseStorage(value, bucketHint)
  if (!parsed) return value || null
  const { data, error } = await supabase.storage.from(parsed.bucket).createSignedUrl(parsed.path, expiresIn)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}
