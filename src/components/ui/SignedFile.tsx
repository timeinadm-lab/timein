import { useEffect, useState } from 'react'
import { getSignedUrl } from '../../lib/storage'
import toast from 'react-hot-toast'

// Link que abre um arquivo de bucket privado via URL assinada (gerada no clique).
export function SignedLink({ value, bucket, className, children }: {
  value: string | null | undefined
  bucket: string
  className?: string
  children: React.ReactNode
}) {
  const [loading, setLoading] = useState(false)
  if (!value) return null
  const open = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    setLoading(true)
    try {
      const url = await getSignedUrl(value, bucket)
      if (url) window.open(url, '_blank', 'noopener')
      else toast.error('Não foi possível abrir o arquivo.')
    } finally { setLoading(false) }
  }
  return (
    <a href="#" onClick={open} className={className}>
      {loading ? 'abrindo…' : children}
    </a>
  )
}

// Imagem de bucket privado: resolve a URL assinada e exibe.
export function SignedImage({ value, bucket, className, alt, fallback }: {
  value: string | null | undefined
  bucket: string
  className?: string
  alt?: string
  fallback?: React.ReactNode
}) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    if (value) getSignedUrl(value, bucket).then(u => { if (active) setSrc(u) })
    else setSrc(null)
    return () => { active = false }
  }, [value, bucket])
  if (!src) return <>{fallback ?? null}</>
  return <img src={src} alt={alt} className={className} />
}
