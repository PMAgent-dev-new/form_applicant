export type FormPreset = 'default' | 'bus' | 'coupang' | 'mechanic' | 'mechanic_newgrad' | 'truck';

export interface FormPresetConfig {
  // Visual settings
  headerLogoSrc: string;
  headerUpperText: string;
  headerLowerText: string;
  loadingLogoSrc: string;

  // Step images
  step1ImageSrc: string;
  step2ImageSrc: string;
  step3ImageSrc: string;
  step4ImageSrc?: string;
  step5ImageSrc?: string;

  // Feature flags
  showHeader: boolean;
  showLoadingScreen: boolean;
  showFooterLogo: boolean;
  showBottomImage: boolean;
  enableJobTimingStep: boolean;
  useModal: boolean;

  // Form behavior
  formOrigin: 'default' | 'bus' | 'coupang' | 'mechanic' | 'mechanic_newgrad' | 'truck';

  // Styling
  footerBgClassName: string;
  containerClassName: string;

  // Optional images
  footerLogoSrc?: string;
  bottomImageSrc?: string;
}

export const FORM_PRESETS: Record<FormPreset, FormPresetConfig> = {
  default: {
    headerLogoSrc: '/images/ride_logo.svg',
    headerUpperText: '未経験でタクシー会社に就職するなら',
    headerLowerText: 'RIDE JOB（ライドジョブ）',
    loadingLogoSrc: '/images/ride_logo.svg',
    step1ImageSrc: '/images/STEP1.webp',
    step2ImageSrc: '/images/STEP2.webp',
    step3ImageSrc: '/images/STEP3.webp',
    step4ImageSrc: '/images/STEP4.webp',
    step5ImageSrc: '/images/STEP5.webp',
    showHeader: true,
    showLoadingScreen: true,
    showFooterLogo: true,
    showBottomImage: true,
    enableJobTimingStep: true,
    useModal: true,
    formOrigin: 'default',
    footerBgClassName: '',
    containerClassName: '',
  },

  truck: {
    headerLogoSrc: '/images/ride_logo.svg',
    headerUpperText: '未経験でトラックドライバーに転職するなら',
    headerLowerText: 'RIDE JOB（ライドジョブ）',
    loadingLogoSrc: '/images/ride_logo.svg',
    step1ImageSrc: '/images/STEP1.webp',
    step2ImageSrc: '/images/STEP2.webp',
    step3ImageSrc: '/images/STEP3.webp',
    step4ImageSrc: '/images/STEP4.webp',
    step5ImageSrc: '/images/STEP5.webp',
    showHeader: true,
    showLoadingScreen: true,
    showFooterLogo: true,
    showBottomImage: true,
    enableJobTimingStep: true,
    useModal: true,
    formOrigin: 'truck',
    footerBgClassName: '',
    containerClassName: '',
  },

  bus: {
    headerLogoSrc: '/images/ride_logo.svg',
    headerUpperText: '未経験でバス会社に就職するなら',
    headerLowerText: 'RIDE JOB（ライドジョブ）',
    loadingLogoSrc: '/images/ride_logo.svg',
    step1ImageSrc: '/images/STEP1.webp',
    step2ImageSrc: '/images/STEP2.webp',
    step3ImageSrc: '/images/STEP3.webp',
    step4ImageSrc: '/images/STEP4.webp',
    step5ImageSrc: '/images/STEP5.webp',
    showHeader: true,
    showLoadingScreen: true,
    showFooterLogo: true,
    showBottomImage: true,
    enableJobTimingStep: true,
    useModal: true,
    formOrigin: 'bus',
    footerBgClassName: '',
    containerClassName: '',
  },

  /**
   * ⚠️ **休眠中のプリセット。このpresetを渡すページは存在しない。**
   * 現行のクーパンLP(/coupang)は専用の CoupangStepForm → /api/coupang/applicants を使う。
   *
   * こちらの共通フォーム経路は Meta Lead に content_name を載せないため、
   * ここに切り替えると **カスタムコンバージョン「RIDEJOB_クーパン応募」が静かに0件になる**。
   * さらに GA4 側も useApplicationFormState の job_category が
   * mechanic / truck / taxi の三択なので、**クーパン応募が 'taxi' として計上される**。
   * 使うなら、先に useApplicationFormState と /api/applicants の両方へ
   * COUPANG_META_CONTENT_NAME と job_category='coupang_sales' を配線すること。
   */
  coupang: {
    headerLogoSrc: '/images/ride_logo.svg',
    headerUpperText: 'クーパン求人特設フォーム',
    headerLowerText: 'RIDE JOB × Coupang',
    loadingLogoSrc: '/images/loading_rocket.png',
    step1ImageSrc: '/images/STEP1のコピー.webp',
    step2ImageSrc: '/images/STEP2のコピー.webp',
    step3ImageSrc: '/images/STEP3のコピー.webp',
    showHeader: false,
    showLoadingScreen: false,
    showFooterLogo: false,
    showBottomImage: false,
    enableJobTimingStep: false,
    useModal: false,
    formOrigin: 'coupang',
    footerBgClassName: 'bg-[#212e4a]',
    containerClassName: 'pb-8 overflow-hidden',
    footerLogoSrc: '/images/coupang_footer.png',
  },

  mechanic: {
    headerLogoSrc: '/images/mechanic-logo.png',
    headerUpperText: 'ホワイト企業への整備士転職なら',
    headerLowerText: 'ライドジョブメカニック',
    loadingLogoSrc: '/images/ride_logo.svg',
    step1ImageSrc: '/images/STEP1.webp',
    step2ImageSrc: '/images/STEP2.webp',
    step3ImageSrc: '/images/STEP3.webp',
    step4ImageSrc: '/images/STEP4.webp',
    showHeader: true,
    showLoadingScreen: true,
    showFooterLogo: true,
    showBottomImage: true,
    enableJobTimingStep: true,
    useModal: true,
    formOrigin: 'mechanic',
    footerBgClassName: '',
    containerClassName: '',
  },

  mechanic_newgrad: {
    headerLogoSrc: '/images/mechanic-logo.png',
    headerUpperText: 'ホワイト企業への整備士転職なら',
    headerLowerText: 'ライドジョブメカニック',
    loadingLogoSrc: '/images/ride_logo.svg',
    step1ImageSrc: '/images/STEP1.webp',
    step2ImageSrc: '/images/STEP2.webp',
    step3ImageSrc: '/images/STEP3.webp',
    step4ImageSrc: '/images/STEP4.webp',
    showHeader: true,
    showLoadingScreen: true,
    showFooterLogo: true,
    showBottomImage: true,
    enableJobTimingStep: true,
    useModal: true,
    formOrigin: 'mechanic_newgrad',
    footerBgClassName: '',
    containerClassName: '',
  },
};
