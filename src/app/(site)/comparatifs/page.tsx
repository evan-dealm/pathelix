import { permanentRedirect } from 'next/navigation'

/** The collection has no listing of its own: its pages are listed on /guides. */
export default function Page(): never {
  permanentRedirect('/guides')
}
