interface Props {
  options: string[]
  value: string[]
  onChange: (value: string[]) => void
  label?: string
}

export default function MultiCheck({ options, value, onChange, label }: Props) {
  const toggle = (opt: string) => {
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt])
  }

  return (
    <div>
      {label && <label className="label">{label}</label>}
      <div className="flex flex-wrap gap-2">
        {options.map(opt => (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              value.includes(opt)
                ? 'bg-primary-600 border-primary-600 text-white'
                : 'bg-white border-gray-300 text-gray-700 hover:border-primary-400'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}
