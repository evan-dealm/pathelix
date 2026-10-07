import { contentOgImage, OG_CONTENT_TYPE, OG_SIZE } from '@/lib/site/og'

export const alt = 'Pathélix — Politique de confidentialité'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return contentOgImage('Pathélix', 'Politique de confidentialité')
}
