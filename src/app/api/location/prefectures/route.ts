import { NextResponse } from 'next/server';

import { fetchPrefectures } from '@/lib/jobs-source';

export async function GET() {
  try {
    const prefectures = await fetchPrefectures();
    return NextResponse.json({ contents: prefectures });
  } catch (error) {
    console.error('Failed to fetch prefectures:', error);
    return NextResponse.json({ error: 'Failed to fetch prefectures' }, { status: 500 });
  }
}

