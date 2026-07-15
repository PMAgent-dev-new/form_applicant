import { apiPath } from '@/lib/basePath';
import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { CoupangFormData, CoupangFormErrors } from '../types';
import {
  validateStep1,
  validateStep2,
  validateStep3,
  validateStep4,
  validateAllSteps,
} from '../utils/coupangValidators';
import { genEventId, trackMeta } from '@/lib/meta/pixel';

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
  jobPosition: '',
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
        // UTMパラメータ取得
        const urlParams = new URLSearchParams(window.location.search);
        const utmParams = {
          utm_source: urlParams.get('utm_source') || undefined,
          utm_medium: urlParams.get('utm_medium') || undefined,
          utm_campaign: urlParams.get('utm_campaign') || undefined,
          utm_term: urlParams.get('utm_term') || undefined,
          utm_creative: urlParams.get('utm_creative') || undefined,
          utm_content: urlParams.get('utm_content') || undefined, // Meta広告: {{ad.name}}（広告名）
          utm_id: urlParams.get('utm_id') || undefined, // Meta広告: {{ad.id}}（広告ID）
        };

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

        // 送信成功時に Meta Lead を発火（サーバーCAPIと同一 eventId で重複排除）
        trackMeta('Lead', { value: 0, currency: 'JPY' }, metaEventId);

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
