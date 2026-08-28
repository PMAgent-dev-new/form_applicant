'use client';

import Image from '@/app/components/AppImage';
import FormCard from '../../application-form/components/FormCard';
import { SelectInput } from './SelectInput';
import { TextInput } from './TextInput';
import type { CoupangFormData, CoupangFormErrors, Age } from '../types';

type CoupangSeminarInfoCardProps = {
  stepImageSrc: string;
  formData: CoupangFormData;
  errors: CoupangFormErrors;
  ageOptions: { value: Age | ''; label: string }[];
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  onNext: () => void;
  onPrevious: () => void;
  isActive: boolean;
};

export default function CoupangSeminarInfoCard({
  stepImageSrc,
  formData,
  errors,
  ageOptions,
  onChange,
  onNext,
  onPrevious,
  isActive,
}: CoupangSeminarInfoCardProps) {
  return (
    <FormCard isActive={isActive}>
      <div className="mb-6 flex justify-center">
        <Image
          src={stepImageSrc}
          alt="ステップ2"
          width={320}
          height={180}
          className="h-auto w-full max-w-[320px]"
        />
      </div>

      <div className="mb-6 text-center">
        <p className="text-sm text-gray-600 mb-2">ステップ 2/4</p>
        <h2 className="text-xl font-bold text-gray-900">セミナー情報</h2>
      </div>

      <div className="space-y-6">
        <SelectInput
          name="age"
          label="年齢"
          value={formData.age}
          onChange={onChange}
          error={errors.age}
          options={ageOptions}
        />

        <TextInput
          name="birthDate"
          label="生年月日"
          value={formData.birthDate}
          onChange={onChange}
          error={errors.birthDate}
          placeholder="19900101"
          helpText="8桁の半角数字で入力してください"
          inputMode="numeric"
          maxLength={8}
        />
      </div>

      <p className="mt-4 text-xs text-gray-600">※上限年齢は40歳までとなります</p>

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
