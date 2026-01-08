// src/app/api/admin/push-deposits/route.ts
import 'server-only'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { pushDeposits } from '@/lib/pushDeposits'

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const limit = Number(url.searchParams.get('limit') || '10') || 10

  // simple token guard
  const requiredToken = process.env.ADMIN_PUSH_TOKEN
  if (requiredToken) {
    const headerToken = req.headers.get('x-admin-token')
    if (!headerToken || headerToken !== requiredToken) {
      return bad('unauthorized', 401)
    }
  }

  // finish endpoint to call
  const finishUrl =
    process.env.FINISH_URL ||
    `${url.origin}/api/deposits/finish`

  try {
    const summary = await pushDeposits({ limit, finishUrl })
    return NextResponse.json({ ok: true, ...summary })
  } catch (err: any) {
    return bad(err?.message || 'push failed', 500)
  }
}
