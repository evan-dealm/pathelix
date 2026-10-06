import { z } from 'zod'
import { apiRoute } from '@/lib/api/route'

const ReadSchema = z.object({ ids: z.array(z.string()).max(200).optional(), all: z.boolean().optional() })

/** Marks the current user's notifications as read (given ids, or all). */
export const POST = apiRoute({ name: '/api/notifications/read', schema: ReadSchema }, async ({ db, userId, body }) => {
  const r = await db.notification.updateMany({
    where: { userId, readAt: null, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) },
    data: { readAt: new Date() },
  })
  return { updated: r.count }
})
