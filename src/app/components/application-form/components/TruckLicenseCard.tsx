'use client';

import Image from '@/app/components/AppImage';

import FormCard from './FormCard';
import type { FormErrors, TruckLicense } from '../types';
import { TRUCK_LICENSE_OPTIONS } from '../utils/mapTruckLicenses';

type TruckLicenseCardProps = {
  stepImageSrc?: string;
  selectedLicenses: TruckLicense[];
  errors: FormErrors;
  onToggle: (value: TruckLicense) => void;
  onNext: () => void;
  onPrevious?: () => void;
  isActive: boolean;
};

// 保有免許・資格（複数選択可）。'none' の排他制御は onToggle 側(useApplicationFormState)で行う。
export default function TruckLicenseCard({
  stepImageSrc,
  selectedLicenses,
  errors,
  onToggle,
  onNext,
  onPrevious,
  isActive,
}: TruckLicenseCardProps) {
  const isNextEnabled = selectedLicenses.length > 0;

  return (
    <FormCard isActive={isActive} className="pb-6">
      <div className="mb-6 text-left">
        {stepImageSrc && (
          <Image className="w-full mb-4" src={stepImageSrc} alt="Step" width={300} height={50} priority />
        )}
        <h1 className="text-lg text-center font-bold mb-1 text-gray-700">条件に合った求人を検索します</h1>
        <p className="mb-4 text-center text-xs text-gray-500">お持ちの運転免許・資格（複数選択できます）</p>

        <div className="grid grid-cols-2 gap-3">
          {TRUCK_LICENSE_OPTIONS.map((option) => {
            const isSelected = selectedLicenses.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isSelected}
                className={`w-full rounded-xl border-2 px-2 py-3 text-center text-sm font-semibold transition-all duration-150 ease-out focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                  isSelected
                    ? 'border-[#ff702a] bg-orange-50 text-[#ff702a]'
                    : 'border-gray-300 bg-white text-gray-900 hover:border-gray-400'
                }`}
                onClick={() => onToggle(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {errors.truckLicenses && <p className="text-red-500 text-xs mt-3">{errors.truckLicenses}</p>}
      </div>

      <div className="flex items-center justify-between gap-4">
        {onPrevious ? (
          <button type="button" className="py-2 px-4 font-bold text-gray-800" onClick={onPrevious}>
            ＜ 戻る
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          className={`flex-1 py-2.5 px-5 rounded-md text-white font-bold ${
            isNextEnabled ? 'bg-[#ff702a] cursor-pointer' : 'bg-gray-400 cursor-not-allowed'
          }`}
          onClick={onNext}
          disabled={!isNextEnabled}
        >
          次へ
        </button>
      </div>
    </FormCard>
  );
}
