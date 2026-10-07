import { FAQ } from '@/lib/site/faq'

/** Native disclosure widgets: keyboard and screen-reader behaviour come from the browser. */
export function Faq() {
  return (
    <section className="band" aria-labelledby="questions">
      <div className="shell grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-20">
        <h2 id="questions" className="t-h2 self-start lg:sticky lg:top-28">
          Avant de demander une démo.
        </h2>
        <div className="border-t border-ink">
          {FAQ.map(entry => (
            <details key={entry.question} className="faq group border-b border-ink/15">
              <summary className="flex items-start justify-between gap-6 py-5">
                <h3 className="t-h3">{entry.question}</h3>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                  className="faq-mark mt-1 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.25"
                >
                  <path d="M8 1.5v13M1.5 8h13" />
                </svg>
              </summary>
              <p className="t-body max-w-[38rem] pb-6 text-graphite">{entry.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
