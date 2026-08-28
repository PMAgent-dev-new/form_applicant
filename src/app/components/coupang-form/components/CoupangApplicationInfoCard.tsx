'use client';

import Image from '@/app/components/AppImage';
import FormCard from '../../application-form/components/FormCard';
import { SelectInput } from './SelectInput';
import type { CoupangFormData, CoupangFormErrors, JobPosition, DesiredLocation } from '../types';

type CoupangApplicationInfoCardProps = {
  stepImageSrc: string;
  formData: CoupangFormData;
  errors: CoupangFormErrors;
  jobPositionOptions: { value: JobPosition | ''; label: string }[];
  locationOptions: { value: DesiredLocation | ''; label: string }[];
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  onNext: () => void;
  isActive: boolean;
};

export default function CoupangApplicationInfoCard({
  stepImageSrc,
  formData,
  errors,
  jobPositionOptions,
  locationOptions,
  onChange,
  onNext,
  isActive,
}: CoupangApplicationInfoCardProps) {
  return (
    <FormCard isActive={isActive}>
      <div className="mb-6 flex justify-center">
        <Image
          src={stepImageSrc}
          alt="ステップ1"
          width={320}
          height={180}
          className="h-auto w-full max-w-[320px]"
          priority
        />
      </div>

      <div className="mb-6 text-center">
        <p className="text-sm text-gray-600 mb-2">ステップ 1/4</p>
        <h2 className="text-xl font-bold text-gray-900">応募情報</h2>
      </div>

      <div className="space-y-6">
        <SelectInput
          name="jobPosition"
          label="希望職種"
          value={formData.jobPosition}
          onChange={onChange}
          error={errors.jobPosition}
          options={jobPositionOptions}
        />

        <SelectInput
          name="desiredLocation"
          label="希望勤務地"
          value={formData.desiredLocation}
          onChange={onChange}
          error={errors.desiredLocation}
          options={locationOptions}
        />
      </div>

      <div className="mt-8">
        <button
          type="button"
          onClick={onNext}
          className="w-full bg-[#1d4ed8] hover:bg-[#1e40af] text-white font-bold py-4 px-6 rounded-lg transition-colors"
        >
          次へ
        </button>
      </div>
    </FormCard>
  );
}
