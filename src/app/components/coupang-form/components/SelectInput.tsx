import { type ChangeEvent } from 'react';
import { FormField } from './FormField';

type SelectInputProps = {
  name: string;
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  error?: string;
  helpText?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
};

export function SelectInput({
  name,
  label,
  value,
  onChange,
  error,
  helpText,
  options,
  placeholder = '選択してください',
  required = true,
}: SelectInputProps) {
  return (
    <FormField label={label} required={required} error={error} helpText={helpText}>
      <select
        name={name}
        value={value}
        onChange={onChange}
        className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1d4ed8] ${
          error ? 'border-red-500' : 'border-gray-300'
        } ${!value ? 'text-gray-500' : 'text-gray-900'}`}
      >
        <option value="" className="text-gray-500">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}
