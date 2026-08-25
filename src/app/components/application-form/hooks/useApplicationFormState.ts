'use client';

import { apiPath } from '@/lib/basePath';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { FormData, FormErrors, FormOrigin, JobCountResult, PeopleImageVariant, TruckLicense } from '../types';
import { useHiraganaConverter } from './useHiraganaConverter';
import { useFormExitGuard } from './useFormExitGuard';
import { useImagePreloader } from './useImagePreloader';
import { trackEvent } from '../utils/trackEvent';
import { genEventId, trackMeta } from '@/lib/meta/pixel';
import { isValidEmail, isValidPhoneNumber, validateBirthDateCard, validateCard2, validateDesiredIncome, validateFinalStep, validateJobTiming, validateMechanicQualification, validateNameFields, validateTruckLicenses } from '../utils/validators';
import { fetchJobCount, type JobCountParams } from '../utils/fetchJobCount';
import { notifyInvalidPhoneNumber } from '../utils/notifyInvalidPhoneNumber';
import { EMPTY_UTM_PARAMS, readAttribution, resolveUtmParams, type UtmParams } from '@/lib/attribution';

type UseApplicationFormStateParams = {
  showLoadingScreen: boolean;
  imagesToPreload: string[];
  variant: PeopleImageVariant;
  formOrigin: FormOrigin;
  enableJobTimingStep: boolean;
};

const initialFormData: FormData = {
  jobIntent: '',
  jobTiming: '',
  desiredIncome: '',
  birthDate: '',
  fullName: '',
  fullNameKana: '',
  postalCode: '',
  prefectureId: '',
  municipalityId: '',
  phoneNumber: '',
  email: '',
  mechanicQualification: '',
  truckLicenses: [],
};

export function useApplicationFormState({ showLoadingScreen, imagesToPreload, variant, formOrigin, enableJobTimingStep }: UseApplicationFormStateParams) {
  const router = useRouter();
  const isMechanic = formOrigin === 'mechanic';
  const isMechanicNewgrad = formOrigin === 'mechanic_newgrad';
  const isMechanicLike = isMechanic || isMechanicNewgrad;
  const isTruck = formOrigin === 'truck';
  const [loading, setLoading] = useState(showLoadingScreen);
  const [currentCardIndex, setCurrentCardIndex] = useState(1);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [errors, setErrors] = useState<FormErrors>({});
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isSubmitDisabled, setIsSubmitDisabled] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<{ type: 'history-back' } | null>(null);
  const [exitModalVariant, setExitModalVariant] = useState<'default' | 'phone'>('default');
  const [jobResult, setJobResult] = useState<JobCountResult>({ jobCount: null, message: '', isLoading: false, error: '' });

  const markFormClean = useCallback(() => {
    setIsFormDirty(false);
  }, []);

  useImagePreloader({ images: imagesToPreload, onComplete: () => setLoading(false), enable: showLoadingScreen });
  useFormExitGuard({
    isFormDirty,
    currentCardIndex,
    setShowExitModal,
    markFormClean,
    setPendingNavigation,
    setExitModalVariant,
    phoneCardIndex: isMechanic ? 8 : isMechanicNewgrad ? 5 : formOrigin === 'coupang' ? 3 : isTruck ? 6 : enableJobTimingStep ? 5 : 4,
  });

  const getStepNumber = useCallback(
    (cardIndex: number) => cardIndex,
    []
  );

  const getStepEventPayload = useCallback(
    (cardIndex: number) => {
      const stepNumber = getStepNumber(cardIndex);
      return {
        step_name: `step_${stepNumber}`,
        step_number: stepNumber,
      };
    },
    [getStepNumber]
  );

  const hideExitModal = useCallback(() => {
    setShowExitModal(false);
    setPendingNavigation(null);
    setExitModalVariant('default');
  }, []);

  const confirmExit = useCallback(() => {
    if (!pendingNavigation) {
      setShowExitModal(false);
      return;
    }

    setShowExitModal(false);
    markFormClean();
    const navigation = pendingNavigation;
    setPendingNavigation(null);
    setExitModalVariant('default');

    if (navigation.type === 'history-back') {
      if (typeof window !== 'undefined') {
        window.history.back();
      }
    }
  }, [pendingNavigation, markFormClean, setExitModalVariant]);

  useEffect(() => {
    trackEvent('experiment_impression', { experiment: 'people_image', variant });
    trackEvent('step_view', getStepEventPayload(1));
  }, [variant, getStepEventPayload]);

  const { convert: hiraganaConverter, warmUp: warmUpHiragana } = useHiraganaConverter();

  // フォームに最初に触れた時点で、サーバー側(/api/hiragana)の辞書初期化を起こす。
  // 氏名カードに着くまで20〜60秒あるので、blur 時にはウォームになっている。
  // 何もせず離脱する訪問者はリクエストを1本も出さない。
  useEffect(() => {
    if (isFormDirty) warmUpHiragana();
  }, [isFormDirty, warmUpHiragana]);

  const loadJobCount = useCallback(async (params: Partial<JobCountParams>) => {
    const hasPostal = typeof params.postalCode === 'string' && params.postalCode.trim().length > 0;
    const hasPref = typeof params.prefectureId === 'string' && params.prefectureId.trim().length > 0;
    const jobCategoryIds = isMechanicLike ? ['3', '10'] : undefined;

    if (!hasPostal && !hasPref) {
      setJobResult({ jobCount: null, message: '', isLoading: false, error: '' });
      return;
    }
    setJobResult((prev) => ({ ...prev, isLoading: true, error: '' }));
    try {
      const result = await fetchJobCount(
        hasPostal
          ? { postalCode: params.postalCode as string, jobCategoryIds }
          : { prefectureId: params.prefectureId as string, jobCategoryIds }
      );
      setJobResult({
        jobCount: result.jobCount,
        message: result.message,
        isLoading: false,
        error: result.error ?? '',
        searchMethod: result.searchMethod,
        searchArea: result.searchArea,
        prefectureName: result.prefectureName,
        prefectureId: result.prefectureId,
      });
    } catch (error) {
      console.error('Error fetching job count:', error);
      setJobResult({ jobCount: null, message: '', isLoading: false, error: '求人件数の取得中にエラーが発生しました' });
    }
  }, [isMechanicLike]);

  const isSubmitReady = useCallback(
    (phoneNumber: string, email: string) => {
      const trimmedPhone = phoneNumber.trim();
      if (trimmedPhone.length !== 11 || !isValidPhoneNumber(trimmedPhone)) {
        return false;
      }
      // coupangとmechanic系はメールアドレス必須
      if (formOrigin === 'coupang' || isMechanicLike) {
        const trimmedEmail = email.trim();
        if (!trimmedEmail) {
          return false;
        }
        return isValidEmail(trimmedEmail);
      }
      return true;
    },
    [formOrigin, isMechanicLike]
  );

  const validatePhoneNumberInput = useCallback(
    (phoneNumber: string) => {
      const trimmed = phoneNumber.trim();
      if (trimmed.length < 11) {
        setPhoneError(null);
        setIsSubmitDisabled(true);
        return;
      }
      if (!isValidPhoneNumber(trimmed)) {
        setPhoneError('有効な携帯番号を入力してください。');
        setIsSubmitDisabled(true);
        notifyInvalidPhoneNumber({ fullName: formData.fullName, phoneNumber: trimmed });
      } else {
        setPhoneError(null);
        const submitReady = isSubmitReady(trimmed, formData.email);
        setIsSubmitDisabled(!submitReady);
      }
    },
    [formData.email, formData.fullName, isSubmitReady]
  );

  const validateEmailInput = useCallback(
    (email: string) => {
      if (formOrigin !== 'coupang' && !isMechanicLike) {
        return;
      }
      const trimmed = email.trim();
      if (!trimmed) {
        setEmailError('メールアドレスを入力してください。');
        setIsSubmitDisabled(true);
        return;
      }
      if (!isValidEmail(trimmed)) {
        setEmailError('有効なメールアドレスを入力してください。');
        setIsSubmitDisabled(true);
        return;
      }
      setEmailError(null);
      const submitReady = isSubmitReady(formData.phoneNumber, trimmed);
      setIsSubmitDisabled(!submitReady);
    },
    [formData.phoneNumber, formOrigin, isMechanicLike, isSubmitReady]
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const { name } = event.target;
      let { value } = event.target as HTMLInputElement & { value: string };

      if (name === 'phoneNumber') {
        value = value.replace(/[-－ー]/g, '');
      }

      if (name === 'email') {
        value = value.replace(/\s/g, '').toLowerCase();
      }

      if (name === 'birthDate') {
        value = value.replace(/\D/g, '').slice(0, 8);
      }

      if (name === 'fullNameKana') {
        const nativeEvent = event.nativeEvent as (InputEvent & { isComposing?: boolean }) | undefined;
        const isComposing = nativeEvent?.isComposing ?? false;
        const isInsertCompositionText = nativeEvent?.inputType === 'insertCompositionText';

        if (!isComposing && !isInsertCompositionText) {
          value = value.replace(/[^ぁ-んー\s]/g, '');
        }
      }

      setFormData((prev) => {
        if (name === 'jobTiming') {
          return {
            ...prev,
            jobTiming: value as FormData['jobTiming'],
          };
        }

        if (name === 'email') {
          return {
            ...prev,
            email: value,
          };
        }

        if (name === 'prefectureId') {
          return {
            ...prev,
            prefectureId: value,
            municipalityId: '',
            postalCode: '',
          };
        }

        if (name === 'municipalityId') {
          return {
            ...prev,
            municipalityId: value,
            postalCode: '',
          };
        }

        if (name === 'postalCode') {
          return {
            ...prev,
            postalCode: value,
            prefectureId: '',
            municipalityId: '',
          };
        }

        return { ...prev, [name]: value };
      });

      if (!isFormDirty) setIsFormDirty(true);

      setErrors((prev) => {
        const next = { ...prev };
        if (name === 'birthDate') {
          // 8桁そろった時点で実在日・年齢(18〜84歳)を即時判定する（携帯番号の即時判定と同じUX）
          next.birthDate = value.length === 8 ? validateBirthDateCard(value).errors.birthDate ?? '' : '';
        } else if (name === 'jobTiming') {
          next.jobTiming = '';
        } else if (name === 'email') {
          next.email = '';
        } else if (name === 'prefectureId') {
          next.prefectureId = '';
          next.municipalityId = '';
          next.postalCode = '';
        } else if (name === 'municipalityId') {
          next.municipalityId = '';
          next.postalCode = '';
        } else if (name === 'postalCode') {
          next.postalCode = '';
          next.prefectureId = '';
          next.municipalityId = '';
        } else if (name in next) {
          next[name as keyof FormErrors] = '';
        }
        return next;
      });

      if (name === 'fullName') {
        // 氏名の入力が始まったらサーバー側の辞書初期化を起こす（保険）。
        // isFormDirty 起点で既に走っていることが多い。フック側で1回に絞っているので
        // 毎キーストロークで呼んでもリクエストは1本しか出ない。
        warmUpHiragana();
      }

      if (name === 'phoneNumber') {
        validatePhoneNumberInput(value);
      }

      if (name === 'email') {
        validateEmailInput(value);
      }

      if (name === 'postalCode') {
        if (value.length === 7 && formOrigin !== 'coupang') {
          loadJobCount({ postalCode: value });
        } else {
          setJobResult({ jobCount: null, message: '', isLoading: false, error: '' });
        }
      } else if (name === 'prefectureId') {
        if (value) {
          loadJobCount({ prefectureId: value });
        } else {
          setJobResult({ jobCount: null, message: '', isLoading: false, error: '' });
        }
      }
    },
    [formOrigin, isFormDirty, loadJobCount, validateEmailInput, validatePhoneNumberInput, warmUpHiragana]
  );

  const handleNameBlur = useCallback(
    async (event: React.FocusEvent<HTMLInputElement>) => {
      const { name, value } = event.target;
      if (name === 'fullName' && value.trim()) {
        const hiragana = await hiraganaConverter(value);
        if (hiragana) {
          setFormData((prev) => (prev.fullNameKana ? prev : { ...prev, fullNameKana: hiragana }));
        }
      }
    },
    [hiraganaConverter]
  );

  const handleNextCard1 = useCallback(
    (jobTimingValue?: FormData['jobTiming']) => {
      if (enableJobTimingStep) {
        const value = jobTimingValue ?? formData.jobTiming;
        const result = validateJobTiming(value);
        setErrors(result.errors);
        if (result.isValid) {
          setCurrentCardIndex((prev) => {
            trackEvent('step_complete', getStepEventPayload(prev));
            const next = prev + 1;
            trackEvent('step_view', getStepEventPayload(next));
            return next;
          });
        }
      } else {
        const result = validateBirthDateCard(formData.birthDate);
        setErrors(result.errors);
        if (result.isValid) {
          setCurrentCardIndex((prev) => {
            trackEvent('step_complete', getStepEventPayload(prev));
            const next = prev + 1;
            trackEvent('step_view', getStepEventPayload(next));
            return next;
          });
        }
      }
    }, [enableJobTimingStep, formData.birthDate, formData.jobTiming, getStepEventPayload]);

  const handleJobTimingSelect = useCallback(
    (value: FormData['jobTiming']) => {
      if (!enableJobTimingStep) return;
      setFormData((prev) => ({ ...prev, jobTiming: value }));
      setErrors((prev) => ({ ...prev, jobTiming: '' }));
      if (!isFormDirty) {
        setIsFormDirty(true);
      }
      handleNextCard1(value);
    },
    [enableJobTimingStep, handleNextCard1, isFormDirty]
  );

  const handleMechanicQualificationSelect = useCallback(
    (value: FormData['mechanicQualification'], autoAdvance = false) => {
      setFormData((prev) => ({ ...prev, mechanicQualification: value }));
      setErrors((prev) => ({ ...prev, mechanicQualification: '' }));
      if (!isFormDirty) {
        setIsFormDirty(true);
      }
      if (autoAdvance) {
        setCurrentCardIndex((prev) => {
          trackEvent('step_complete', getStepEventPayload(prev));
          const next = prev + 1;
          trackEvent('step_view', getStepEventPayload(next));
          return next;
        });
      }
    },
    [getStepEventPayload, isFormDirty]
  );

  // トラックLPの保有免許トグル。'none'(免許なし)は他の選択肢と排他にする。
  const handleTruckLicenseToggle = useCallback(
    (value: TruckLicense) => {
      setFormData((prev) => {
        const current = prev.truckLicenses;
        let next: TruckLicense[];
        if (current.includes(value)) {
          next = current.filter((license) => license !== value);
        } else if (value === 'none') {
          next = ['none'];
        } else {
          next = [...current.filter((license) => license !== 'none'), value];
        }
        return { ...prev, truckLicenses: next };
      });
      setErrors((prev) => ({ ...prev, truckLicenses: '' }));
      if (!isFormDirty) {
        setIsFormDirty(true);
      }
    },
    [isFormDirty]
  );

  const handleNextTruckLicense = useCallback(() => {
    const result = validateTruckLicenses(formData.truckLicenses);
    setErrors((prev) => ({ ...prev, ...result.errors }));
    if (!result.isValid) {
      return;
    }
    setCurrentCardIndex((prev) => {
      trackEvent('step_complete', getStepEventPayload(prev));
      const next = prev + 1;
      trackEvent('step_view', getStepEventPayload(next));
      return next;
    });
  }, [formData.truckLicenses, getStepEventPayload]);

  const handleJobIntentSelect = useCallback(
    (value: FormData['jobIntent']) => {
      setFormData((prev) => ({ ...prev, jobIntent: value }));
      setErrors((prev) => ({ ...prev, jobIntent: '' }));
      if (!isFormDirty) {
        setIsFormDirty(true);
      }
      setCurrentCardIndex((prev) => {
        trackEvent('step_complete', getStepEventPayload(prev));
        const next = prev + 1;
        trackEvent('step_view', getStepEventPayload(next));
        return next;
      });
    },
    [getStepEventPayload, isFormDirty]
  );

  const handleMechanicJobTimingSelect = useCallback(
    (value: FormData['jobTiming'], autoAdvance = false) => {
      setFormData((prev) => ({ ...prev, jobTiming: value }));
      setErrors((prev) => ({ ...prev, jobTiming: '' }));
      if (!isFormDirty) {
        setIsFormDirty(true);
      }
      if (autoAdvance) {
        setCurrentCardIndex((prev) => {
          trackEvent('step_complete', getStepEventPayload(prev));
          const next = prev + 1;
          trackEvent('step_view', getStepEventPayload(next));
          return next;
        });
      }
    },
    [getStepEventPayload, isFormDirty]
  );

  const handleDesiredIncomeSelect = useCallback(
    (value: FormData['desiredIncome'], autoAdvance = false) => {
      setFormData((prev) => ({ ...prev, desiredIncome: value }));
      setErrors((prev) => ({ ...prev, desiredIncome: '' }));
      if (!isFormDirty) {
        setIsFormDirty(true);
      }
      if (autoAdvance) {
        setCurrentCardIndex((prev) => {
          trackEvent('step_complete', getStepEventPayload(prev));
          const next = prev + 1;
          trackEvent('step_view', getStepEventPayload(next));
          return next;
        });
      }
    },
    [getStepEventPayload, isFormDirty]
  );

  const handleNextMechanicQualification = useCallback(() => {
    const result = validateMechanicQualification(formData.mechanicQualification);
    setErrors(result.errors);
    if (!result.isValid) {
      return;
    }
    setCurrentCardIndex((prev) => {
      trackEvent('step_complete', getStepEventPayload(prev));
      const next = prev + 1;
      trackEvent('step_view', getStepEventPayload(next));
      return next;
    });
  }, [formData.mechanicQualification, getStepEventPayload]);

  const handleNextMechanicJobTiming = useCallback(() => {
    const result = validateJobTiming(formData.jobTiming);
    setErrors(result.errors);
    if (!result.isValid) {
      return;
    }
    setCurrentCardIndex((prev) => {
      trackEvent('step_complete', getStepEventPayload(prev));
      const next = prev + 1;
      trackEvent('step_view', getStepEventPayload(next));
      return next;
    });
  }, [formData.jobTiming, getStepEventPayload]);

  const handleNextDesiredIncome = useCallback(() => {
    const result = validateDesiredIncome(formData.desiredIncome);
    setErrors(result.errors);
    if (!result.isValid) {
      return;
    }
    setCurrentCardIndex((prev) => {
      trackEvent('step_complete', getStepEventPayload(prev));
      const next = prev + 1;
      trackEvent('step_view', getStepEventPayload(next));
      return next;
    });
  }, [formData.desiredIncome, getStepEventPayload]);

  const handleNextCard2 = useCallback(() => {
    const result = validateBirthDateCard(formData.birthDate);
    setErrors(result.errors);
    if (result.isValid) {
      setCurrentCardIndex((prev) => {
        trackEvent('step_complete', getStepEventPayload(prev));
        const next = prev + 1;
        trackEvent('step_view', getStepEventPayload(next));
        return next;
      });
    }
  }, [formData.birthDate, getStepEventPayload]);

  const handleNextCard3 = useCallback(() => {
    const result = validateCard2(formData);
    setErrors(result.errors);
    if (result.isValid) {
      setCurrentCardIndex((prev) => {
        trackEvent('step_complete', getStepEventPayload(prev));
        const next = prev + 1;
        trackEvent('step_view', getStepEventPayload(next));
        return next;
      });
      if (formOrigin !== 'coupang') {
        if (formData.prefectureId) {
          loadJobCount({ prefectureId: formData.prefectureId });
        } else if (formData.postalCode.length === 7) {
          loadJobCount({ postalCode: formData.postalCode });
        }
      }
    }
  }, [formData, formOrigin, loadJobCount, getStepEventPayload]);

  const handleNextCard4 = useCallback(() => {
    const nameValidation = validateNameFields(formData);
    setErrors(nameValidation.errors);
    if (nameValidation.isValid) {
      setCurrentCardIndex((prev) => {
        trackEvent('step_complete', getStepEventPayload(prev));
        const next = prev + 1;
        trackEvent('step_view', getStepEventPayload(next));
        return next;
      });
    }
  }, [formData, getStepEventPayload]);

  const handlePreviousCard = useCallback(() => {
    setCurrentCardIndex((prev) => {
      const next = Math.max(prev - 1, 1);
      if (next !== prev) {
        trackEvent('step_view', getStepEventPayload(next));
      }
      return next;
    });
  }, [getStepEventPayload]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isSubmitting) {
        return;
      }
      const nameValidation = validateNameFields(formData);
      if (!nameValidation.isValid) {
        setErrors((prev) => ({ ...prev, ...nameValidation.errors }));
        setIsSubmitDisabled(true);
        return;
      }
      const finalValidation = validateFinalStep(formData, formOrigin === 'coupang' || isMechanicLike);
      if (!finalValidation.isValid) {
        setErrors((prev) => ({ ...prev, ...finalValidation.errors }));
        setIsSubmitDisabled(true);
        return;
      }
      setIsSubmitting(true);
      trackEvent('form_submit', { form_name: 'ridejob_application' });

      try {
        // 流入元は query → Cookie → referrer の順で決める。
        //
        // 以前は query だけを見ていたため、UTMを持たない流入（自社YouTube・自然検索・
        // 他サイトからのリンク）が全部「直接アクセス」に落ちていた。
        // query があるときはそれを丸ごと正とするので、広告の帰属は一切変わらない。
        // 詳細と判断の根拠は lib/attribution.ts のコメントを参照。
        //
        // utm_content / utm_id は Meta広告の {{ad.name}} / {{ad.id}} が入る（query 経由のみ）。
        //
        // ⚠️ 例外を外へ出さない。ここは送信処理の try の中なので、throw すると catch が
        // 「ネットワーク接続を確認してください」という**事実と違う**alertを出して送信を中止する。
        // 全項目を入力し終えた応募者を、計測用コードの都合で失うことになる。
        // 流入元が取れなくても応募は必ず通す。
        let utmParams: UtmParams;
        try {
          utmParams = resolveUtmParams(
            window.location.search,
            readAttribution(),
            document.referrer,
            window.location.host,
          );
        } catch (e) {
          console.warn('[attribution] 流入元の解決に失敗しました（送信は継続します）', e);
          utmParams = EMPTY_UTM_PARAMS;
        }

        const birthDateString = formData.birthDate.length === 8
          ? `${formData.birthDate.slice(0, 4)}-${formData.birthDate.slice(4, 6)}-${formData.birthDate.slice(6, 8)}`
          : '';

        const { fetchPrefectureName, fetchMunicipalityName } = await import('@/lib/locationClient');
        let prefectureName = formData.prefectureId ? await fetchPrefectureName(formData.prefectureId) : '';
        let municipalityName = formData.municipalityId
          ? await fetchMunicipalityName(formData.municipalityId)
          : '';
        let townName = '';

        // 郵便番号が入力されている場合、ZipCloud APIから住所情報を取得
        if (formData.postalCode && !formData.prefectureId && !formData.municipalityId) {
          const { fetchAddressByZipcode } = await import('@/lib/zipcloud');
          const addressInfo = await fetchAddressByZipcode(formData.postalCode);
          if (addressInfo) {
            prefectureName = addressInfo.prefectureName || '';
            municipalityName = addressInfo.municipalityName || '';
            townName = addressInfo.townName || '';
          }
        }

        const metaEventId = genEventId();
        const body = {
          ...formData,
          birthDate: birthDateString,
          prefectureName,
          municipalityName,
          townName,
          utmParams,
          experiment: { name: 'people_image', variant },
          formOrigin,
          metaEventId,
        } as Record<string, unknown>;

        const response = await fetch(apiPath('/api/applicants'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
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
        // GA4 側にも GA4 推奨イベント名で応募完了を送る。GTM で generate_lead タグを作り
        // GA4 のキーイベントに登録すると、チャネル別のCVとして集計できるようになる。
        // （従来は step_view / form_submit しか無く、CV が別プロパティ側にしか無かった）
        trackEvent('generate_lead', {
          form_name: 'ridejob_application',
          job_category: isMechanicLike ? 'mechanic' : isTruck ? 'truck' : 'taxi',
          currency: 'JPY',
          value: 0,
        });

        // 都道府県IDとお名前をlocalStorageに保存（サンクスページで求人表示・パーソナライズ用）
        if (typeof window !== 'undefined') {
          // 都道府県IDを保存（formDataまたはjobResultから取得）
          const prefectureIdToSave = formData.prefectureId || jobResult.prefectureId;

          if (prefectureIdToSave) {
            localStorage.setItem('ridejob_prefecture_id', prefectureIdToSave);
          }

          if (formData.fullName) {
            localStorage.setItem('ridejob_user_name', formData.fullName);
          }
        }
        
        const targetPath = isMechanicLike
          ? '/mechanic/applicants/new'
          : formOrigin === 'coupang'
            ? '/coupang/applicants/new'
            : formOrigin === 'bus'
              ? '/bus/applicants/new'
              : formOrigin === 'truck'
                ? '/truck/applicants/new'
                : '/applicants/new';
        router.push(targetPath);
      } catch (error) {
        console.error('Error submitting form:', error);
        alert('フォームの送信中にエラーが発生しました。ネットワーク接続を確認してください。');
        setIsSubmitting(false);
      }
    },
    [formData, formOrigin, isMechanicLike, isTruck, router, variant, isSubmitting, jobResult.prefectureId]
  );

  const cardStates = useMemo(
    () => {
      if (formOrigin === 'mechanic') {
        // mechanic: 8ステップ (Intent, Qualification, JobTiming, DesiredIncome, BirthDate, PostalCode, Name, Contact)
        return {
          isCard1Active: currentCardIndex === 1,
          isCard2Active: currentCardIndex === 2,
          isCard3Active: currentCardIndex === 3,
          isCard4Active: currentCardIndex === 4,
          isCard5Active: currentCardIndex === 5,
          isCard6Active: currentCardIndex === 6,
          isCard7Active: currentCardIndex === 7,
          isCard8Active: currentCardIndex === 8,
        };
      }

      if (formOrigin === 'mechanic_newgrad') {
        // mechanic_newgrad: 5カード (Qualification, BirthDate, PostalCode, Name, Contact)
        return {
          isCard1Active: currentCardIndex === 1,
          isCard2Active: currentCardIndex === 2,
          isCard3Active: currentCardIndex === 3,
          isCard4Active: currentCardIndex === 4,
          isCard5Active: currentCardIndex === 5,
          isCard6Active: false,
          isCard7Active: false,
          isCard8Active: false,
        };
      }

      if (formOrigin === 'coupang') {
        // coupang: 3ステップ (BirthDate, NameCard, NameAndContact)
        return {
          isCard1Active: currentCardIndex === 1,
          isCard2Active: currentCardIndex === 2,
          isCard3Active: currentCardIndex === 3,
          isCard4Active: false,
          isCard5Active: false,
          isCard6Active: false,
          isCard7Active: false,
          isCard8Active: false,
        };
      }

      if (formOrigin === 'truck') {
        // truck: 6カード (JobTiming, TruckLicense, BirthDate, PostalCode, Name, Contact)
        return {
          isCard1Active: currentCardIndex === 1,
          isCard2Active: currentCardIndex === 2,
          isCard3Active: currentCardIndex === 3,
          isCard4Active: currentCardIndex === 4,
          isCard5Active: currentCardIndex === 5,
          isCard6Active: currentCardIndex === 6,
          isCard7Active: false,
          isCard8Active: false,
        };
      }

      if (enableJobTimingStep) {
        return {
          isCard1Active: currentCardIndex === 1,
          isCard2Active: currentCardIndex === 2,
          isCard3Active: currentCardIndex === 3,
          isCard4Active: currentCardIndex === 4,
          isCard5Active: currentCardIndex === 5,
          isCard6Active: false,
          isCard7Active: false,
          isCard8Active: false,
        };
      }

      return {
        isCard1Active: currentCardIndex === 1,
        isCard2Active: currentCardIndex === 2,
        isCard3Active: currentCardIndex === 3,
        isCard4Active: currentCardIndex === 4,
        isCard5Active: false,
        isCard6Active: false,
        isCard7Active: false,
        isCard8Active: false,
      };
    },
    [currentCardIndex, enableJobTimingStep, formOrigin]
  );

  return {
    loading,
    cardStates,
    formData,
    errors,
    phoneError,
    emailError,
    isSubmitDisabled,
    isSubmitting,
    showExitModal,
    jobResult,
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
    markFormClean,
  };
}
