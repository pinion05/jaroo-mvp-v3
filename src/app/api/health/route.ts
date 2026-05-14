import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'jaroo-v3-web',
    runtime: 'next',
  })
}
