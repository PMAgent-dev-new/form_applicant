'use client';

import { useEffect, useRef, useState } from 'react';
import Image from '@/app/components/AppImage';
import { assetPath } from '@/lib/basePath';
import { getUdJobDetailsUrl } from '@/lib/ud-manufacturing';
import { useApplicationFormState } from '@/app/components/application-form/hooks/useApplicationFormState';
import MarketingConsent from '@/app/components/MarketingConsent';
import PrivacyConsent from '@/app/components/PrivacyConsent';
import AdMeasurementConsent from './AdMeasurementConsent';
import { BirthDateCard, NameCard, NameInputCard, PhoneNumberCard, MechanicJobTimingCard } from '@/app/components/application-form/components';
import { mapJobTimingLabel } from '@/app/components/application-form/utils/mapJobTimingLabel';
import './ud.css';

const noPreload: string[] = [];

export default function UdApplicationForm({ jobId }: { jobId: string }) {
  const state = useApplicationFormState({ showLoadingScreen: false, imagesToPreload: noPreload,
    variant: 'A', formOrigin: 'ud_manufacturing', enableJobTimingStep: true, fixedJobId: jobId });
  const [confirming, setConfirming] = useState(false);
  const [locationLabels, setLocationLabels] = useState({ prefecture: '', municipality: '' });
  const { formData, errors, cardStates } = state;
  const step = [cardStates.isCard1Active, cardStates.isCard2Active, cardStates.isCard3Active,
    cardStates.isCard4Active, cardStates.isCard5Active].findIndex(Boolean) + 1;
  const formArea = useRef<HTMLDivElement>(null);
  useEffect(() => { formArea.current?.focus({ preventScroll: true }); }, [step, confirming]);
  const progress = { currentStep: step, totalSteps: 5 };
  return <div className="ud-page">
    <header className="ud-header"><Image src="/ud/ridejob-logo.png" alt="RIDE JOB ライドジョブ" width={130} height={38} />
      <div>UDトラックス・上尾工場<strong>製造・組立スタッフ</strong></div></header>
    <main className="ud-stage" style={{ backgroundImage: `linear-gradient(#15202788,#15202788),url(${assetPath('/ud/ud-careers-hero.jpg')})` }}>
      <div className="ud-shell">
        <section className="ud-context" aria-label="今回の応募対象">
          <h1>未経験から、UDトラックスで。</h1>
          <p className="ud-tags"><strong>未経験OK</strong><span>正社員</span><span>埼玉県上尾市</span></p>
          <p className="ud-location"><strong>勤務地は埼玉県上尾市の工場です。</strong><br />車・バイク通勤可。上尾駅から無料送迎バスがあります。</p>
          <p className="ud-location"><strong>遠方で通勤が難しい方は、転居を伴う勤務です。</strong><br />寮・社宅あり（持ち家がなく、通勤に1時間30分以上かかる方が対象）。住居の種類・費用などの適用条件は、担当者がご案内します。</p>
          <p>対象：35歳以下<br />（長期勤続によるキャリア形成のため）</p>
          <details><summary>応募先・受付について</summary><p>勤務先：UDトラックス株式会社 上尾工場<br />職種：製造・組立スタッフ<br />応募受付：RIDE JOB（株式会社PM Agentの人材紹介）</p>
            <a href={getUdJobDetailsUrl(jobId)} target="_blank" rel="noopener noreferrer">求人詳細を確認する</a></details>
        </section>
        <div ref={formArea} tabIndex={-1} className="ud-form-area" aria-label={confirming ? '入力内容の確認' : `入力ステップ${step}`}>
          <form onSubmit={event => {
            if (step !== 5) { event.preventDefault(); return; }
            if (!confirming) { event.preventDefault(); if (!state.isSubmitDisabled) setConfirming(true); return; }
            void state.handleSubmit(event);
          }} noValidate>
            {confirming ? <section className="ud-confirm">
              <h2>入力内容の確認</h2>
              <dl>{[
                ['就業時期', mapJobTimingLabel(formData.jobTiming, 'ud_manufacturing')],
                ['生年月日', formData.birthDate.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1年$2月$3日')],
                ['居住地', formData.prefectureId ? `${locationLabels.prefecture} ${locationLabels.municipality}` : `〒${formData.postalCode}`],
                ['氏名', `${formData.fullName}（${formData.fullNameKana}）`],
                ['電話番号', formData.phoneNumber], ['メール', formData.email],
              ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
              <p>応募はRIDE JOB（人材紹介）が受け付けます。</p>
              <PrivacyConsent consent={state.privacyConsent} disabled={state.isSubmitting} policyHref={assetPath('/ud-manufacturing/policy')} />
              <MarketingConsent consent={state.marketingConsent} disabled={state.isSubmitting} />
              <AdMeasurementConsent checked={state.udAdConsentChecked} onChange={state.setUdAdConsentChecked} disabled={state.isSubmitting} />
              <button className="ud-primary" type="submit" disabled={state.isSubmitting || state.isSubmitDisabled || !state.privacyConsent.checked}>{state.isSubmitting ? '送信中…' : 'この内容で応募する'}</button>
              <button className="ud-back" type="button" disabled={state.isSubmitting} onClick={() => setConfirming(false)}>入力内容を修正する</button>
            </section> : <>
              {step === 1 && <MechanicJobTimingCard selectedTiming={formData.jobTiming} errors={errors} onSelect={value => state.handleMechanicJobTimingSelect(value)} onNext={state.handleNextMechanicJobTiming} isActive progress={progress} />}
              {step === 2 && <BirthDateCard heading="生年月日を教えてください" birthDate={formData.birthDate} errors={errors} onChange={state.handleInputChange} onNext={state.handleNextCard2} onPrevious={state.handlePreviousCard} isActive progress={progress} />}
              {step === 3 && <NameCard heading="お住まいを教えてください" postalCode={formData.postalCode} prefectureId={formData.prefectureId} municipalityId={formData.municipalityId} errors={errors} onChange={event => {
                if (event.target instanceof HTMLSelectElement) {
                  const label = event.target.selectedOptions[0]?.text || '';
                  if (event.target.name === 'prefectureId') setLocationLabels({ prefecture: label, municipality: '' });
                  if (event.target.name === 'municipalityId') setLocationLabels(old => ({ ...old, municipality: label }));
                }
                state.handleInputChange(event);
              }} onPrevious={state.handlePreviousCard} onNext={state.handleNextCard3} isActive progress={progress} />}
              {step === 4 && <NameInputCard formData={formData} errors={errors} jobResult={state.jobResult} showJobCount={false} onChange={state.handleInputChange} onBlur={state.handleNameBlur} onPrevious={state.handlePreviousCard} onNext={state.handleNextCard4} isActive progress={progress} />}
              {step === 5 && <PhoneNumberCard formData={formData} errors={errors} jobResult={state.jobResult} showJobCount={false} phoneNumber={formData.phoneNumber} phoneError={state.phoneError} emailError={state.emailError} onChange={state.handleInputChange} onPrevious={state.handlePreviousCard} isSubmitDisabled={state.isSubmitDisabled} isSubmitting={state.isSubmitting} showEmailField preferPhoneFirst submitButtonText="入力内容を確認する" isActive progress={progress} />}
            </>}
          </form>
        </div>
      </div>
    </main>
    <footer className="ud-footer">応募受付：RIDE JOB（株式会社PM Agent／人材紹介）<br /><a href="https://www.pmagent.jp/" target="_blank" rel="noopener noreferrer">会社概要</a> ｜ <a href={assetPath('/ud-manufacturing/policy')} target="_blank" rel="noopener noreferrer">プライバシーポリシー</a></footer>
    {state.showExitModal && <div className="ud-dialog" role="dialog" aria-modal="true" aria-labelledby="ud-exit-title"><div><h2 id="ud-exit-title">入力を中断しますか？</h2><p>まだ応募は送信されていません。</p><button className="ud-primary" type="button" onClick={state.hideExitModal}>入力に戻る</button><button className="ud-back" type="button" onClick={state.confirmExit}>中断する</button></div></div>}
  </div>;
}
