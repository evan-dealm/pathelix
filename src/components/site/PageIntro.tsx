import { Breadcrumb } from './Breadcrumb'

interface PageIntroProps {
  title: string
  lead?: string
  /** This page in the breadcrumb (visible trail and structured data). */
  crumb?: { href: string; label: string }
  children?: React.ReactNode
}

/** Opening of an inner page: the page's only h1, and one sentence that says what it covers. */
export function PageIntro({ title, lead, crumb, children }: PageIntroProps) {
  return (
    <header className="shell pb-14 pt-28 sm:pt-32 lg:pb-20 lg:pt-36">
      {crumb && <Breadcrumb trail={[crumb]} />}
      <h1
        className={`t-display enter-1 max-w-[17ch] !text-[clamp(2.25rem,1.3rem+4vw,4.25rem)] ${crumb ? 'mt-8' : ''}`}
      >
        {title}
      </h1>
      {lead && <p className="t-lead enter-2 mt-7 max-w-[40rem] text-graphite">{lead}</p>}
      {children && <div className="enter-3 mt-9">{children}</div>}
    </header>
  )
}
