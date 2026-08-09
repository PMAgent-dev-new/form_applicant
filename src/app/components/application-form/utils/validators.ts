import type { BirthDate, FormData, FormErrors, TruckLicense } from '../types';

const isValidPhoneNumber = (phoneNumber: string): boolean => {
  if (!/^(070|080|090)\d{8}$/.test(phoneNumber)) return false;
  if (/(.)\1{4,}/.test(phoneNumber)) return false;
  if (/01234|12345|23456|34567|45678|56789|98765|87654|76543|65432|54321/.test(phoneNumber)) return false;
  if (/^09012345678$|^08012345678$/.test(phoneNumber)) return false;
  if (/^(\d)\1+$/.test(phoneNumber)) return false;
  return true;
};

const isValidEmail = (email: string): boolean => {
  if (!email) return false;
  const trimmed = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
};

export const validateJobTiming = (jobTiming: FormData['jobTiming']) => {
  const errors: FormErrors = {};
  if (!jobTiming) {
    errors.jobTiming = '選択してください。';
    return { isValid: false, errors };
  }
  return { isValid: true, errors };
};

export const validateDesiredIncome = (desiredIncome: FormData['desiredIncome']) => {
  const errors: FormErrors = {};
  if (!desiredIncome) {
    errors.desiredIncome = '選択してください。';
    return { isValid: false, errors };
  }
  return { isValid: true, errors };
};

export const validateTruckLicenses = (truckLicenses: TruckLicense[]) => {
  const errors: FormErrors = {};
  if (!truckLicenses || truckLicenses.length === 0) {
    errors.truckLicenses = '選択してください。';
    return { isValid: false, errors };
  }
  return { isValid: true, errors };
};

export const validateMechanicQualification = (mechanicQualification: FormData['mechanicQualification']) => {
  const errors: FormErrors = {};
  if (!mechanicQualification) {
    errors.mechanicQualification = '選択してください。';
    return { isValid: false, errors };
  }
  return { isValid: true, errors };
};

export const validateBirthDateCard = (birthDate: BirthDate) => {
  let isValid = true;
  const errors: FormErrors = {};

  if (!birthDate || birthDate.length !== 8 || !/^\d{8}$/.test(birthDate)) {
    errors.birthDate = '生年月日を8桁の数字で入力してください。';
    return { isValid: false, errors };
  }

  const year = birthDate.slice(0, 4);
  const month = birthDate.slice(4, 6);
  const day = birthDate.slice(6, 8);

  const birth = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
  const today = new Date();

  if (
    birth.getFullYear() !== parseInt(year, 10) ||
    birth.getMonth() !== parseInt(month, 10) - 1 ||
    birth.getDate() !== parseInt(day, 10)
  ) {
    errors.birthDate = '有効な日付を入力してください。';
    return { isValid: false, errors };
  }

  const minAge = 18;
  const maxAge = 84;
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }

  if (age < minAge) {
    errors.birthDate = `${minAge}歳以上である必要があります。`;
    isValid = false;
  } else if (age > maxAge) {
    errors.birthDate = `${maxAge}歳以下である必要があります。`;
    isValid = false;
  }

  if (birth > today) {
    errors.birthDate = '未来の日付は入力できません。';
    isValid = false;
  }

  return { isValid, errors };
};

export const validateCard2 = (formData: FormData) => {
  const errors: FormErrors = {};
  let isValid = true;

  const hasPostalCode = Boolean(formData.postalCode);
  const hasLocationSelection = Boolean(formData.prefectureId && formData.municipalityId);

  if (!hasPostalCode && !hasLocationSelection) {
    errors.postalCode = '郵便番号または地域を選択してください。';
    errors.prefectureId = '都道府県を選択してください。';
    errors.municipalityId = '市区町村を選択してください。';
    isValid = false;
  }

  if (hasPostalCode && !/^[0-9]{7}$/.test(formData.postalCode)) {
    errors.postalCode = '郵便番号はハイフンなしの7桁で入力してください。';
    isValid = false;
  }

  if (!formData.prefectureId && formData.municipalityId) {
    errors.prefectureId = '都道府県を選択してください。';
    isValid = false;
  }

  if (formData.prefectureId && !formData.municipalityId) {
    errors.municipalityId = '市区町村を選択してください。';
    isValid = false;
  }

  return { isValid, errors };
};

export const validateNameFields = (formData: FormData) => {
  const errors: FormErrors = {};
  let isValid = true;

  if (!formData.fullName.trim()) {
    errors.fullName = '氏名は必須です。';
    isValid = false;
  }
  if (!formData.fullNameKana.trim() || !/^[ぁ-んー\s]+$/.test(formData.fullNameKana)) {
    errors.fullNameKana = 'ひらがなで入力してください。';
    isValid = false;
  }

  return { isValid, errors };
};

export const validateFinalStep = (formData: FormData, requireEmail: boolean) => {
  const errors: FormErrors = {};
  const phoneNumber = formData.phoneNumber.trim();
  if (!phoneNumber || !isValidPhoneNumber(phoneNumber)) {
    errors.phoneNumber = '有効な携帯番号を入力してください。';
  }

  if (requireEmail) {
    const email = formData.email.trim();
    if (!email) {
      errors.email = 'メールアドレスを入力してください。';
    } else if (!isValidEmail(email)) {
      errors.email = '有効なメールアドレスを入力してください。';
    }
  }

  const isValid = Object.keys(errors).length === 0;
  return { isValid, errors };
};

export { isValidPhoneNumber, isValidEmail };
