import Image, { type StaticImageData } from 'next/image'

interface CaptureProps {
  src: StaticImageData
  /** What the screen shows, for someone who cannot see it. */
  alt: string
  /** `sizes` hint for the responsive image. */
  sizes: string
  priority?: boolean
  /**
   * Aspect ratio of the frame on large screens, as a Tailwind class (e.g. `lg:aspect-[2/1]`): the
   * screenshot covers it, anchored by `imageClassName`.
   */
  window: string
  /** Extra classes on the frame. */
  className?: string
  /** Extra classes on the image (object-position, scroll-linked animation…). */
  imageClassName?: string
  caption?: string
  captionClassName?: string
}

/**
 * A real Pathélix screen, framed.
 *
 * On a desk the whole screen fits. On a phone a shrunk desktop screen is unreadable, so the
 * screenshot keeps a legible scale and the frame scrolls sideways instead — deliberately, inside
 * the frame only (browsers make a scrollable area reachable from the keyboard by themselves).
 */
export function Capture({
  src,
  alt,
  sizes,
  priority = false,
  window: windowRatio,
  className = '',
  imageClassName = 'object-left-top',
  caption,
  captionClassName = 'text-graphite',
}: CaptureProps) {
  return (
    <figure>
      <div className={`frame ${className}`}>
        <div
          className={`relative overflow-x-auto overscroll-x-contain lg:overflow-hidden ${windowRatio}`}
        >
          <Image
            src={src}
            alt={alt}
            sizes={sizes}
            priority={priority}
            placeholder="blur"
            className={`block h-auto w-[270%] max-w-none sm:w-[165%] lg:absolute lg:inset-0 lg:h-full lg:w-full lg:object-cover ${imageClassName}`}
          />
        </div>
      </div>
      <figcaption className={`t-small mt-3 ${captionClassName}`}>
        {caption}
        <span className="lg:hidden">
          {caption ? ' ' : ''}Faites glisser l’image pour voir tout l’écran.
        </span>
      </figcaption>
    </figure>
  )
}
