'use client'

import { useState } from 'react'
import { useTrade } from '@/providers/TradeProvider'
import type { TradeVocabulary } from '@/lib/trades'
import { OnboardingGuide, resetOnboarding } from '@/components/ui/OnboardingGuide'

function buildSections(v: TradeVocabulary) {
  return [
  {
    id: 'getting-started',
    title: 'Demarrage rapide',
    icon: '\u{1F680}',
    content: [
      { q: `Comment ajouter mes ${v.drivers.toLowerCase()} ?`, a: `Allez dans l'onglet "${v.drivers}" du panneau admin. Cliquez "+ Ajouter", remplissez les informations (nom, ${v.depot.toLowerCase()}, secteur). Vous pouvez aussi importer en masse via CSV depuis l'onglet Import.` },
      { q: `Comment creer mes ${v.exutoires.toLowerCase()} ?`, a: `Onglet "${v.exutoires}" > "+ Ajouter". Renseignez le nom, l'adresse, les horaires d'ouverture et le temps de service moyen.` },
      { q: `Comment importer mes ${v.missions.toLowerCase()} ?`, a: `Deux options : 1) Saisie manuelle dans l'onglet "${v.missions}" > "+ Ajouter". 2) Import CSV/Excel : onglet "Import" > selectionnez le type "${v.missions}" > uploadez votre fichier. Le mapping de colonnes est automatique.` },
      { q: `Comment lancer une optimisation ?`, a: `Onglet "${v.tours}" > selectionnez une date > cliquez "${v.optimize}". L'algorithme calcule automatiquement les meilleurs itineraires en respectant les contraintes (horaires, pauses legales, capacite ${v.vehicles.toLowerCase()}).` },
    ],
  },
  {
    id: 'optimization',
    title: 'Optimisation',
    icon: '\u{1F9E0}',
    content: [
      { q: 'Que signifient les curseurs Distance / Ponctualite / Equilibre ?', a: `Ces curseurs ajustent les priorites de l'algorithme. "Distance" minimise les km. "Ponctualite" respecte les fenetres horaires. "Equilibre" repartit equitablement la charge entre ${v.drivers.toLowerCase()}. Ajustez selon vos priorites du jour.` },
      { q: 'Combien de temps prend une optimisation ?', a: `De 5 a 120 secondes selon le nombre de ${v.missions.toLowerCase()} et ${v.drivers.toLowerCase()}. L'algorithme utilise un budget temps configurable.` },
      { q: `Que sont les ${v.missions.toLowerCase()} P1, P2, P3 ?`, a: `P1 = urgente (doit etre servie avant 10h). P2 = importante. P3 = normale. Les ${v.missions.toLowerCase()} P1 sont toujours assignees en priorite.` },
      { q: 'Comment fonctionne le planning multi-jours ?', a: `Via l'API /api/weekly-plan, vous pouvez optimiser une semaine entiere. L'algorithme equilibre la charge sur 5 jours pour eviter les pics.` },
    ],
  },
  {
    id: 'drivers',
    title: `Interface ${v.driver.toLowerCase()}`,
    icon: '\u{1F69B}',
    content: [
      { q: `Comment un ${v.driver.toLowerCase()} accede a sa ${v.tour.toLowerCase()} ?`, a: `Le ${v.driver.toLowerCase()} se connecte sur l'app (login avec ses identifiants). Il voit sa ${v.tour.toLowerCase()} du jour : liste des ${v.missions.toLowerCase()}, carte, itineraire.` },
      { q: 'Comment signaler l\'avancement ?', a: `Sur chaque ${v.mission.toLowerCase()}, le ${v.driver.toLowerCase()} clique "En route" > "Arrive" > "Demarre" > "Termine". Le statut est mis a jour en temps reel pour le dispatcher.` },
      { q: 'L\'app fonctionne-t-elle hors connexion ?', a: `Oui. La ${v.tour.toLowerCase()} du jour est cachee localement. Les changements de statut sont envoyes des que la connexion revient.` },
    ],
  },
  {
    id: 'legal',
    title: 'Conformite legale',
    icon: '\u{2696}',
    content: [
      { q: 'Quelles reglementations sont respectees ?', a: 'L\'algorithme respecte le reglement CE 561/2006 : maximum 4h30 de conduite continue, pause obligatoire de 45 minutes, maximum 9h de conduite par jour, 10h de travail total.' },
      { q: 'Les pauses dejeuner sont-elles gerees ?', a: 'Oui. L\'optimiseur laisse un creneaux libre entre 12h et 13h30 pour la pause dejeuner. Si ce n\'est pas possible, une penalite est appliquee.' },
    ],
  },
  {
    id: 'api',
    title: 'API et integrations',
    icon: '\u{1F50C}',
    content: [
      { q: 'Comment obtenir une cle API ?', a: 'Panneau admin > Parametres > Cles API > "+ Nouvelle cle". La cle est affichee UNE SEULE FOIS. Copiez-la immediatement. Format: ef_live_xxxx.' },
      { q: 'Quels endpoints sont disponibles ?', a: 'GET /api/drivers, GET /api/missions, POST /api/optimize, GET /api/plans, POST /api/import, GET /api/reports. Documentation complete disponible via la cle API.' },
      { q: 'Comment connecter mon ERP (Nessy, SAP, Sage) ?', a: 'Panneau admin > Integrations. Configurez le type d\'integration, les credentials, et activez-la. Les webhooks Nessy sont deja integres nativement.' },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Depannage',
    icon: '\u{1F527}',
    content: [
      { q: 'L\'optimisation est lente ou echoue', a: `Verifiez que vos ${v.missions.toLowerCase()} ont des coordonnees GPS valides (latitude/longitude). Augmentez le budget temps si necessaire. Pour > 500 ${v.missions.toLowerCase()}, l'algorithme decompose automatiquement en secteurs.` },
      { q: `Un ${v.driver.toLowerCase()} n'apparait pas dans les ${v.tours.toLowerCase()}`, a: `Verifiez qu'il n'est pas archive (onglet ${v.drivers}). Verifiez qu'il n'a pas d'indisponibilite sur la date concernee.` },
      { q: 'Les distances semblent incorrectes', a: 'Par defaut, les distances sont estimees en haversine avec un facteur de tortuosite. Pour des distances routieres precises, configurez OSRM dans les integrations.' },
    ],
  },
]
}

export default function HelpPage() {
  const { vocab } = useTrade()
  const sections = buildSections(vocab)
  const [activeSection, setActiveSection] = useState(sections[0].id)
  const [openQuestions, setOpenQuestions] = useState<Set<string>>(new Set())
  const [showOnboarding, setShowOnboarding] = useState(false)

  function toggleQ(key: string) {
    setOpenQuestions(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {showOnboarding && (
        <OnboardingGuide forceShow onClose={() => setShowOnboarding(false)} />
      )}
      <div className="relative z-[1] max-w-5xl mx-auto px-6 py-12">
        <div className="mb-10 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Centre d&apos;aide</h1>
            <p className="text-zinc-500 mt-2">Documentation et FAQ pour PATHÉLIX</p>
          </div>
          <button
            type="button"
            onClick={() => { resetOnboarding(); setShowOnboarding(true) }}
            className="shrink-0 px-4 py-2 rounded-lg border border-blue-200 text-blue-600 text-sm font-medium hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
            aria-label="Rejouer le guide de démarrage"
          >
            Guide de démarrage
          </button>
        </div>

        <div className="flex gap-8">
          {}
          <nav className="w-56 shrink-0 hidden md:block">
            <div className="sticky top-8 space-y-1">
              {sections.map(s => (
                <button key={s.id} type="button" onClick={() => setActiveSection(s.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                    activeSection === s.id ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  }`}>
                  <span className="mr-2">{s.icon}</span>{s.title}
                </button>
              ))}
            </div>
          </nav>

          {}
          <div className="flex-1 min-w-0">
            {sections.filter(s => s.id === activeSection).map(section => (
              <div key={section.id}>
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                  <span>{section.icon}</span>{section.title}
                </h2>
                <div className="space-y-3">
                  {section.content.map((item, i) => {
                    const key = `${section.id}-${i}`
                    const isOpen = openQuestions.has(key)
                    return (
                      <div key={key} className="bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                        <button type="button" onClick={() => toggleQ(key)}
                          className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition">
                          <span className={`text-xs transition-transform text-zinc-400 ${isOpen ? 'rotate-90' : ''}`}>&#9654;</span>
                          <span className="font-medium text-sm flex-1">{item.q}</span>
                        </button>
                        {isOpen && (
                          <div className="px-5 pb-4 pl-11 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                            {item.a}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
