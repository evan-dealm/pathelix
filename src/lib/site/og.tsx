import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'

export const OG_SIZE = { width: 1200, height: 630 }
export const OG_CONTENT_TYPE = 'image/png'

/**
 * Sharing image of a content page: the real logo, the collection name and the page's own title
 * on black. Each page gets its own instead of the site-wide image.
 */
export async function contentOgImage(kicker: string, title: string): Promise<ImageResponse> {
  const logo = await readFile(path.join(process.cwd(), 'public/logo-pathelix.png'))
  const logoUrl = `data:image/png;base64,${logo.toString('base64')}`
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: '#000000',
        color: '#FFFFFF',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={logoUrl} width={76} height={76} style={{ borderRadius: 16 }} />
        <div style={{ marginLeft: 20, fontSize: 40, letterSpacing: -1.2 }}>Pathélix</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 28, color: '#9A9EA6' }}>{kicker}</div>
        <div
          style={{
            marginTop: 18,
            fontSize: title.length > 60 ? 56 : 68,
            lineHeight: 1.05,
            letterSpacing: -2.4,
            maxWidth: 1000,
          }}
        >
          {title}
        </div>
      </div>
    </div>,
    OG_SIZE,
  )
}
