import { NextResponse } from 'next/server'
import { buildOpenApiSpec } from '@/lib/openapi'

// Built once per process: it only depends on the code (scopes, schemas, event names).
let spec: Record<string, unknown> | null = null

export async function GET(): Promise<NextResponse> {
  spec ??= buildOpenApiSpec()
  return NextResponse.json(spec, {
    headers: { 'Access-Control-Allow-Origin': '*' },
  })
}
