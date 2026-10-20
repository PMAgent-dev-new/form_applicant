'use client';

type StepProgressBarProps = {
  currentStep: number;
  totalSteps: number;
};

export default function StepProgressBar({ currentStep, totalSteps }: StepProgressBarProps) {
  const safeTotal = totalSteps > 0 ? totalSteps : 1;
  const percent = Math.min(100, Math.max(0, Math.round((currentStep / safeTotal) * 100)));

  return (
    <div className="mb-4 compact:mb-3 tight:mb-2">
      <div className="flex items-center justify-between text-xs font-semibold text-gray-600">
        <span>STEP {currentStep}/{safeTotal}</span>
        <span>{percent}%</span>
      </div>
      <div className="mt-2 h-2 w-full rounded-full bg-gray-200">
        <div className="h-2 rounded-full bg-[#ff702a]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
