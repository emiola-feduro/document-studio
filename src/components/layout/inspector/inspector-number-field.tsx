type InspectorNumberFieldProps = {
  id: string;
  label: string;
  value?: number;
  onChange: (value: number | undefined) => void;
  min?: number;
  step?: number | 'any';
};

const InspectorNumberField = ({ id, label, value, onChange, min, step = 'any' }: InspectorNumberFieldProps) => (
  <div className="min-w-24 flex-1 space-y-1">
    <label htmlFor={id} className="block font-medium">
      {label}
    </label>
    <input
      id={id}
      type="number"
      min={min}
      step={step}
      inputMode="decimal"
      className="field field-sm tabular-nums"
      value={value ?? ''}
      onChange={(e) => {
        if (e.target.value === '') return onChange(undefined);
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(min !== undefined ? Math.max(min, n) : n);
      }}
    />
  </div>
);

export default InspectorNumberField;
