import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'

/**
 * Open Graph image of the website, generated once at build time from real assets only: the logo
 * and the map side of the Tournées screenshot. No illustration.
 */
export const alt =
  'Pathélix — plateforme d’exploitation pour les entreprises de bennes, de collecte, de déchets et de recyclage'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

async function dataUrl(relativePath: string, mime: string): Promise<string> {
  const file = await readFile(path.join(process.cwd(), relativePath))
  return `data:${mime};base64,${file.toString('base64')}`
}

export default async function OpengraphImage() {
  const [logo, screen] = await Promise.all([
    dataUrl('public/logo-pathelix.png', 'image/png'),
    dataUrl('src/assets/site/tournees.png', 'image/png'),
  ])

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        background: '#000000',
        color: '#FFFFFF',
      }}
    >
      {/* Right half: the real Tournées screen, cropped to its map by the container. */}
      <div
        style={{
          position: 'absolute',
          left: 600,
          top: 96,
          width: 700,
          height: 600,
          display: 'flex',
          overflow: 'hidden',
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.22)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={screen} width={1224} height={600} style={{ marginLeft: -590 }} />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 64,
          width: 590,
          height: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
          <img src={logo} width={76} height={76} style={{ borderRadius: 16 }} />
          <div style={{ marginLeft: 20, fontSize: 40, letterSpacing: -1.2 }}>Pathélix</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 50, lineHeight: 1.06, letterSpacing: -2 }}>
            La journée d’exploitation, sur un seul écran.
          </div>
          <div style={{ marginTop: 22, fontSize: 23, lineHeight: 1.35, color: '#9A9EA6' }}>
            Bennes, collecte, déchets, recyclage : missions, tournées, chauffeurs et facturation.
          </div>
        </div>
      </div>
    </div>,
    size,
  )
}
