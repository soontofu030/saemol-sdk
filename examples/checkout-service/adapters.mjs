/** Next.js App Router: export the returned handler as POST/GET in the matching route. */
export function nextRoutes(handlers) {
  return { checkoutPOST: handlers.checkout, webhookPOST: handlers.webhook, portalGET: handlers.portal }
}

/** Mount before express.json(); pass your installed Express module explicitly. */
export function mountExpressRoutes(app, express, handlers) {
  const mount = (method, path, handler, middleware) => app[method](path, middleware, async (req,res) => {
    const headers = new Headers()
    for (const [key,value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value)
    try {
      const request = new Request(`http://localhost${req.originalUrl}`, { method: req.method, headers,
        ...(req.method !== 'GET' ? { body: req.body } : {}) })
      const response = await handler(request)
      res.status(response.status).set(Object.fromEntries(response.headers)).send(await response.text())
    } catch { res.status(503).json({ error: '요청을 처리하지 못했습니다.' }) }
  })
  mount('post','/checkout',handlers.checkout,express.raw({ type:'application/json',limit:'1mb' }))
  mount('post','/webhooks/saemol',handlers.webhook,express.raw({ type:'application/json',limit:'1mb' }))
  mount('get','/customer-portal',handlers.portal,(_req,_res,next) => next())
}
