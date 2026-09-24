import { NextRequest, NextResponse } from 'next/server';

import { getJobsByPrefectureId, fetchPrefectureById, fetchMunicipalityById, getPrefectureByRegion } from '@/lib/microcms';
import { normalizePostcode } from '@/lib/postcode';
import { isMicrocmsId, parseMicrocmsIdList } from '@/lib/query-params';
import { fetchAddressByZipcode } from '@/lib/zipcloud';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const postalCode = searchParams.get('postalCode');
    const prefectureId = searchParams.get('prefectureId');
    const municipalityId = searchParams.get('municipalityId');
    const parsedCategoryIds = parseMicrocmsIdList(searchParams.get('jobCategoryIds'));

    if (
      parsedCategoryIds === null ||
      (prefectureId !== null && !isMicrocmsId(prefectureId)) ||
      (municipalityId !== null && !isMicrocmsId(municipalityId))
    ) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }
    const jobCategoryIds = parsedCategoryIds.length > 0 ? parsedCategoryIds : undefined;

    if (prefectureId) {
      const prefecture = await fetchPrefectureById(prefectureId);
      if (!prefecture) {
        return NextResponse.json({ error: '都道府県の取得に失敗しました' }, { status: 404 });
      }
      const response = await getJobsByPrefectureId(prefectureId, jobCategoryIds);
      const jobCount = response.totalCount;
      const searchArea = `${prefecture.region}内`;

      return NextResponse.json({
        jobCount,
        searchMethod: 'prefecture',
        searchArea,
        prefectureName: prefecture.region,
        prefectureId: prefecture.id,
        message:
          jobCount > 0
            ? `${searchArea}で${jobCount}件の求人が見つかりました`
            : `${searchArea}では現在求人がありません`,
      });
    }

    if (municipalityId) {
      const municipality = await fetchMunicipalityById(municipalityId);
      if (!municipality) {
        return NextResponse.json({ error: '市区町村の取得に失敗しました' }, { status: 404 });
      }

      const response = await getJobsByPrefectureId(municipality.prefecture.id, jobCategoryIds);
      const jobCount = response.totalCount;
      const searchArea = `${municipality.prefecture.region}内`;

      return NextResponse.json({
        jobCount,
        searchMethod: 'prefecture',
        searchArea,
        prefectureName: municipality.prefecture.region,
        prefectureId: municipality.prefecture.id,
        message:
          jobCount > 0
            ? `${searchArea}で${jobCount}件の求人が見つかりました`
            : `${searchArea}では現在求人がありません`,
      });
    }

    if (!postalCode) {
      return NextResponse.json({ error: 'postalCode または都道府県IDが必要です' }, { status: 400 });
    }

    const normalizedPostalCode = normalizePostcode(postalCode);
    if (!/^[0-9]{7}$/.test(normalizedPostalCode)) {
      return NextResponse.json({ error: '郵便番号は7桁で指定してください' }, { status: 400 });
    }

    const location = await fetchAddressByZipcode(normalizedPostalCode);
    if (!location?.prefectureName) {
      return NextResponse.json({ error: '郵便番号に該当する都道府県が見つかりませんでした' }, { status: 404 });
    }

    const prefecture = await getPrefectureByRegion(location.prefectureName);
    if (!prefecture) {
      return NextResponse.json({ error: '都道府県の取得に失敗しました' }, { status: 404 });
    }

    const response = await getJobsByPrefectureId(prefecture.id, jobCategoryIds);
    const jobCount = response.totalCount;
    const searchArea = `${prefecture.region}内`;

    return NextResponse.json({
      postalCode: normalizedPostalCode,
      jobCount,
      searchMethod: 'postal_code',
      searchArea,
      prefectureName: prefecture.region,
      prefectureId: prefecture.id,
      message:
        jobCount > 0
          ? `${searchArea}で${jobCount}件の求人が見つかりました`
          : `${searchArea}では現在求人がありません`,
    });
  } catch (error) {
    console.error('Error in jobs-count API:', error);
    return NextResponse.json({ error: 'Failed to fetch job count' }, { status: 500 });
  }
}
