// Cloudflare Worker in front of every hostname the app server's tunnel
// serves. It passes requests through untouched; when the server is asleep
// (powered off by ops/idle-shutdown.sh) it starts the EC2 instance and
// answers "starting" until the API is back.
//
//   530: no tunnel connector, the instance is stopped or still booting
//   502: tunnel is up but the containers are not listening yet
// The FastAPI backend never returns either itself.
//
// API callers get a 503 in the backend's error envelope with code
// SERVER_WAKING (the frontend holds and retries, see
// frontend/src/api/serverWake.ts); browser navigations get a page that
// reloads itself. Deploy and secrets: see wrangler.toml.

const STARTING_STATUSES = new Set([502, 530])
const RETRY_AFTER_SECONDS = 10
// Per isolate: enough to stop a page's burst of requests each calling AWS.
const START_THROTTLE_MS = 30_000

let lastStartAt = 0

export default {
  async fetch(request, env, ctx) {
    let response
    try {
      response = await fetch(request)
    } catch (err) {
      console.error('origin fetch failed', err)
    }
    if (response && !STARTING_STATUSES.has(response.status)) return response

    if (Date.now() - lastStartAt > START_THROTTLE_MS) {
      lastStartAt = Date.now()
      ctx.waitUntil(startInstance(env))
    }
    return startingResponse(request)
  },
}

function startingResponse(request) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Retry-After': String(RETRY_AFTER_SECONDS),
  })
  const origin = request.headers.get('Origin')
  if (origin) {
    // Without these the browser hides the 503 from the app as a CORS failure.
    // Safe to echo any origin: this response carries no data.
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Vary', 'Origin')
    headers.set(
      'Access-Control-Allow-Headers',
      request.headers.get('Access-Control-Request-Headers') ||
        'authorization, content-type, idempotency-key',
    )
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  }

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })

  if ((request.headers.get('Accept') || '').includes('text/html')) {
    headers.set('Content-Type', 'text/html; charset=utf-8')
    return new Response(STARTING_PAGE, { status: 503, headers })
  }

  headers.set('Content-Type', 'application/json')
  const body = {
    error: {
      type: 'http_error',
      message: 'The server is starting. This takes about 1 to 2 minutes.',
      code: 'SERVER_WAKING',
    },
  }
  return new Response(JSON.stringify(body), { status: 503, headers })
}

const STARTING_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${RETRY_AFTER_SECONDS}">
<title>Starting</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 15px/1.5 system-ui, sans-serif; background: Canvas; color: CanvasText; }
  main { max-width: 26rem; padding: 1rem; text-align: center; }
</style>
</head>
<body>
<main>
  <h1>Starting the Server</h1>
  <p>The server sleeps when nobody is using it. It takes about 1 to 2 minutes
  to start, and this page will reload on its own.</p>
</main>
</body>
</html>`

// --- EC2 StartInstances, signed with AWS Signature Version 4 ---------------

async function startInstance(env) {
  const host = `ec2.${env.AWS_REGION}.amazonaws.com`
  const body = new URLSearchParams({
    Action: 'StartInstances',
    'InstanceId.1': env.INSTANCE_ID,
    Version: '2016-11-15',
  }).toString()
  const contentType = 'application/x-www-form-urlencoded; charset=utf-8'

  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const dateStamp = amzDate.slice(0, 8)
  const scope = `${dateStamp}/${env.AWS_REGION}/ec2/aws4_request`
  const signedHeaders = 'content-type;host;x-amz-date'
  const canonicalRequest = [
    'POST',
    '/',
    '',
    `content-type:${contentType}\nhost:${host}\nx-amz-date:${amzDate}\n`,
    signedHeaders,
    await sha256Hex(body),
  ].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n')

  let key = new TextEncoder().encode(`AWS4${env.AWS_SECRET_ACCESS_KEY}`)
  for (const part of [dateStamp, env.AWS_REGION, 'ec2', 'aws4_request']) {
    key = await hmac(key, part)
  }
  const signature = toHex(await hmac(key, stringToSign))

  const response = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'X-Amz-Date': amzDate,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${env.AWS_ACCESS_KEY_ID}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  })
  const text = await response.text()
  if (!response.ok) {
    console.error('StartInstances failed', response.status, text)
    return
  }
  const state = /<currentState>\s*<code>\d+<\/code>\s*<name>(\w+)<\/name>/.exec(text)
  console.log('StartInstances ok, state', state ? state[1] : 'unknown')
}

async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

async function hmac(keyBytes, text) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)))
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
