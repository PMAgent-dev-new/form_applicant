'use client';

import { useMemo } from 'react';
import { useCoupangFormState } from './hooks/useCoupangFormState';
import { useCoupangStep1Options } from './hooks/useCoupangStep1Options';
import {
  AGE_OPTIONS,
} from './constants';
import CoupangApplicationInfoCard from './components/CoupangApplicationInfoCard';
import CoupangSeminarInfoCard from './components/CoupangSeminarInfoCard';
import CoupangConditionCard from './components/CoupangConditionCard';
import CoupangPersonalInfoCard from './components/CoupangPersonalInfoCard';

type CoupangStepFormProps = {
  stepImageSrcs?: {
    step1?: string;
    step2?: string;
    step3?: string;
    step4?: string;
  };
};

export default function CoupangStepForm({
  stepImageSrcs = {
    step1: '/images/STEP1.webp',
    step2: '/images/STEP2.webp',
    step3: '/images/STEP3.webp',
    step4: '/images/STEP4.webp',
  },
}: CoupangStepFormProps) {
  const {
    formData,
    errors,
    isSubmitting,
    cardStates,
    handleChange,
    handleNextStep1,
    handleNextStep2,
    handleNextStep3,
    handlePreviousStep,
    handleSubmit,
  } = useCoupangFormState();
  const { locationOptions, locationOptionsByJobPosition } = useCoupangStep1Options();

  const ageOptions = AGE_OPTIONS;
  const filteredLocationOptions = useMemo(() => {
    if (!formData.jobPosition) {
      return locationOptions;
    }
    return locationOptionsByJobPosition[formData.jobPosition] || locationOptions;
  }, [formData.jobPosition, locationOptions, locationOptionsByJobPosition]);

  return (
    <div className="relative w-full">
      <form onSubmit={handleSubmit} noValidate>
        {/* ステップ1: 応募情報 */}
        <CoupangApplicationInfoCard
          stepImageSrc={stepImageSrcs.step1!}
          formData={formData}
          errors={errors}
          locationOptions={filteredLocationOptions}
          onChange={handleChange}
          onNext={handleNextStep1}
          isActive={cardStates.isStep1Active}
        />

        {/* ステップ2: セミナー情報 */}
        <CoupangSeminarInfoCard
          stepImageSrc={stepImageSrcs.step2!}
          formData={formData}
          errors={errors}
          ageOptions={ageOptions}
          onChange={handleChange}
          onNext={handleNextStep2}
          onPrevious={handlePreviousStep}
          isActive={cardStates.isStep2Active}
        />

        {/* ステップ3: 参加条件確認 */}
        <CoupangConditionCard
          stepImageSrc={stepImageSrcs.step3!}
          formData={formData}
          errors={errors}
          onChange={handleChange}
          onNext={handleNextStep3}
          onPrevious={handlePreviousStep}
          isActive={cardStates.isStep3Active}
        />

        {/* ステップ4: 求職者基本情報 */}
        <CoupangPersonalInfoCard
          stepImageSrc={stepImageSrcs.step4!}
          formData={formData}
          errors={errors}
          onChange={handleChange}
          onPrevious={handlePreviousStep}
          isSubmitting={isSubmitting}
          isActive={cardStates.isStep4Active}
        />
      </form>
    </div>
  );
}
