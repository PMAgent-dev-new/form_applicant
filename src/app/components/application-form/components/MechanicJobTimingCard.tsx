'use client';

import FormCard from './FormCard';
import StepProgressBar from './StepProgressBar';
import type { FormData, FormErrors } from '../types';

type MechanicJobTimingCardProps = {
  selectedTiming: FormData['jobTiming'];
  errors: FormErrors;
  onSelect: (value: FormData['jobTiming']) => void;
  onNext: () => void;
  onPrevious?: () => void;
  isActive: boolean;
  progress: {
    currentStep: number;
    totalSteps: number;
  };
};

const options: Array<{
  value: FormData['jobTiming'];
  label: string;
}> = [
  { value: 'asap', label: 'なるべく早く' },
  { value: 'within_3_months', label: '3か月以内' },
  { value: 'within_6_months', label: '6か月以内' },
  { value: 'within_1_year', label: '1年以内' },
];

export default function MechanicJobTimingCard({
  selectedTiming,
  errors,
  onSelect,
  onNext,
  onPrevious,
  isActive,
  progress,
}: MechanicJobTimingCardProps) {
  const isNextEnabled = Boolean(selectedTiming);

  return (
    <FormCard isActive={isActive} className="pb-6 mt-10 compact:mt-0">
      <StepProgressBar currentStep={progress.currentStep} totalSteps={progress.totalSteps} />

      <div className="mb-6 compact:mb-3 text-center">
        <h2 className="mb-2 tight:mb-0 text-lg font-bold text-gray-900">就業時期</h2>
      </div>

      <div className="space-y-3 tight:space-y-2 mb-6 compact:mb-3">
        {options.map((option, index) => {
          const isSelected = selectedTiming === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={`relative w-full rounded-lg px-4 py-4 compact:py-3 tight:py-2.5 text-left transition-all duration-150 ease-out border-2 focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                isSelected
                  ? 'border-[#ff702a] bg-orange-50'
                  : 'border-gray-300 bg-white hover:border-gray-400'
              }`}
              onClick={() => onSelect(option.value)}
            >
              <div className="flex items-center justify-between">
                <span className={`text-base font-semibold ${isSelected ? 'text-[#ff702a]' : 'text-gray-900'}`}>
                  {option.label}
                </span>
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded border-2 transition-colors ${
                    isSelected
                      ? 'border-[#ff702a] bg-[#ff702a]'
                      : 'border-gray-400 bg-white'
                  }`}
                >
                  {isSelected && (
                    <span className="text-white text-sm font-bold">✓</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {errors.jobTiming && (
        <p className="text-red-500 text-xs mb-4">{errors.jobTiming}</p>
      )}

      <div className="flex justify-around items-center">
        {onPrevious ? (
          <button
            type="button"
            className="py-2 text-sm font-bold cursor-pointer text-gray-800 mb-0"
            onClick={onPrevious}
          >
            ＜ 戻る
          </button>
        ) : (
          <span />
        )}
        <div className="relative ml-auto flex w-[70%] max-w-[320px] items-center justify-end">
          <button
            type="button"
            className={`w-full rounded-md py-3 px-12 text-base font-bold text-white ${
              isNextEnabled
                ? 'bg-[#ff702a] cursor-pointer'
                : 'bg-gray-400 cursor-not-allowed'
            }`}
            onClick={onNext}
            disabled={!isNextEnabled}
          >
            次へ
          </button>
        </div>
      </div>
    </FormCard>
  );
}
