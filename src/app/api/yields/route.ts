import { NextResponse } from 'next/server'
import { fetchYields } from '@/lib/fetchYields'

export async function GET() {
  try {
    const rows = await fetchYields()
    rows.sort((a, b) => b.apy - a.apy)
    return NextResponse.json(rows)
  } catch (err) {
    console.error('[api/yields]', err)
    return NextResponse.json({ error: 'fetch failed' }, { status: 500 })
  }
}
