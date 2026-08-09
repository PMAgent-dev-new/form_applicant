'use client';

import Image from '@/app/components/AppImage';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

import { BirthDateCard, DesiredIncomeCard, FormExitModal, JobTimingCard, MechanicJobTimingCard, MechanicQualificationCard, NameCard, NameInputCard, PhoneNumberCard, NameAndContactCard, TruckLicenseCard } from './application-form/components';
import { useApplicationFormState } from './application-form/hooks/useApplicationFormState';
import type { FormOrigin, PeopleImageVariant } from './application-form/types';
import { FORM_PRESETS, type FormPreset } from './application-form/presets';

declare global {
  interface Window {
    dataLayer: Record<string, unknown>[];
  }
}

interface ApplicationFormProps {
  // プリセット使用時（推奨）
  preset?: FormPreset;

  // 個別カスタマイズ（必須）
  peopleImageSrc: string;
  peopleImageAlt?: string;
  showPeopleImage?: boolean;
  variant: PeopleImageVariant;

  // オーバーライド用（オプション）- プリセット設定を上書きしたい場合に使用
  formOrigin?: FormOrigin;
  headerLogoSrc?: string;
  headerUpperText?: string;
  headerLowerText?: string;
  containerClassName?: string;
  loadingLogoSrc?: string;
  step1ImageSrc?: string;
  step2ImageSrc?: string;
  step3ImageSrc?: string;
  step4ImageSrc?: string;
  step5ImageSrc?: string;
  footerLogoSrc?: string;
  bottomImageSrc?: string;
  showBottomImage?: boolean;
  showHeader?: boolean;
  footerBgClassName?: string;
  showLoadingScreen?: boolean;
  showFooterLogo?: boolean;
  enableJobTimingStep?: boolean;
  useModal?: boolean;
}

function ApplicationFormInner({
  preset,
  peopleImageSrc,
  variant,
  formOrigin,
  containerClassName,
  headerLogoSrc,
  headerUpperText,
  headerLowerText,
  loadingLogoSrc,
  step1ImageSrc,
  step2ImageSrc,
  step3ImageSrc,
  step4ImageSrc,
  step5ImageSrc,
  showHeader,
  showLoadingScreen,
  enableJobTimingStep,
  useModal,
  peopleImageAlt = '応募フォームイメージ',
  showPeopleImage = true,
}: ApplicationFormProps) {
  // プリセット設定を取得
  const presetConfig = preset ? FORM_PRESETS[preset] : null;

  // プリセット設定とpropsをマージ（propsが優先）
  const resolvedFormOrigin = formOrigin ?? presetConfig?.formOrigin ?? 'default';
  const resolvedContainerClassName = containerClassName ?? presetConfig?.containerClassName ?? '';
  const resolvedHeaderLogoSrc = headerLogoSrc ?? presetConfig?.headerLogoSrc ?? '/images/ride_logo.svg';
  const resolvedHeaderUpperText = headerUpperText ?? presetConfig?.headerUpperText ?? '未経験でタクシー会社に就職するなら';
  const resolvedHeaderLowerText = headerLowerText ?? presetConfig?.headerLowerText ?? 'RIDE JOB（ライドジョブ）';
  const resolvedLoadingLogoSrc = loadingLogoSrc ?? presetConfig?.loadingLogoSrc ?? '/images/ride_logo.svg';
  const resolvedStep1ImageSrc = step1ImageSrc ?? presetConfig?.step1ImageSrc ?? '/images/STEP1.png';
  const resolvedStep2ImageSrc = step2ImageSrc ?? presetConfig?.step2ImageSrc ?? '/images/STEP2.png';
  const resolvedStep3ImageSrc = step3ImageSrc ?? presetConfig?.step3ImageSrc ?? '/images/STEP3.png';
  const resolvedStep4ImageSrc = step4ImageSrc ?? presetConfig?.step4ImageSrc;
  const resolvedStep5ImageSrc = step5ImageSrc ?? presetConfig?.step5ImageSrc;
  const resolvedShowHeader = showHeader ?? presetConfig?.showHeader ?? true;
  const resolvedShowLoadingScreen = showLoadingScreen ?? presetConfig?.showLoadingScreen ?? true;
  const resolvedEnableJobTimingStep = enableJobTimingStep ?? presetConfig?.enableJobTimingStep ?? true;
  const resolvedUseModal = useModal ?? presetConfig?.useModal ?? true;

  const imagesToPreload = useMemo(() => {
    const images = [resolvedHeaderLogoSrc, resolvedStep1ImageSrc, resolvedStep2ImageSrc, resolvedStep3ImageSrc];
    if (resolvedStep4ImageSrc) images.push(resolvedStep4ImageSrc);
    if (resolvedStep5ImageSrc) images.push(resolvedStep5ImageSrc);
    return images;
  }, [resolvedHeaderLogoSrc, resolvedStep1ImageSrc, resolvedStep2ImageSrc, resolvedStep3ImageSrc, resolvedStep4ImageSrc, resolvedStep5ImageSrc]);

  const {
    loading,
    cardStates,
    formData,
    errors,
    phoneError,
    emailError,
    isSubmitDisabled,
    isSubmitting,
    jobResult,
    showExitModal,
    handleInputChange,
    handleJobTimingSelect,
    handleJobIntentSelect,
    handleMechanicQualificationSelect,
    handleMechanicJobTimingSelect,
    handleDesiredIncomeSelect,
    handleNextMechanicQualification,
    handleNextMechanicJobTiming,
    handleNextDesiredIncome,
    handleTruckLicenseToggle,
    handleNextTruckLicense,
    handleNameBlur,
    handleNextCard1,
    handleNextCard2,
    handleNextCard3,
    handleNextCard4,
    handlePreviousCard,
    handleSubmit,
    hideExitModal,
    confirmExit,
    exitModalVariant,
  } = useApplicationFormState({
    showLoadingScreen: resolvedShowLoadingScreen,
    imagesToPreload,
    variant,
    formOrigin: resolvedFormOrigin,
    enableJobTimingStep: resolvedEnableJobTimingStep,
  });

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const modalContentRef = useRef<HTMLDivElement | null>(null);
  const isMechanic = resolvedFormOrigin === 'mechanic';
  const isMechanicNewgrad = resolvedFormOrigin === 'mechanic_newgrad';
  const isTruck = resolvedFormOrigin === 'truck';
  const showLegalFooter = resolvedFormOrigin === 'default' || resolvedFormOrigin === 'bus' || isMechanic || isMechanicNewgrad || isTruck;

  useEffect(() => {
    if (!resolvedUseModal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [resolvedUseModal]);

  const formWrapperClassName = resolvedUseModal
    ? 'relative w-full max-w-sm px-1 py-6 overflow-y-auto no-scrollbar'
    : 'relative w-full max-w-sm px-1 mx-auto no-scrollbar';

  const formWrapperStyle = resolvedUseModal
    ? {
        maxHeight: `calc(100vh - ${resolvedShowHeader ? '7rem' : '3rem'} - ${showLegalFooter ? '4.5rem' : '1rem'})`,
      }
    : undefined;

  const legalFooter = showLegalFooter ? (
    <footer className="fixed inset-x-0 bottom-0 z-[10001] border-t border-gray-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-md items-center justify-center gap-3 px-4 py-3 text-xs text-gray-700">
        <a href="https://www.pmagent.jp" target="_blank" rel="noopener noreferrer" className="hover:underline">
          会社概要
        </a>
        <span aria-hidden className="text-gray-400">|</span>
        <a href="https://ridejob.pmagent.jp/privacy" target="_blank" rel="noopener noreferrer" className="hover:underline">
          プライバシーポリシー
        </a>
      </div>
    </footer>
  ) : null;

  const formContent = (
    <form onSubmit={handleSubmit} id="form" noValidate className="relative pb-4">
      {showPeopleImage && peopleImageSrc && (
        <div className="mb-6 flex justify-center">
          <Image src={peopleImageSrc} alt={peopleImageAlt} width={320} height={180} className="h-auto w-full max-w-[320px]" priority={resolvedFormOrigin === 'coupang'} />
        </div>
      )}

      {isMechanic && (
        <JobTimingCard
          selectedTiming={formData.jobIntent}
          errors={errors}
          onSelect={handleJobIntentSelect}
          errorMessage={errors.jobIntent ?? ''}
          isActive={cardStates.isCard1Active}
        />
      )}

      {resolvedEnableJobTimingStep && !isMechanic && !isMechanicNewgrad && (
        <JobTimingCard
          selectedTiming={formData.jobTiming}
          errors={errors}
          onSelect={handleJobTimingSelect}
          isActive={cardStates.isCard1Active}
        />
      )}

      {isMechanic ? (
        <>
          <MechanicQualificationCard
            selectedQualification={formData.mechanicQualification}
            errors={errors}
            formOrigin={resolvedFormOrigin}
            onSelect={(value) => handleMechanicQualificationSelect(value, true)}
            onNext={handleNextMechanicQualification}
            onPrevious={handlePreviousCard}
            isActive={cardStates.isCard2Active}
            progress={{ currentStep: 1, totalSteps: 7 }}
          />

          <MechanicJobTimingCard
            selectedTiming={formData.jobTiming}
            errors={errors}
            onSelect={(value) => handleMechanicJobTimingSelect(value, true)}
            onNext={handleNextMechanicJobTiming}
            onPrevious={handlePreviousCard}
            isActive={cardStates.isCard3Active}
            progress={{ currentStep: 2, totalSteps: 7 }}
          />

          <DesiredIncomeCard
            selectedIncome={formData.desiredIncome}
            errors={errors}
            onSelect={(value) => handleDesiredIncomeSelect(value, true)}
            onNext={handleNextDesiredIncome}
            onPrevious={handlePreviousCard}
            isActive={cardStates.isCard4Active}
            progress={{ currentStep: 3, totalSteps: 7 }}
          />

          <BirthDateCard
            birthDate={formData.birthDate}
            errors={errors}
            onChange={handleInputChange}
            onNext={handleNextCard2}
            onPrevious={handlePreviousCard}
            isActive={cardStates.isCard5Active}
            progress={{ currentStep: 4, totalSteps: 7 }}
          />

          <NameCard
            postalCode={formData.postalCode}
            prefectureId={formData.prefectureId}
            municipalityId={formData.municipalityId}
            errors={errors}
            onChange={handleInputChange}
            onPrevious={handlePreviousCard}
            onNext={handleNextCard3}
            isActive={cardStates.isCard6Active}
            progress={{ currentStep: 5, totalSteps: 7 }}
          />

          <NameInputCard
            formData={formData}
            errors={errors}
            jobResult={jobResult}
            showJobCount={true}
            onChange={handleInputChange}
            onBlur={handleNameBlur}
            onPrevious={handlePreviousCard}
            onNext={handleNextCard4}
            isActive={cardStates.isCard7Active}
            progress={{ currentStep: 6, totalSteps: 7 }}
          />

          <PhoneNumberCard
            jobResult={jobResult}
            showJobCount={true}
            formData={formData}
            errors={errors}
            phoneError={phoneError}
            emailError={emailError}
            phoneNumber={formData.phoneNumber}
            onChange={handleInputChange}
            onPrevious={handlePreviousCard}
            isSubmitDisabled={isSubmitDisabled}
            isSubmitting={isSubmitting}
            isActive={cardStates.isCard8Active}
            showEmailField={true}
            preferPhoneFirst={true}
            submitButtonText="求人情報を受け取る"
            progress={{ currentStep: 7, totalSteps: 7 }}
          />
        </>
      ) : isMechanicNewgrad ? (
        <>
          <MechanicQualificationCard
            selectedQualification={formData.mechanicQualification}
            errors={errors}
            formOrigin={resolvedFormOrigin}
            onSelect={(value) => handleMechanicQualificationSelect(value, true)}
            onNext={handleNextMechanicQualification}
            onPrevious={handlePreviousCard}
            isActive={cardStates.isCard1Active}
            progress={{ currentStep: 1, totalSteps: 5 }}
          />

          <BirthDateCard
            birthDate={formData.birthDate}
            errors={errors}
            onChange={handleInputChange}
            onNext={handleNextCard2}
            onPrevious={handlePreviousCard}
            isActive={cardStates.isCard2Active}
            progress={{ currentStep: 2, totalSteps: 5 }}
          />

          <NameCard
            postalCode={formData.postalCode}
            prefectureId={formData.prefectureId}
            municipalityId={formData.municipalityId}
            errors={errors}
            onChange={handleInputChange}
            onPrevious={handlePreviousCard}
            onNext={handleNextCard3}
            isActive={cardStates.isCard3Active}
            progress={{ currentStep: 3, totalSteps: 5 }}
          />

          <NameInputCard
            formData={formData}
            errors={errors}
            jobResult={jobResult}
            showJobCount={true}
            onChange={handleInputChange}
            onBlur={handleNameBlur}
            onPrevious={handlePreviousCard}
            onNext={handleNextCard4}
            isActive={cardStates.isCard4Active}
            progress={{ currentStep: 4, totalSteps: 5 }}
          />

          <PhoneNumberCard
            jobResult={jobResult}
            showJobCount={true}
            formData={formData}
            errors={errors}
            phoneError={phoneError}
            emailError={emailError}
            phoneNumber={formData.phoneNumber}
            onChange={handleInputChange}
            onPrevious={handlePreviousCard}
            isSubmitDisabled={isSubmitDisabled}
            isSubmitting={isSubmitting}
            isActive={cardStates.isCard5Active}
            showEmailField={true}
            preferPhoneFirst={true}
            submitButtonText="求人情報を受け取る"
            progress={{ currentStep: 5, totalSteps: 5 }}
          />
        </>
      ) : isTruck ? (
        <>
          {/* STEP画像は4段階(STEP1〜4)のため、追加の免許カードは画像なし・見出しのみとし、
              以降の4カードはタクシー(default)と同じSTEP割当を維持する */}
          <TruckLicenseCard
            selectedLicenses={formData.truckLicenses}
            errors={errors}
            onToggle={handleTruckLicenseToggle}
            onNext={handleNextTruckLicense}
            onPrevious={handlePreviousCard}
            isActive={cardStates.isCard2Active}
          />

          <BirthDateCard
            stepImageSrc={resolvedStep1ImageSrc}
            birthDate={formData.birthDate}
            errors={errors}
            onChange={handleInputChange}
            onNext={handleNextCard2}
            onPrevious={handlePreviousCard}
            isActive={cardStates.isCard3Active}
          />

          <NameCard
            stepImageSrc={resolvedStep2ImageSrc}
            postalCode={formData.postalCode}
            prefectureId={formData.prefectureId}
            municipalityId={formData.municipalityId}
            errors={errors}
            onChange={handleInputChange}
            onPrevious={handlePreviousCard}
            onNext={handleNextCard3}
            isActive={cardStates.isCard4Active}
          />

          <NameInputCard
            stepImageSrc={resolvedStep3ImageSrc}
            formData={formData}
            errors={errors}
            jobResult={jobResult}
            showJobCount={true}
            onChange={handleInputChange}
            onBlur={handleNameBlur}
            onPrevious={handlePreviousCard}
            onNext={handleNextCard4}
            isActive={cardStates.isCard5Active}
          />

          <PhoneNumberCard
            stepImageSrc={resolvedStep4ImageSrc || resolvedStep3ImageSrc}
            jobResult={jobResult}
            showJobCount={true}
            formData={formData}
            errors={errors}
            phoneError={phoneError}
            emailError={emailError}
            phoneNumber={formData.phoneNumber}
            onChange={handleInputChange}
            onPrevious={handlePreviousCard}
            isSubmitDisabled={isSubmitDisabled}
            isSubmitting={isSubmitting}
            isActive={cardStates.isCard6Active}
            showEmailField={true}
          />
        </>
      ) : resolvedFormOrigin === 'coupang' ? (
        <>
          <BirthDateCard
            stepImageSrc={resolvedStep1ImageSrc}
            birthDate={formData.birthDate}
            errors={errors}
            onChange={handleInputChange}
            onNext={handleNextCard1}
            isActive={cardStates.isCard1Active}
          />

          <NameCard
            stepImageSrc={resolvedStep2ImageSrc}
            postalCode={formData.postalCode}
            prefectureId={formData.prefectureId}
            municipalityId={formData.municipalityId}
            errors={errors}
            onChange={handleInputChange}
            onPrevious={handlePreviousCard}
            onNext={handleNextCard3}
            isActive={cardStates.isCard2Active}
          />

          <NameAndContactCard
            stepImageSrc={resolvedStep3ImageSrc}
            formData={formData}
            errors={errors}
            jobResult={jobResult}
            showJobCount={false}
            phoneError={phoneError}
            emailError={emailError}
            onChange={handleInputChange}
            onBlur={handleNameBlur}
            onPrevious={handlePreviousCard}
            isSubmitDisabled={isSubmitDisabled}
            isSubmitting={isSubmitting}
            isActive={cardStates.isCard3Active}
            submitButtonText="送信"
          />
        </>
      ) : (
        <>
          <BirthDateCard
            stepImageSrc={resolvedStep1ImageSrc}
            birthDate={formData.birthDate}
            errors={errors}
            onChange={handleInputChange}
            onNext={resolvedEnableJobTimingStep ? handleNextCard2 : handleNextCard1}
            onPrevious={resolvedEnableJobTimingStep ? handlePreviousCard : undefined}
            isActive={resolvedEnableJobTimingStep ? cardStates.isCard2Active : cardStates.isCard1Active}
          />

          <NameCard
            stepImageSrc={resolvedStep2ImageSrc}
            postalCode={formData.postalCode}
            prefectureId={formData.prefectureId}
            municipalityId={formData.municipalityId}
            errors={errors}
            onChange={handleInputChange}
            onPrevious={handlePreviousCard}
            onNext={handleNextCard3}
            isActive={resolvedEnableJobTimingStep ? cardStates.isCard3Active : cardStates.isCard2Active}
          />

          <NameInputCard
            stepImageSrc={resolvedStep3ImageSrc}
            formData={formData}
            errors={errors}
            jobResult={jobResult}
            showJobCount={true}
            onChange={handleInputChange}
            onBlur={handleNameBlur}
            onPrevious={handlePreviousCard}
            onNext={handleNextCard4}
            isActive={resolvedEnableJobTimingStep ? cardStates.isCard4Active : cardStates.isCard3Active}
          />

          <PhoneNumberCard
            stepImageSrc={resolvedStep4ImageSrc || resolvedStep3ImageSrc}
            jobResult={jobResult}
            showJobCount={true}
            formData={formData}
            errors={errors}
            phoneError={phoneError}
            emailError={emailError}
            phoneNumber={formData.phoneNumber}
            onChange={handleInputChange}
            onPrevious={handlePreviousCard}
            isSubmitDisabled={isSubmitDisabled}
            isSubmitting={isSubmitting}
            isActive={resolvedEnableJobTimingStep ? cardStates.isCard5Active : cardStates.isCard4Active}
            showEmailField={true}
          />
        </>
      )}
    </form>
  );

  const modal = (
    <div
      ref={overlayRef}
      className={`fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4 ${resolvedContainerClassName}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="application-form-title"
    >
      {resolvedShowHeader && (
        <header className="fixed top-0 z-[10001] flex w-full justify-center">
          <div className="flex w-full max-w-md items-center justify-between bg-white px-4 py-4">
            <Image src={resolvedHeaderLogoSrc} alt="Ride Job Logo" width={120} height={30} className="h-[30px] w-auto" priority loading="eager" />
            <div className="text-right">
              <p className="text-[11px] text-gray-700 leading-tight">{resolvedHeaderUpperText}</p>
              <p className="text-xs font-bold text-gray-900 leading-tight">{resolvedHeaderLowerText}</p>
            </div>
          </div>
        </header>
      )}

      {resolvedShowLoadingScreen && (
        <div
          id="loading-screen"
          className={`absolute inset-0 flex flex-col items-center justify-center bg-white transition-all duration-700 ease-out z-[10001] ${
            loading ? 'opacity-100 visible' : 'opacity-0 invisible'
          }`}
        >
          <Image src={resolvedLoadingLogoSrc} alt="Ride Job Logo" width={200} height={50} className="w-36 mb-4" />
          <div className="flex space-x-2">
            <div className="w-4 h-4 bg-orange-500 rounded-full animate-bounce" />
            <div className="w-4 h-4 bg-orange-500 rounded-full animate-bounce delay-150" />
            <div className="w-4 h-4 bg-orange-500 rounded-full animate-bounce delay-300" />
          </div>
        </div>
      )}

      <div ref={modalContentRef} className={formWrapperClassName} style={formWrapperStyle}>
        {formContent}
      </div>
      {legalFooter}
      <FormExitModal isOpen={showExitModal} onClose={hideExitModal} onConfirm={confirmExit} variant={exitModalVariant} />
    </div>
  );

  if (resolvedUseModal) {
    if (typeof window === 'undefined') {
      return modal;
    }

    const portalRoot = document.getElementById('modal-root');

    if (portalRoot) {
      return createPortal(modal, portalRoot);
    }

    return modal;
  }

  return (
    <div className={`flex justify-center px-4 ${resolvedContainerClassName}`.trim()}>
      <div className={formWrapperClassName} style={formWrapperStyle}>{formContent}</div>
      {legalFooter}
      <FormExitModal isOpen={showExitModal} onClose={hideExitModal} onConfirm={confirmExit} variant={exitModalVariant} />
    </div>
  );
}

export default function ApplicationForm(props: ApplicationFormProps) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ApplicationFormInner {...props} />
    </Suspense>
  );
}
