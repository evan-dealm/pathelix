import { permanentRedirect } from 'next/navigation'

/** The collection has no listing of its own: its pages are listed on /produit. */
export default function Page(): never {
  permanentRedirect('/produit')
}
