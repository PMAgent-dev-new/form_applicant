'use client';

import Image from '@/app/components/AppImage';
import FormCard from '../../application-form/components/FormCard';
import { TextInput } from './TextInput';
import type { CoupangFormData, CoupangFormErrors } from '../types';

type CoupangConditionCardProps = {
  stepImageSrc: string;
  formData: CoupangFormData;
  errors: CoupangFormErrors;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  onNext: () => void;
  onPrevious: () => void;
  isActive: boolean;
};

export default function CoupangConditionCard({
  stepImageSrc,
  formData,
  errors,
  onChange,
  onNext,
  onPrevious,
  isActive,
}: CoupangConditionCardProps) {
  return (
    <FormCard isActive={isActive}>
      <div className="mb-6 flex justify-center">
        <Image
          src={stepImageSrc}
          alt="ステップ3"
          width={320}
          height={180}
          className="h-auto w-full max-w-[320px]"
        />
      </div>

      <div className="mb-6 text-center">
        <p className="text-sm text-gray-600 mb-2">ステップ 3/4</p>
        <h2 className="text-xl font-bold text-gray-900">氏名入力</h2>
      </div>

      <div className="space-y-4">
        <TextInput
          name="fullName"
          label="氏名"
          value={formData.fullName}
          onChange={onChange}
          error={errors.fullName}
          placeholder="山田太郎"
          helpText="全角文字で入力してください"
        />
        <TextInput
          name="fullNameKana"
          label="ふりがな"
          value={formData.fullNameKana}
          onChange={onChange}
          error={errors.fullNameKana}
          placeholder="やまだたろう"
          helpText="ひらがなで入力してください"
        />
      </div>

      <div className="mt-8 flex gap-3">
        <button
          type="button"
          onClick={onPrevious}
          className="w-1/3 bg-gray-500 hover:bg-gray-600 text-white font-bold py-4 px-6 rounded-lg transition-colors"
        >
          戻る
        </button>
        <button
          type="button"
          onClick={onNext}
          className="w-2/3 bg-[#1d4ed8] hover:bg-[#1e40af] text-white font-bold py-4 px-6 rounded-lg transition-colors"
        >
          次へ
        </button>
      </div>
    </FormCard>
  );
}
