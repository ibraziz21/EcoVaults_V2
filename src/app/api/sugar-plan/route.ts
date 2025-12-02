import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function runPy(args: string[], stdin?: string) {
  return new Promise<{ code: number; out: string; err: string }>((resolve) => {
    const cmd = process.platform === 'win32' ? 'python' : 'python3'
    const child = spawn(cmd, args, { env: process.env })
    const out: Uint8Array[] = []
    const err: Uint8Array[] = []
    if (stdin) { child.stdin.write(stdin); child.stdin.end() }
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => err.push(d))
    child.on('close', (code) =>
      resolve({ code: code ?? 0, out: Buffer.concat(out).toString('utf-8'), err: Buffer.concat(err).toString('utf-8') })
    )
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const { amountInWei, account, slippage } = body || {}
  if (!amountInWei || !account) {
    return NextResponse.json({ ok: false, error: 'missing_amount_or_account' }, { status: 400 })
  }

  const script = path.join(process.cwd(), 'src', 'lib', 'py', 'sugar_quote_usdt_usdt0_lisk.py')
  const { code, out, err } = await runPy([script], JSON.stringify({ amountInWei: String(amountInWei), account, slippage }))

  if (code !== 0) return NextResponse.json({ ok: false, error: err || 'python_failed' }, { status: 500 })

  try {
    const json = JSON.parse(out || '{}')
    return NextResponse.json(json)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `bad_json: ${e?.message}`, raw: out }, { status: 500 })
  }
}
