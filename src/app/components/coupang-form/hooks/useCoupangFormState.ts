import { apiPath } from '@/lib/basePath';
import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { CoupangFormData, CoupangFormErrors } from '../types';
import {
  validateStep1,
  validateStep2,
  validateStep3,
  validateAllSteps,
} from '../utils/coupangValidators';
import { genEventId, trackMeta } from '@/lib/meta/pixel';
import { COUPANG_META_CONTENT_NAME, COUPANG_FIXED_JOB_POSITION } from '../constants';
import {
  EMPTY_UTM_PARAMS,
  readAttribution,
  resolveUtmParamsWithSource,
  type Attribution,
  type AttributionResolutionSource,
  type UtmParams,
} from '@/lib/attribution';

declare global {
  interface Window {
    dataLayer: Record<string, unknown>[];
  }
}

const initialFormData: CoupangFormData = {
  email: '',
  fullName: '',
  fullNameKana: '',
  phoneNumber: '',
  jobPosition: COUPANG_FIXED_JOB_POSITION,
  desiredLocation: '',
  age: '',
  birthDate: '',
};

export function useCoupangFormState() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<CoupangFormData>(initialFormData);
  const [errors, setErrors] = useState<CoupangFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFormDirty, setIsFormDirty] = useState(false);

  // GTMイベント送信
  const trackEvent = useCallback((eventName: string, params?: Record<string, unknown>) => {
    if (typeof window !== 'undefined' && window.dataLayer) {
      window.dataLayer.push({
        event: eventName,
        ...params,
      });
    }
  }, []);

  // ステップ表示イベント
  useEffect(() => {
    trackEvent('step_view', {
      step_name: `coupang_step_${currentStep}`,
      step_number: currentStep,
    });
  }, [currentStep, trackEvent]);

  // 入力変更ハンドラー
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;

    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData((prev) => ({ ...prev, [name]: checked }));
    } else {
      let processedValue = value;

      // 電話番号のハイフン除去
      if (name === 'phoneNumber') {
        processedValue = value.replace(/[-－ー]/g, '');
      }

      if (name === 'birthDate') {
        processedValue = value.replace(/\D/g, '').slice(0, 8);
      }

      // メールアドレスのスペース除去と小文字化
      if (name === 'email') {
        processedValue = value.replace(/\s/g, '').toLowerCase();
      }

      // ふりがなのバリデーション（変換中は許可）
      if (name === 'fullNameKana') {
        const nativeEvent = e.nativeEvent as (InputEvent & { isComposing?: boolean }) | undefined;
        const isComposing = nativeEvent?.isComposing ?? false;
        const isInsertCompositionText = nativeEvent?.inputType === 'insertCompositionText';

        if (!isComposing && !isInsertCompositionText) {
          processedValue = value.replace(/[^ぁ-んー\s]/g, '');
        }
      }

      setFormData((prev) => {
        if (name === 'jobPosition') {
          return {
            ...prev,
            jobPosition: processedValue,
            desiredLocation: '',
          };
        }

        return { ...prev, [name]: processedValue };
      });
    }

    if (!isFormDirty) {
      setIsFormDirty(true);
    }

    // エラーをクリア
    if (errors[name as keyof CoupangFormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  }, [errors, isFormDirty]);

  // ステップ1の次へ
  const handleNextStep1 = useCallback(() => {
    const validation = validateStep1(formData);
    setErrors(validation.errors);

    if (validation.isValid) {
      trackEvent('step_complete', {
        step_name: 'coupang_step_1',
        step_number: 1,
      });
      setCurrentStep(2);
    }
  }, [formData, trackEvent]);

  // ステップ2の次へ
  const handleNextStep2 = useCallback(() => {
    const validation = validateStep2(formData);
    setErrors(validation.errors);

    if (validation.isValid) {
      trackEvent('step_complete', {
        step_name: 'coupang_step_2',
        step_number: 2,
      });
      setCurrentStep(3);
    }
  }, [formData, trackEvent]);

  // ステップ3の次へ
  const handleNextStep3 = useCallback(() => {
    const validation = validateStep3(formData);
    setErrors(validation.errors);

    if (validation.isValid) {
      trackEvent('step_complete', {
        step_name: 'coupang_step_3',
        step_number: 3,
      });
      setCurrentStep(4);
    }
  }, [formData, trackEvent]);

  // 前のステップへ戻る
  const handlePreviousStep = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  }, []);

  // フォーム送信
  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      if (isSubmitting) {
        return;
      }

      // 最終バリデーション
      const validation = validateAllSteps(formData);
      if (!validation.isValid) {
        setErrors(validation.errors);
        // エラーがある場合、最初のエラーがあるステップに戻る
        if (validation.errors.jobPosition || validation.errors.desiredLocation) {
          setCurrentStep(1);
        } else if (validation.errors.age || validation.errors.birthDate) {
          setCurrentStep(2);
        } else if (validation.errors.fullName || validation.errors.fullNameKana) {
          setCurrentStep(3);
        }
        return;
      }

      setIsSubmitting(true);

      try {
        // LIFT JOB だけ query 直読みになっていたため、共通フォームと同じ
        // query → Cookie → referrer の順で流入元を復元する。Meta のアプリ内ブラウザや
        // 応募時に query が無い場合は、着地時に AttributionCapture が保存した
        // rj_attr から source / medium / campaign / term / content を復元する。
        // utm_creative / utm_id は共有Cookieの互換スキーマに含まれないため、現行の
        // LIFT JOB（同一ページ内で完結）では応募時URLの query から取得する。
        // いずれの場合も、異なる出所の項目は混ぜない。
        // 計測の取得失敗で応募者を落とさないよう、例外時は空のUTMで送信を続ける。
        let attribution: Attribution = {};
        let utmParams: UtmParams = EMPTY_UTM_PARAMS;
        let attributionSource: AttributionResolutionSource = 'direct';
        try {
          attribution = readAttribution();
          ({ utmParams, attributionSource } = resolveUtmParamsWithSource(
            window.location.search,
            attribution,
            document.referrer,
            window.location.host,
          ));
        } catch (error) {
          console.warn('[liftjob-attribution] 流入元の解決に失敗しました（応募送信は継続します）', error);
        }

        // GTMイベント送信
        trackEvent('form_submit', {
          form_name: 'coupang_rocketnow_application',
        });

        // Pixel と CAPI で共有する eventId（重複排除用）
        const metaEventId = genEventId();

        const response = await fetch(apiPath('/api/coupang/applicants'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...formData,
            utmParams,
            metaEventId,
            // Baseの「経路」系フィールドで、UTMだけでなくLPと初回流入元も
            // 確認できるようにする。pageUrl はブラウザ側の実URLなので、
            // Referrer-Policy によりサーバー側 Referer が短縮される場合の保険にもなる。
            pageUrl: window.location.href,
            landingPath: attribution.landing || window.location.pathname,
            initialReferrer: attribution.referrer || document.referrer || '',
            attributionSource,
          }),
        });

        if (!response.ok) {
          const errorResult = await response.json();
          alert(`エラーが発生しました: ${errorResult.message || 'サーバーエラー'}`);
          setIsSubmitting(false);
          return;
        }

        await response.json();
        setIsFormDirty(false);

        // 送信成功時に Meta Lead を発火（サーバーCAPIと同一 eventId で重複排除）。
        // contentName はカスタムコンバージョン「RIDEJOB_クーパン応募」の唯一のルール。
        trackMeta(
          'Lead',
          { value: 0, currency: 'JPY', contentName: COUPANG_META_CONTENT_NAME },
          metaEventId
        );
        // GA4 側にも応募完了を送る。form_name は共通フォームと同じ固定値にし、
        // 職種の分離は job_category で行う（GTMのトリガーが form_name で絞っている場合に
        // クーパンだけCVが落ちるのを避けるため）。
        trackEvent('generate_lead', {
          form_name: 'ridejob_application',
          job_category: 'coupang_sales',
          currency: 'JPY',
          value: 0,
        });

        // サンクスページへ遷移
        router.push('/coupang/applicants/new');
      } catch (error) {
        console.error('Error submitting form:', error);
        alert('フォームの送信中にエラーが発生しました。ネットワーク接続を確認してください。');
        setIsSubmitting(false);
      }
    },
    [formData, isSubmitting, router, trackEvent]
  );

  // 各ステップのアクティブ状態
  const cardStates = {
    isStep1Active: currentStep === 1,
    isStep2Active: currentStep === 2,
    isStep3Active: currentStep === 3,
    isStep4Active: currentStep === 4,
  };

  return {
    currentStep,
    formData,
    errors,
    isSubmitting,
    isFormDirty,
    cardStates,
    handleChange,
    handleNextStep1,
    handleNextStep2,
    handleNextStep3,
    handlePreviousStep,
    handleSubmit,
  };
}
