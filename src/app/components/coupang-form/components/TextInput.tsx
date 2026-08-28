import { type ChangeEvent, type InputHTMLAttributes } from 'react';
import { FormField } from './FormField';

type TextInputProps = {
  name: string;
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  error?: string;
  helpText?: string;
  placeholder?: string;
  required?: boolean;
  type?: 'text' | 'email' | 'tel';
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode'];
  maxLength?: number;
};

export function TextInput({
  name,
  label,
  value,
  onChange,
  onBlur,
  error,
  helpText,
  placeholder,
  required = true,
  type = 'text',
  inputMode,
  maxLength,
}: TextInputProps) {
  return (
    <FormField label={label} required={required} error={error} helpText={helpText}>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1d4ed8] placeholder:text-gray-500 text-gray-900 ${
          error ? 'border-red-500' : 'border-gray-300'
        }`}
      />
    </FormField>
  );
}
