import { apiRoute } from '@/lib/api/route'

/** The current user's notifications (newest first) and the unread count. */
export const GET = apiRoute({ name: '/api/notifications' }, async ({ db, userId, req }) => {
  const unreadOnly = req.nextUrl.searchParams.get('unread') === '1'
  const [data, unread] = await Promise.all([
    db.notification.findMany({ where: { userId, ...(unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: 'desc' }, take: 50 }),
    db.notification.count({ where: { userId, readAt: null } }),
  ])
  return { data, unread }
})
