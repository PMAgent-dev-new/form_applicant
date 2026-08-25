export type JobPosition = string;

export type DesiredLocation = string;

export type Age =
  | '18'
  | '19'
  | '20'
  | '21'
  | '22'
  | '23'
  | '24'
  | '25'
  | '26'
  | '27'
  | '28'
  | '29'
  | '30'
  | '31'
  | '32'
  | '33'
  | '34'
  | '35'
  | '36'
  | '37'
  | '38'
  | '39'
  | '40';

export type CoupangFormData = {
  // 求職者情報
  email: string;
  fullName: string;           // 氏名（漢字）
  fullNameKana: string;       // 氏名（ふりがな）
  phoneNumber: string;        // 電話番号

  // 応募情報
  jobPosition: JobPosition | '';
  desiredLocation: DesiredLocation | '';

  // セミナー情報
  age: Age | '';
  birthDate: string;          // 生年月日（8桁）
};

export type CoupangFormErrors = {
  [K in keyof CoupangFormData]?: string;
};
