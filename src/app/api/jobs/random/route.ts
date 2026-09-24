import { NextRequest, NextResponse } from 'next/server';
import {
  getLatestJobsByCategoryId,
  getLatestJobsByCategoryIds,
  getRandomJobsByPrefectureId,
  getRandomJobsByPrefectureIdsAndCategory,
} from '@/lib/microcms';
import { clampCount, isMicrocmsId, parseMicrocmsIdList } from '@/lib/query-params';

// 画面は count=3 で呼ぶ。上限は microCMS の limit にそのまま渡るので小さく抑える
const MAX_COUNT = 12;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const prefectureId = searchParams.get('prefectureId');
    const prefectureIds = parseMicrocmsIdList(searchParams.get('prefectureIds'));
    const categoryId = searchParams.get('categoryId');
    const categoryIds = parseMicrocmsIdList(searchParams.get('categoryIds'));
    const count = clampCount(searchParams.get('count'), 3, MAX_COUNT);

    if (
      prefectureIds === null ||
      categoryIds === null ||
      (prefectureId !== null && !isMicrocmsId(prefectureId)) ||
      (categoryId !== null && !isMicrocmsId(categoryId))
    ) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }

    if (!prefectureId && prefectureIds.length === 0 && !categoryId && categoryIds.length === 0) {
      return NextResponse.json(
        { error: 'prefectureId(s), categoryId, or categoryIds is required' },
        { status: 400 }
      );
    }

    const jobs = prefectureIds.length > 0 && categoryId
      ? await getRandomJobsByPrefectureIdsAndCategory(prefectureIds, categoryId, count)
      : categoryIds.length > 0
        ? await getLatestJobsByCategoryIds(categoryIds, count)
        : categoryId
          ? await getLatestJobsByCategoryId(categoryId, count)
          : await getRandomJobsByPrefectureId(prefectureId!, count);

    if (jobs.length === 0) {
      return NextResponse.json(
        { error: 'No jobs found for the specified filters' },
        { status: 404 }
      );
    }

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('Error fetching random jobs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}
