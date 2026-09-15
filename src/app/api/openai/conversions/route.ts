import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { sendOpenAiConversionDirect, type OpenAiConversionInput } from '@/lib/openai/capi';

export const dynamic = 'force-dynamic';

function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided || !expected) return false;
  const actual = Buffer.from(provided);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function validString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

export async function GET(request: NextRequest) {
  const expected = process.env.OPENAI_ADS_RELAY_TOKEN ?? '';
  if (!tokenMatches(request.headers.get('x-openai-relay-token'), expected)) {
    return NextResponse.json({ status: 'unauthorized' }, { status: 401 });
  }
  const directReady =
    (process.env.OPENAI_ADS_PIXEL_ID ?? '').trim().length > 0 &&
    (process.env.OPENAI_ADS_CAPI_KEY ?? '').trim().length > 0;
  return NextResponse.json(
    { status: directReady ? 'ready' : 'degraded' },
    { status: directReady ? 200 : 503 },
  );
}

export async function POST(request: NextRequest) {
  const expected = process.env.OPENAI_ADS_RELAY_TOKEN ?? '';
  if (!tokenMatches(request.headers.get('x-openai-relay-token'), expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !body ||
    !validString(body.eventId, 128) ||
    !validString(body.oppref, 4096) ||
    (body.sourceUrl !== undefined && !validString(body.sourceUrl, 2048)) ||
    (body.timestampMs !== undefined &&
      (typeof body.timestampMs !== 'number' || !Number.isFinite(body.timestampMs) || body.timestampMs <= 0)) ||
    (body.validateOnly !== undefined && typeof body.validateOnly !== 'boolean')
  ) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const input: OpenAiConversionInput = {
    eventId: body.eventId,
    oppref: body.oppref,
    sourceUrl: body.sourceUrl as string | undefined,
    timestampMs: body.timestampMs as number | undefined,
    validateOnly: body.validateOnly === true,
  };
  const result = await sendOpenAiConversionDirect(input);
  if (result.ok) return NextResponse.json(result, { status: 200 });
  if (result.skipped === 'not_configured') {
    return NextResponse.json(result, { status: 503 });
  }
  return NextResponse.json(result, { status: 502 });
}
