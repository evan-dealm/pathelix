import { contentOgImage, OG_CONTENT_TYPE, OG_SIZE } from '@/lib/site/og'

export const alt = 'Pathélix — Conçu pour les métiers de la benne et de la collecte'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return contentOgImage('Métiers', 'Conçu pour les métiers de la benne et de la collecte')
}
