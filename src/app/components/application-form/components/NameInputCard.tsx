'use client';

import Image from '@/app/components/AppImage';

import FormCard from './FormCard';
import FingerHint from './FingerHint';
import StepProgressBar from './StepProgressBar';
import type { FormData, FormErrors, JobCountResult } from '../types';

type NameInputCardProps = {
  stepImageSrc?: string;
  formData: FormData;
  errors: FormErrors;
  jobResult: JobCountResult;
  showJobCount: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur: (event: React.FocusEvent<HTMLInputElement>) => void;
  onPrevious: () => void;
  onNext: () => void;
  isActive: boolean;
  progress?: {
    currentStep: number;
    totalSteps: number;
  };
};

export default function NameInputCard({
  stepImageSrc,
  formData,
  errors,
  jobResult,
  showJobCount,
  onChange,
  onBlur,
  onPrevious,
  onNext,
  isActive,
  progress,
}: NameInputCardProps) {
  const isFullNameFilled = formData.fullName.trim().length > 0;
  const isFullNameKanaFilled = formData.fullNameKana.trim().length > 0;

  const firstIncompleteField = (() => {
    if (!isFullNameFilled) {
      return 'fullName';
    }
    if (!isFullNameKanaFilled) {
      return 'fullNameKana';
    }
    return null;
  })();

  const isNextEnabled = isFullNameFilled && isFullNameKanaFilled && !errors.fullName && !errors.fullNameKana;

  const primaryArea = jobResult.prefectureName?.trim() || jobResult.searchArea?.trim();
  const displayAreaName = primaryArea || 'ご希望のエリア';
  const isJobCountAvailable = typeof jobResult.jobCount === 'number';
  const isPositiveJobCount = Boolean(jobResult.jobCount && jobResult.jobCount > 0);

  return (
    <FormCard isActive={isActive} className="pb-6 mt-10">
      {progress ? (
        <StepProgressBar currentStep={progress.currentStep} totalSteps={progress.totalSteps} />
      ) : stepImageSrc ? (
        <Image className="w-full mb-4" src={stepImageSrc} alt="Step" width={300} height={50} />
      ) : null}

      {showJobCount && (
        <div className="text-center mb-6">
          {jobResult.isLoading ? (
            <div className="flex items-center justify-center text-[#2C32FF]">
              <div className="mr-2 h-4 w-4 animate-bounce rounded-full bg-[#2C32FF]" />
              <span className="text-sm font-semibold">求人件数を確認中...</span>
            </div>
          ) : jobResult.error ? (
            // 件数取得に失敗しても応募導線を止めない。エラー文言は見せず前向きな案内に差し替える
            <div className="space-y-1 text-[#2C32FF]">
              <p className="text-xl font-bold">{displayAreaName}のおすすめ求人をご紹介できます！</p>
              <p className="text-base font-semibold text-gray-900">すぐにご案内できます！</p>
            </div>
          ) : isJobCountAvailable ? (
            <div className="space-y-2 text-[#2C32FF]">
              <p className="text-xs font-semibold tracking-wide text-[#7A83FF]">
                {jobResult.searchMethod === 'postal_code' ? '郵便番号からの検索結果' : '都道府県での検索結果'}
              </p>
              <p className="text-2xl font-bold">
                <span>{displayAreaName}の求人</span>
                <span className="ml-2 text-3xl leading-none">{jobResult.jobCount}</span>
                <span className="ml-1 text-base">件</span>
              </p>
              <p className={`text-base font-semibold ${isPositiveJobCount ? 'text-gray-900' : 'text-gray-600'}`}>
                {isPositiveJobCount ? 'すぐにご案内できます！' : '現在ご案内できる求人が見つかりませんでした。'}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-600">郵便番号を入力するか地域を選択して求人件数を表示してください</p>
          )}
        </div>
      )}

      <div className="mb-6 text-left">
        <label className="font-bold mb-2.5 block text-gray-900">お名前(漢字)</label>
        <div className="relative flex items-center gap-3">
          <input
            type="text"
            id="fullName"
            name="fullName"
            placeholder="例: 田中 太郎"
            className={`flex-1 rounded border p-3 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent ${errors.fullName ? 'border-red-500' : 'border-gray-300'}`}
            value={formData.fullName}
            onChange={onChange}
            onBlur={onBlur}
          />
          <FingerHint
            isVisible={firstIncompleteField === 'fullName'}
            size={40}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-6 sm:size-[52px]"
          />
        </div>
        {errors.fullName && <p className="text-red-500 text-xs mt-1">{errors.fullName}</p>}
      </div>

      <div className="mb-6 text-left">
        <label className="font-bold mb-2.5 block text-gray-900">お名前(ふりがな)</label>
        <div className="relative flex items-center gap-3">
          <input
            type="text"
            id="fullNameKana"
            name="fullNameKana"
            placeholder="例: たなか たろう"
            className={`flex-1 rounded border p-3 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent ${errors.fullNameKana ? 'border-red-500' : 'border-gray-300'} ${formData.fullNameKana && !errors.fullNameKana ? 'text-gray-900' : ''}`}
            value={formData.fullNameKana}
            onChange={onChange}
          />
          <FingerHint
            isVisible={firstIncompleteField === 'fullNameKana'}
            size={40}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-6 sm:size-[52px]"
          />
        </div>
        {errors.fullNameKana && <p className="text-red-500 text-xs mt-1">{errors.fullNameKana}</p>}
      </div>

      <div className="flex justify-around items-center">
        <button type="button" className="py-2 text-sm font-bold cursor-pointer text-gray-800 mb-0" onClick={onPrevious}>
          ＜ 戻る
        </button>
        <div className="relative ml-auto flex w-[70%] max-w-[320px] items-center justify-end">
          <button
            type="button"
            className={`w-full rounded-md py-3 px-12 text-base font-bold text-white ${!isNextEnabled ? 'bg-gray-400 cursor-not-allowed' : 'bg-[#ff702a] cursor-pointer'}`}
            disabled={!isNextEnabled}
            onClick={onNext}
          >
            次へ
          </button>
          <FingerHint isVisible={isNextEnabled} size={44} className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-6 sm:size-[60px]" />
        </div>
      </div>
    </FormCard>
  );
}
