import { describe, expect, it } from 'vitest';

import type { FormData } from '../types';
import {
  isValidEmail,
  isValidPhoneNumber,
  validateCard2,
  validateFinalStep,
  validateNameFields,
} from './validators';

const emptyForm: FormData = {
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
};

const form = (overrides: Partial<FormData>): FormData => ({ ...emptyForm, ...overrides });

describe('isValidPhoneNumber', () => {
  it.each(['07031415926', '09011223344', '08055667788'])('accepts %s', (phoneNumber) => {
    expect(isValidPhoneNumber(phoneNumber)).toBe(true);
  });

  it.each(['06012345678', '05031415926', '00031415926'])('rejects prefix %s', (phoneNumber) => {
    expect(isValidPhoneNumber(phoneNumber)).toBe(false);
  });

  it.each(['0903141592', '090314159267', '', '090-3141-5926'])(
    'rejects malformed %s',
    (phoneNumber) => {
      expect(isValidPhoneNumber(phoneNumber)).toBe(false);
    },
  );

  it.each(['09000000678', '08011111926', '09099999926'])(
    'rejects five or more repeated digits: %s',
    (phoneNumber) => {
      expect(isValidPhoneNumber(phoneNumber)).toBe(false);
    },
  );

  it.each(['07098765432', '09056789012', '08023456789'])(
    'rejects sequential runs: %s',
    (phoneNumber) => {
      expect(isValidPhoneNumber(phoneNumber)).toBe(false);
    },
  );

  it.each(['09012345678', '08012345678'])('rejects known invalid number %s', (phoneNumber) => {
    expect(isValidPhoneNumber(phoneNumber)).toBe(false);
  });
});

describe('isValidEmail', () => {
  it.each(['a@b.co', 'user.name+tag@example.co.jp', '  padded@example.com  '])(
    'accepts %s',
    (email) => {
      expect(isValidEmail(email)).toBe(true);
    },
  );

  it.each(['', 'no-at-sign.example.com', 'missing@domain', 'two spaces@example.com'])(
    'rejects %s',
    (email) => {
      expect(isValidEmail(email)).toBe(false);
    },
  );
});

describe('validateNameFields', () => {
  it('accepts a hiragana reading', () => {
    const result = validateNameFields(form({ fullName: '田中 太郎', fullNameKana: 'たなか たろう' }));
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('rejects a katakana reading', () => {
    const result = validateNameFields(form({ fullName: '田中 太郎', fullNameKana: 'タナカ タロウ' }));
    expect(result.isValid).toBe(false);
    expect(result.errors.fullNameKana).toBeDefined();
  });

  it('rejects a blank name', () => {
    const result = validateNameFields(form({ fullName: '   ', fullNameKana: 'たなか' }));
    expect(result.isValid).toBe(false);
    expect(result.errors.fullName).toBeDefined();
  });
});

describe('validateCard2', () => {
  it('accepts a seven digit postal code', () => {
    expect(validateCard2(form({ postalCode: '1234567' })).isValid).toBe(true);
  });

  it('rejects a hyphenated postal code', () => {
    expect(validateCard2(form({ postalCode: '123-4567' })).isValid).toBe(false);
  });

  it('accepts a prefecture and municipality pair without a postal code', () => {
    expect(validateCard2(form({ prefectureId: '13', municipalityId: '13101' })).isValid).toBe(true);
  });

  it('rejects a prefecture without a municipality', () => {
    expect(validateCard2(form({ prefectureId: '13' })).isValid).toBe(false);
  });

  it('rejects an empty location', () => {
    expect(validateCard2(emptyForm).isValid).toBe(false);
  });
});

describe('validateFinalStep', () => {
  it('ignores email when it is not required', () => {
    const result = validateFinalStep(form({ phoneNumber: '07031415926' }), false);
    expect(result.isValid).toBe(true);
  });

  it('requires email when the form asks for it', () => {
    const result = validateFinalStep(form({ phoneNumber: '07031415926' }), true);
    expect(result.isValid).toBe(false);
    expect(result.errors.email).toBeDefined();
  });

  it('trims surrounding whitespace before validating the phone number', () => {
    const result = validateFinalStep(form({ phoneNumber: '  07031415926  ' }), false);
    expect(result.isValid).toBe(true);
  });
});
